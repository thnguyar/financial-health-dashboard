import type { CompanyData, DataSource } from "../../types";
import { isCacheFresh, storage } from "../storage";
import { fmpProvider } from "./fmpProvider";
import { getMockCompany, tickerCatalog } from "./universe";

export const marketDataProvider = fmpProvider;
let proxyConfigured: boolean | null = null;

const isProxyConfigured = async () => {
  if (proxyConfigured !== null) return proxyConfigured;
  try {
    const response = await fetch("/api/health");
    const data = (await response.json()) as { fmpConfigured?: boolean; googleFinanceConfigured?: boolean };
    proxyConfigured = Boolean(data.fmpConfigured || data.googleFinanceConfigured);
    return proxyConfigured;
  } catch {
    proxyConfigured = false;
    return false;
  }
};

const getGoogleFinanceQuote = async (ticker: string) => {
  const response = await fetch(`/api/market/google-quote?ticker=${encodeURIComponent(ticker)}`);
  const envelope = (await response.json()) as {
    data?: Array<{ price?: number; changesPercentage?: number; name?: string; provider?: string }>;
    source?: "live" | "cache" | "stale-cache";
    error?: string;
  };
  if (!response.ok && !envelope.data) throw new Error(envelope.error || "Google Finance quote failed");
  return { quote: envelope.data?.[0], source: envelope.source ?? "live", error: envelope.error };
};

const withGoogleFinanceQuote = async (ticker: string, company: CompanyData): Promise<CompanyData> => {
  const { quote, source, error } = await getGoogleFinanceQuote(ticker);
  if (!quote?.price) return company;
  return {
    ...company,
    source: source === "live" ? "live" : "cache",
    fetchedAt: new Date().toISOString(),
    error,
    profile: {
      ...company.profile,
      name: quote.name ?? company.profile.name,
      price: quote.price,
      changePercent: typeof quote.changesPercentage === "number" ? quote.changesPercentage / 100 : company.profile.changePercent,
    },
  };
};

export const searchTickers = async (query: string) => {
  const normalized = query.trim().toUpperCase();
  const local = tickerCatalog
    .filter((item) => item.ticker.includes(normalized) || item.name.toUpperCase().includes(normalized))
    .slice(0, 8)
    .map((item) => ({ ticker: item.ticker, name: item.name, exchange: item.country === "United States" ? "US" : "ADR" }));

  if (!normalized || !marketDataProvider.isConfigured()) return local;

  try {
    const remote = await marketDataProvider.searchTickers(normalized);
    const merged = new Map([...local, ...remote].map((item) => [item.ticker, item]));
    return [...merged.values()].slice(0, 10);
  } catch {
    return local;
  }
};

export const getCompanyData = async (ticker: string, force = false): Promise<CompanyData> => {
  const upper = ticker.toUpperCase();
  const cached = storage.loadCompany(upper);
  if (!force && cached && isCacheFresh(cached.fetchedAt, 15)) return { ...cached, source: cached.source === "live" ? "cache" : cached.source };

  if (marketDataProvider.isConfigured() && (await isProxyConfigured())) {
    try {
      const live = await marketDataProvider.getCompanyData(upper);
      storage.saveCompany(live);
      return live;
    } catch (error) {
      const fallback = cached ?? getMockCompany(upper);
      try {
        const quoted = await withGoogleFinanceQuote(upper, fallback);
        storage.saveCompany(quoted);
        return quoted;
      } catch {
        if (cached) return { ...cached, source: "cache", error: error instanceof Error ? error.message : "API error" };
      }
    }
  }

  const demo = cached ?? getMockCompany(upper);
  try {
    const quoted = await withGoogleFinanceQuote(upper, demo);
    storage.saveCompany(quoted);
    return quoted;
  } catch {
    // Google Finance is an unofficial fallback; keep the app usable when it is unavailable.
  }
  const withSource: CompanyData = { ...demo, source: (cached?.source ?? "demo") as DataSource, fetchedAt: cached?.fetchedAt ?? new Date().toISOString() };
  storage.saveCompany(withSource);
  return withSource;
};

export const getCompaniesData = async (tickers: string[], force = false) => {
  const unique = [...new Set(tickers.map((ticker) => ticker.toUpperCase()).filter(Boolean))];
  return Promise.all(unique.map((ticker) => getCompanyData(ticker, force)));
};
