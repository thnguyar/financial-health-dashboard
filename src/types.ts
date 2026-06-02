export type Sentiment = "Positive" | "Neutral" | "Negative";
export type ImpactLevel = "Low" | "Medium" | "High";
export type InvestmentSignal = "Strong Buy" | "Buy" | "Hold" | "Watch" | "Sell / Avoid";
export type ValuationLabel = "Undervalued" | "Fairly Valued" | "Overvalued";
export type DataSource = "live" | "cache" | "demo";
export type RefreshInterval = 5 | 15 | 30 | 60;

export interface CompanyProfile {
  ticker: string;
  name: string;
  industry: string;
  sector?: string;
  country: string;
  marketCap: number;
  price?: number;
  changePercent?: number;
  currency?: string;
}

export interface FinancialPeriod {
  period: string;
  type: "Quarter" | "Year";
  revenue: number;
  ebitda: number;
  netIncome: number;
  eps: number;
  freeCashFlow: number;
  debtToEquity: number;
  roe: number;
  roa: number;
  grossMargin: number;
  netMargin: number;
  currentRatio: number;
}

export interface ValuationMetrics {
  pe: number;
  forwardPe: number;
  pb: number;
  evEbitda: number;
  ps: number;
  dividendYield: number;
  industryAvg: Pick<ValuationMetrics, "pe" | "forwardPe" | "pb" | "evEbitda" | "ps" | "dividendYield">;
}

export interface CompanyData {
  profile: CompanyProfile;
  financials: FinancialPeriod[];
  valuation: ValuationMetrics;
  analystConsensus: number;
  marketTrend: number;
  nextEarnings: string;
  source?: DataSource;
  fetchedAt?: string;
  error?: string;
}

export interface NewsItem {
  id: string;
  title: string;
  source: string;
  publishedAt: string;
  summary: string;
  sentiment: Sentiment;
  impact: ImpactLevel;
  relatedTickers: string[];
  reason: string;
  directTicker: string;
  sector?: string;
  keywords?: string[];
}

export interface HealthScore {
  total: number;
  label: "Very Strong" | "Healthy" | "Neutral / Watchlist" | "Weak" | "High Risk";
  components: Record<"Profitability" | "Liquidity" | "Solvency" | "Growth" | "Cash Flow Quality" | "Valuation", number>;
  reasoning: string[];
}

export interface AffectedStock {
  ticker: string;
  companyName: string;
  impactScore: number;
  relationship: "Direct" | "Peer" | "Supplier" | "Customer" | "Competitor";
  sentiment: Sentiment;
  reason: string;
}

export interface PredictiveAlert {
  ticker: string;
  title: string;
  probability: number;
  severity: ImpactLevel;
  scenario: {
    bull: string;
    base: string;
    bear: string;
  };
}

export interface PortfolioPosition {
  id?: string;
  portfolioId?: string;
  ticker: string;
  companyName?: string;
  shares: number;
  averageCost: number;
  purchaseDate: string;
  notes?: string;
  addedAt: string;
}

export interface AppSettings {
  refreshIntervalMinutes: RefreshInterval;
  selectedTicker: string;
  theme?: "dark" | "light";
  defaultCurrency?: string;
  newsFilters: {
    ticker: string;
    sector: string;
    sentiment: "All" | Sentiment;
    impact: "All" | ImpactLevel;
  };
}

export interface MarketDataProvider {
  id: string;
  label: string;
  isConfigured(): boolean;
  searchTickers(query: string): Promise<Array<{ ticker: string; name: string; exchange?: string }>>;
  getCompanyData(ticker: string): Promise<CompanyData>;
}

export interface NewsProvider {
  id: string;
  label: string;
  isConfigured(): boolean;
  getNews(tickers: string[]): Promise<NewsItem[]>;
}

export interface DashboardData {
  companies: CompanyData[];
  news: NewsItem[];
  source: DataSource;
  lastUpdatedAt: string;
  errors: string[];
}

export interface UserProfile {
  id: string;
  email: string;
  createdAt: string;
}

export interface PortfolioRecord {
  id: string;
  userId: string;
  name: string;
  baseCurrency: string;
  createdAt: string;
  updatedAt: string;
}
