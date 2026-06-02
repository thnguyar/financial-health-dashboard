import { companies } from "../../data/mockData";
import type { CompanyData } from "../../types";

export const sectorPeers: Record<string, string[]> = {
  "Semiconductors": ["NVDA", "AMD", "AVGO", "TSM", "ASML", "QCOM", "INTC", "SMCI"],
  "Software & Cloud": ["MSFT", "GOOGL", "AMZN", "META", "CRM", "ORCL", "NOW"],
  "Consumer Electronics": ["AAPL", "SONY", "DELL", "HPQ"],
  "Electric Vehicles": ["TSLA", "RIVN", "GM", "F", "LI", "NIO"],
  "Banking": ["JPM", "BAC", "C", "WFC", "GS", "MS"],
  "Communication Services": ["META", "GOOGL", "NFLX", "DIS"],
  "E-Commerce": ["AMZN", "SHOP", "EBAY", "MELI"],
};

export const tickerCatalog: Array<{ ticker: string; name: string; industry: string; sector: string; country: string }> = [
  { ticker: "AAPL", name: "Apple Inc.", industry: "Consumer Electronics", sector: "Technology", country: "United States" },
  { ticker: "MSFT", name: "Microsoft Corp.", industry: "Software & Cloud", sector: "Technology", country: "United States" },
  { ticker: "NVDA", name: "Nvidia Corp.", industry: "Semiconductors", sector: "Technology", country: "United States" },
  { ticker: "TSLA", name: "Tesla Inc.", industry: "Electric Vehicles", sector: "Consumer Cyclical", country: "United States" },
  { ticker: "JPM", name: "JPMorgan Chase & Co.", industry: "Banking", sector: "Financial Services", country: "United States" },
  { ticker: "AMD", name: "Advanced Micro Devices", industry: "Semiconductors", sector: "Technology", country: "United States" },
  { ticker: "META", name: "Meta Platforms Inc.", industry: "Communication Services", sector: "Communication Services", country: "United States" },
  { ticker: "GOOGL", name: "Alphabet Inc.", industry: "Software & Cloud", sector: "Communication Services", country: "United States" },
  { ticker: "AMZN", name: "Amazon.com Inc.", industry: "E-Commerce", sector: "Consumer Cyclical", country: "United States" },
  { ticker: "NFLX", name: "Netflix Inc.", industry: "Communication Services", sector: "Communication Services", country: "United States" },
  { ticker: "AVGO", name: "Broadcom Inc.", industry: "Semiconductors", sector: "Technology", country: "United States" },
  { ticker: "TSM", name: "Taiwan Semiconductor Manufacturing", industry: "Semiconductors", sector: "Technology", country: "Taiwan" },
  { ticker: "ASML", name: "ASML Holding", industry: "Semiconductors", sector: "Technology", country: "Netherlands" },
  { ticker: "BAC", name: "Bank of America Corp.", industry: "Banking", sector: "Financial Services", country: "United States" },
  { ticker: "CRM", name: "Salesforce Inc.", industry: "Software & Cloud", sector: "Technology", country: "United States" },
];

const mockMap = new Map(companies.map((company) => [company.profile.ticker, company]));

const seededNumber = (ticker: string, min: number, max: number) => {
  const seed = ticker.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return min + (seed % 100) / 100 * (max - min);
};

export const getMockCompany = (ticker: string): CompanyData => {
  const upper = ticker.toUpperCase();
  const existing = mockMap.get(upper);
  if (existing) return { ...existing, source: "demo", fetchedAt: new Date().toISOString() };

  const catalog = tickerCatalog.find((item) => item.ticker === upper) ?? {
    ticker: upper,
    name: `${upper} Corp.`,
    industry: "Software & Cloud",
    sector: "Technology",
    country: "United States",
  };
  const revenue = seededNumber(upper, 9000, 68000);
  const margin = seededNumber(upper, 0.08, 0.36);
  const growth = seededNumber(upper, -0.08, 0.34);
  const netIncome = revenue * margin;
  const fcf = netIncome * seededNumber(upper, 0.55, 1.15);
  const marketCap = seededNumber(upper, 35, 1800) * 1_000_000_000;
  const price = seededNumber(upper, 42, 620);

  return {
    source: "demo",
    fetchedAt: new Date().toISOString(),
    analystConsensus: Math.round(seededNumber(upper, 48, 84)),
    marketTrend: Math.round(seededNumber(upper, 44, 82)),
    nextEarnings: "2026-08-15",
    profile: {
      ticker: upper,
      name: catalog.name,
      industry: catalog.industry,
      sector: catalog.sector,
      country: catalog.country,
      marketCap,
      price,
      changePercent: seededNumber(upper, -0.035, 0.045),
      currency: "USD",
    },
    financials: [
      { period: "Latest Q", type: "Quarter", revenue, ebitda: revenue * (margin + 0.12), netIncome, eps: netIncome / 5800, freeCashFlow: fcf, debtToEquity: seededNumber(upper, 0.12, 1.9), roe: seededNumber(upper, 0.08, 0.42), roa: seededNumber(upper, 0.04, 0.2), grossMargin: seededNumber(upper, 0.28, 0.7), netMargin: margin, currentRatio: seededNumber(upper, 0.85, 3.2) },
      { period: "Prior Q", type: "Quarter", revenue: revenue * (1 - growth / 3), ebitda: revenue * (margin + 0.1), netIncome: netIncome * 0.94, eps: (netIncome * 0.94) / 5800, freeCashFlow: fcf * 0.91, debtToEquity: seededNumber(upper, 0.12, 1.9), roe: seededNumber(upper, 0.08, 0.42), roa: seededNumber(upper, 0.04, 0.2), grossMargin: seededNumber(upper, 0.28, 0.7), netMargin: margin * 0.97, currentRatio: seededNumber(upper, 0.85, 3.2) },
      { period: "Year Ago Q", type: "Quarter", revenue: revenue / (1 + growth), ebitda: revenue * (margin + 0.08), netIncome: netIncome / (1 + growth * 0.9), eps: (netIncome / (1 + growth * 0.9)) / 5800, freeCashFlow: fcf / (1 + growth * 0.8), debtToEquity: seededNumber(upper, 0.12, 1.9), roe: seededNumber(upper, 0.08, 0.42), roa: seededNumber(upper, 0.04, 0.2), grossMargin: seededNumber(upper, 0.28, 0.7), netMargin: margin * 0.95, currentRatio: seededNumber(upper, 0.85, 3.2) },
    ],
    valuation: {
      pe: seededNumber(upper, 12, 62),
      forwardPe: seededNumber(upper, 10, 48),
      pb: seededNumber(upper, 1.4, 19),
      evEbitda: seededNumber(upper, 9, 34),
      ps: marketCap / Math.max(revenue * 4 * 1_000_000, 1),
      dividendYield: seededNumber(upper, 0, 0.025),
      industryAvg: { pe: 28, forwardPe: 24, pb: 7.5, evEbitda: 18, ps: 5.5, dividendYield: 0.01 },
    },
  };
};
