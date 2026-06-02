import "dotenv/config";
import express from "express";
import { createClient } from "@supabase/supabase-js";

const app = express();
const PORT = Number(process.env.API_PORT || 8787);
const FMP_BASE = "https://financialmodelingprep.com/api/v3";
const FINNHUB_BASE = "https://finnhub.io/api/v1";
const GOOGLE_FINANCE_BASE = "https://www.google.com/finance/beta/quote";
const TTL_MS = Number(process.env.API_CACHE_TTL_MS || 10 * 60 * 1000);
const RATE_WINDOW_MS = Number(process.env.API_RATE_WINDOW_MS || 60 * 1000);
const RATE_LIMIT = Number(process.env.API_RATE_LIMIT || 90);
const cache = new Map();
const buckets = new Map();
const GOOGLE_EXCHANGE_CANDIDATES = {
  JPM: ["NYSE", "NASDAQ"],
  BAC: ["NYSE", "NASDAQ"],
  GS: ["NYSE", "NASDAQ"],
  MS: ["NYSE", "NASDAQ"],
  WFC: ["NYSE", "NASDAQ"],
  F: ["NYSE", "NASDAQ"],
  GM: ["NYSE", "NASDAQ"],
  SHOP: ["NYSE", "NASDAQ"],
};
const serviceClient =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    : null;

app.use(express.json());

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "http://127.0.0.1:5174");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  return next();
});

app.use((req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || "local";
  const now = Date.now();
  const bucket = buckets.get(ip) ?? { count: 0, resetAt: now + RATE_WINDOW_MS };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + RATE_WINDOW_MS;
  }
  bucket.count += 1;
  buckets.set(ip, bucket);
  res.setHeader("X-RateLimit-Limit", String(RATE_LIMIT));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, RATE_LIMIT - bucket.count)));
  if (bucket.count > RATE_LIMIT) {
    return res.status(429).json({ error: "Rate limit exceeded. Please retry shortly." });
  }
  return next();
});

const validateTicker = (ticker) => {
  const normalized = String(ticker || "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(normalized)) {
    const error = new Error("Invalid ticker. Use 1-10 letters/numbers, dot, or dash.");
    error.status = 400;
    throw error;
  }
  return normalized;
};

const getCached = (key) => {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.savedAt > TTL_MS) return null;
  return hit;
};

const saveCache = (key, data, source = "live") => {
  const value = { data, source, cachedAt: new Date().toISOString(), savedAt: Date.now() };
  cache.set(key, value);
  return value;
};

const fmpUrl = (path, params = {}) => {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    const error = new Error("FMP_API_KEY is not configured on the server.");
    error.status = 503;
    throw error;
  }
  const url = new URL(`${FMP_BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  url.searchParams.set("apikey", apiKey);
  return url.toString();
};

const finnhubUrl = (path, params = {}) => {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    const error = new Error("FINNHUB_API_KEY is not configured on the server.");
    error.status = 503;
    throw error;
  }
  const url = new URL(`${FINNHUB_BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  url.searchParams.set("token", apiKey);
  return url.toString();
};

async function fetchJson(url) {
  const response = await fetch(url);
  const body = await response.text();
  let data;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    data = { raw: body };
  }
  if (!response.ok) {
    const error = new Error(data?.["Error Message"] || data?.message || `Provider returned HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

const parseGoogleNumber = (value) => Number(String(value || "").replace(/[$,% ,]/g, ""));

function parseGoogleFinanceQuote(html, ticker, exchange) {
  const name = html.match(/<title>(.*?)\s+\([A-Z0-9.-]+\)\s+Stock Price/i)?.[1]?.replace(/&amp;/g, "&") ?? ticker;
  const anchor = `[[["${ticker}","${exchange}"]`;
  const start = html.indexOf(anchor);
  const end = html.indexOf(`,"${name.replace(/"/g, '\\"')}"`, start);
  const quoteBlock = start >= 0 ? html.slice(start, end > start ? end : start + 250000) : html;
  const matches = [...quoteBlock.matchAll(/\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\]/g)];
  const latest = matches.at(-1);
  const fallbackPrice = html.match(/>\s*([$€£¥]\s*[0-9][0-9,.]*)\s*</)?.[1];
  const price = latest ? Number(latest[1]) : parseGoogleNumber(fallbackPrice);
  if (!Number.isFinite(price) || price <= 0) {
    const error = new Error(`Google Finance did not return a usable quote for ${ticker}.`);
    error.status = 502;
    throw error;
  }
  return {
    symbol: ticker,
    name,
    price,
    changesPercentage: latest && Math.abs(Number(latest[3])) <= 1 ? Number(latest[3]) * 100 : 0,
    change: latest ? Number(latest[2]) : 0,
    exchange,
    provider: "google-finance-beta",
  };
}

async function fetchGoogleFinanceQuote(ticker) {
  const exchanges = GOOGLE_EXCHANGE_CANDIDATES[ticker] ?? ["NASDAQ", "NYSE"];
  let lastError;
  for (const exchange of exchanges) {
    try {
      const url = `${GOOGLE_FINANCE_BASE}/${encodeURIComponent(`${ticker}:${exchange}`)}?hl=en`;
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0",
          Accept: "text/html",
        },
      });
      if (!response.ok) throw new Error(`Google Finance returned HTTP ${response.status}`);
      const html = await response.text();
      return [parseGoogleFinanceQuote(html, ticker, exchange)];
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error(`Google Finance quote failed for ${ticker}.`);
}

const handleCached = (route, getter) => async (req, res) => {
  let ticker = "";
  try {
    ticker = validateTicker(req.query.ticker);
    const cacheKey = `${route}:${ticker}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json({ ...cached, ticker });
    if (serviceClient) {
      const { data: dbHit } = await serviceClient
        .from("market_data_cache")
        .select("payload,fetched_at,expires_at")
        .eq("ticker", ticker)
        .eq("provider", route)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      if (dbHit) {
        const envelope = { data: dbHit.payload, source: "cache", cachedAt: dbHit.fetched_at, savedAt: Date.now() };
        cache.set(cacheKey, envelope);
        return res.json({ ...envelope, ticker });
      }
    }

    const data = await getter(ticker);
    const envelope = saveCache(cacheKey, data);
    if (serviceClient) {
      await serviceClient.from("market_data_cache").upsert(
        {
          ticker,
          provider: route,
          payload: data,
          fetched_at: envelope.cachedAt,
          expires_at: new Date(Date.now() + TTL_MS).toISOString(),
        },
        { onConflict: "ticker,provider" },
      );
    }
    return res.json({ ...envelope, ticker });
  } catch (error) {
    const status = Number(error.status || 502);
    const stalePrefix = `${route}:${ticker}`;
    const stale = ticker ? cache.get(stalePrefix) : null;
    if (stale) {
      return res.status(status).json({
        error: error.message || "Provider request failed. Returning stale cache.",
        data: stale.data,
        source: "stale-cache",
        cachedAt: stale.cachedAt,
        ticker,
      });
    }
    return res.status(status).json({ error: error.message || "Provider request failed.", ticker });
  }
};

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    provider: "Financial Modeling Prep",
    fmpConfigured: Boolean(process.env.FMP_API_KEY),
    finnhubConfigured: Boolean(process.env.FINNHUB_API_KEY),
    googleFinanceConfigured: true,
    cacheEntries: cache.size,
  });
});
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    provider: "Financial Modeling Prep",
    runtime: "express-local",
    fmpConfigured: Boolean(process.env.FMP_API_KEY),
    finnhubConfigured: Boolean(process.env.FINNHUB_API_KEY),
    googleFinanceConfigured: true,
    cacheEntries: cache.size,
  });
});

app.get("/api/quote", handleCached("quote", (ticker) => (process.env.FMP_API_KEY ? fetchJson(fmpUrl(`/quote/${ticker}`)) : fetchGoogleFinanceQuote(ticker))));
app.get("/api/market/quote", handleCached("quote", (ticker) => (process.env.FMP_API_KEY ? fetchJson(fmpUrl(`/quote/${ticker}`)) : fetchGoogleFinanceQuote(ticker))));
app.get("/api/market/google-quote", handleCached("google-quote", (ticker) => fetchGoogleFinanceQuote(ticker)));
app.get("/api/profile", handleCached("profile", (ticker) => fetchJson(fmpUrl(`/profile/${ticker}`))));
app.get("/api/market/profile", handleCached("profile", (ticker) => fetchJson(fmpUrl(`/profile/${ticker}`))));
app.get(
  "/api/financials",
  handleCached("financials", async (ticker) => {
    const [income, balance, cashflow] = await Promise.all([
      fetchJson(fmpUrl(`/income-statement/${ticker}`, { period: "quarter", limit: 6 })),
      fetchJson(fmpUrl(`/balance-sheet-statement/${ticker}`, { period: "quarter", limit: 6 })),
      fetchJson(fmpUrl(`/cash-flow-statement/${ticker}`, { period: "quarter", limit: 6 })),
    ]);
    return { income, balance, cashflow };
  }),
);
app.get(
  "/api/market/financials",
  handleCached("financials", async (ticker) => {
    const [income, balance, cashflow] = await Promise.all([
      fetchJson(fmpUrl(`/income-statement/${ticker}`, { period: "quarter", limit: 6 })),
      fetchJson(fmpUrl(`/balance-sheet-statement/${ticker}`, { period: "quarter", limit: 6 })),
      fetchJson(fmpUrl(`/cash-flow-statement/${ticker}`, { period: "quarter", limit: 6 })),
    ]);
    return { income, balance, cashflow };
  }),
);
app.get(
  "/api/ratios",
  handleCached("ratios", async (ticker) => {
    const [ratios, metrics] = await Promise.all([
      fetchJson(fmpUrl(`/ratios-ttm/${ticker}`)),
      fetchJson(fmpUrl(`/key-metrics-ttm/${ticker}`)),
    ]);
    return { ratios, metrics };
  }),
);
app.get(
  "/api/market/ratios",
  handleCached("ratios", async (ticker) => {
    const [ratios, metrics] = await Promise.all([
      fetchJson(fmpUrl(`/ratios-ttm/${ticker}`)),
      fetchJson(fmpUrl(`/key-metrics-ttm/${ticker}`)),
    ]);
    return { ratios, metrics };
  }),
);
app.get(
  "/api/news",
  handleCached("news", async (ticker) => {
    if (process.env.FMP_API_KEY) {
      return fetchJson(fmpUrl("/stock_news", { tickers: ticker, limit: 40 }));
    }
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return fetchJson(finnhubUrl("/company-news", { symbol: ticker, from, to }));
  }),
);

app.use((req, res) => {
  res.status(404).json({ error: `Unknown endpoint: ${req.method} ${req.path}` });
});

app.listen(PORT, () => {
  console.log(`API proxy listening on http://127.0.0.1:${PORT}`);
});
