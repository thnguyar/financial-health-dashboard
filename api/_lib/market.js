import { createClient } from "@supabase/supabase-js";

const FMP_BASE = "https://financialmodelingprep.com/api/v3";
const FINNHUB_BASE = "https://finnhub.io/api/v1";
const GOOGLE_FINANCE_BASE = "https://www.google.com/finance/beta/quote";
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
const cache = globalThis.__marketProxyCache ?? new Map();
const buckets = globalThis.__marketProxyBuckets ?? new Map();
globalThis.__marketProxyCache = cache;
globalThis.__marketProxyBuckets = buckets;
const serviceClient =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    : null;

const ttlMs = () => Number(process.env.API_CACHE_TTL_MS || 10 * 60 * 1000);
const rateWindowMs = () => Number(process.env.API_RATE_WINDOW_MS || 60 * 1000);
const rateLimit = () => Number(process.env.API_RATE_LIMIT || 90);

export function validateTicker(ticker) {
  const normalized = String(ticker || "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(normalized)) {
    const error = new Error("Invalid ticker. Use 1-10 letters/numbers, dot, or dash.");
    error.status = 400;
    throw error;
  }
  return normalized;
}

export function applyRateLimit(req, res) {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket?.remoteAddress || "unknown";
  const now = Date.now();
  const bucket = buckets.get(ip) ?? { count: 0, resetAt: now + rateWindowMs() };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + rateWindowMs();
  }
  bucket.count += 1;
  buckets.set(ip, bucket);
  res.setHeader("X-RateLimit-Limit", String(rateLimit()));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, rateLimit() - bucket.count)));
  if (bucket.count > rateLimit()) {
    res.status(429).json({ error: "Rate limit exceeded. Please retry shortly." });
    return false;
  }
  return true;
}

export function fmpUrl(path, params = {}) {
  if (!process.env.FMP_API_KEY) {
    const error = new Error("FMP_API_KEY is not configured on the server.");
    error.status = 503;
    throw error;
  }
  const url = new URL(`${FMP_BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  url.searchParams.set("apikey", process.env.FMP_API_KEY);
  return url.toString();
}

export function finnhubUrl(path, params = {}) {
  if (!process.env.FINNHUB_API_KEY) {
    const error = new Error("FINNHUB_API_KEY is not configured on the server.");
    error.status = 503;
    throw error;
  }
  const url = new URL(`${FINNHUB_BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  url.searchParams.set("token", process.env.FINNHUB_API_KEY);
  return url.toString();
}

export async function fetchJson(url) {
  const response = await fetch(url);
  const body = await response.text();
  let data;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    data = { raw: body };
  }
  if (!response.ok) {
    const error = new Error(data?.message || `Provider returned HTTP ${response.status}`);
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

export async function fetchGoogleFinanceQuote(ticker) {
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

export function sendCached(req, res, route, getter) {
  if (!applyRateLimit(req, res)) return;
  let ticker = "";
  Promise.resolve()
    .then(async () => {
      ticker = validateTicker(req.query.ticker);
      const key = `${route}:${ticker}`;
      const hit = cache.get(key);
      if (hit && Date.now() - hit.savedAt < ttlMs()) {
        res.status(200).json({ ...hit, ticker });
        return;
      }
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
          cache.set(key, envelope);
          res.status(200).json({ ...envelope, ticker });
          return;
        }
      }
      const data = await getter(ticker);
      const envelope = { data, source: "live", cachedAt: new Date().toISOString(), savedAt: Date.now() };
      cache.set(key, envelope);
      if (serviceClient) {
        await serviceClient.from("market_data_cache").upsert(
          {
            ticker,
            provider: route,
            payload: data,
            fetched_at: envelope.cachedAt,
            expires_at: new Date(Date.now() + ttlMs()).toISOString(),
          },
          { onConflict: "ticker,provider" },
        );
      }
      res.status(200).json({ ...envelope, ticker });
    })
    .catch((error) => {
      const key = `${route}:${ticker}`;
      const stale = ticker ? cache.get(key) : null;
      const status = Number(error.status || 502);
      if (stale) {
        res.status(status).json({ error: error.message, data: stale.data, source: "stale-cache", cachedAt: stale.cachedAt, ticker });
        return;
      }
      res.status(status).json({ error: error.message || "Provider request failed.", ticker });
    });
}
