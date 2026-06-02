import type { AppSettings, CompanyData, DashboardData, NewsItem, PortfolioPosition } from "../../types";

const PREFIX = "equity-health-v2";

const keys = {
  portfolio: `${PREFIX}:portfolio`,
  settings: `${PREFIX}:settings`,
  companyCache: (ticker: string) => `${PREFIX}:company:${ticker.toUpperCase()}`,
  newsCache: `${PREFIX}:news`,
  dashboardCache: `${PREFIX}:dashboard`,
};

const safeParse = <T>(value: string | null, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const read = <T>(key: string, fallback: T): T => safeParse<T>(localStorage.getItem(key), fallback);
const write = <T>(key: string, value: T) => localStorage.setItem(key, JSON.stringify(value));

export const defaultPortfolio: PortfolioPosition[] = [
  { ticker: "AAPL", shares: 10, averageCost: 185, purchaseDate: "2025-11-15", addedAt: new Date().toISOString() },
  { ticker: "MSFT", shares: 6, averageCost: 420, purchaseDate: "2025-12-02", addedAt: new Date().toISOString() },
  { ticker: "NVDA", shares: 12, averageCost: 118, purchaseDate: "2026-01-18", addedAt: new Date().toISOString() },
  { ticker: "TSLA", shares: 4, averageCost: 255, purchaseDate: "2026-02-08", addedAt: new Date().toISOString() },
  { ticker: "JPM", shares: 8, averageCost: 214, purchaseDate: "2026-03-12", addedAt: new Date().toISOString() },
];

export const defaultSettings: AppSettings = {
  refreshIntervalMinutes: 15,
  selectedTicker: "NVDA",
  theme: "dark",
  defaultCurrency: "USD",
  newsFilters: { ticker: "All", sector: "All", sentiment: "All", impact: "All" },
};

export const storage = {
  loadPortfolio: () => read<PortfolioPosition[]>(keys.portfolio, defaultPortfolio),
  savePortfolio: (portfolio: PortfolioPosition[]) => write(keys.portfolio, portfolio),
  loadSettings: () => read<AppSettings>(keys.settings, defaultSettings),
  saveSettings: (settings: AppSettings) => write(keys.settings, settings),
  loadCompany: (ticker: string) => read<CompanyData | null>(keys.companyCache(ticker), null),
  saveCompany: (company: CompanyData) => write(keys.companyCache(company.profile.ticker), company),
  loadNews: () => read<NewsItem[]>(keys.newsCache, []),
  saveNews: (news: NewsItem[]) => write(keys.newsCache, news),
  loadDashboard: () => read<DashboardData | null>(keys.dashboardCache, null),
  saveDashboard: (data: DashboardData) => write(keys.dashboardCache, data),
};

export const isCacheFresh = (isoDate?: string, ttlMinutes = 15) => {
  if (!isoDate) return false;
  return Date.now() - new Date(isoDate).getTime() < ttlMinutes * 60 * 1000;
};
