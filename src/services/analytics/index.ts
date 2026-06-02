import type {
  AffectedStock,
  CompanyData,
  HealthScore,
  InvestmentSignal,
  NewsItem,
  PortfolioPosition,
  ValuationLabel,
} from "../../types";
import { growth } from "../../utils/format";

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const avg = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const normalizeReason = (value: string) => value.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

const compactReason = (reason: string) => {
  const seen = new Set<string>();
  const sentences = reason
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => {
      const normalized = normalizeReason(item);
      const isDuplicate = [...seen].some((prior) => normalized === prior || normalized.includes(prior) || prior.includes(normalized));
      if (isDuplicate) return false;
      seen.add(normalized);
      return true;
    });
  return sentences.slice(0, 2).join(" ");
};

export const latest = (company: CompanyData) => company.financials[0];
export const previousQuarter = (company: CompanyData) => company.financials[1] ?? company.financials[0];
export const yearAgoQuarter = (company: CompanyData) => company.financials[2] ?? company.financials[1] ?? company.financials[0];

export const growthMetrics = (company: CompanyData) => {
  const current = latest(company);
  const prior = previousQuarter(company);
  const yearAgo = yearAgoQuarter(company);

  return {
    revenueQoq: growth(current.revenue, prior.revenue),
    revenueYoy: growth(current.revenue, yearAgo.revenue),
    epsQoq: growth(current.eps, prior.eps),
    epsYoy: growth(current.eps, yearAgo.eps),
    fcfYoy: growth(current.freeCashFlow, yearAgo.freeCashFlow),
    netIncomeYoy: growth(current.netIncome, yearAgo.netIncome),
  };
};

export const getScoreLabel = (score: number): HealthScore["label"] => {
  if (score >= 80) return "Very Strong";
  if (score >= 60) return "Healthy";
  if (score >= 40) return "Neutral / Watchlist";
  if (score >= 20) return "Weak";
  return "High Risk";
};

export const valuationPremium = (company: CompanyData) => {
  const { valuation } = company;
  const pairs = [
    [valuation.pe, valuation.industryAvg.pe],
    [valuation.forwardPe, valuation.industryAvg.forwardPe],
    [valuation.pb, valuation.industryAvg.pb],
    [valuation.evEbitda, valuation.industryAvg.evEbitda],
    [valuation.ps, valuation.industryAvg.ps],
  ].filter(([, benchmark]) => benchmark > 0);

  return avg(pairs.map(([value, benchmark]) => (value - benchmark) / benchmark));
};

export const getValuationLabel = (company: CompanyData): ValuationLabel => {
  const premium = valuationPremium(company);
  const g = growthMetrics(company);
  const growthSupport = avg([g.revenueYoy, g.epsYoy, g.fcfYoy]);

  if (premium < -0.12 || (premium < 0.08 && growthSupport > 0.2)) return "Undervalued";
  if (premium > 0.28 && growthSupport < 0.35) return "Overvalued";
  return "Fairly Valued";
};

export const calculateHealthScore = (company: CompanyData): HealthScore => {
  const current = latest(company);
  if (!current) {
    return {
      total: 0,
      label: "High Risk",
      components: { Profitability: 0, Liquidity: 0, Solvency: 0, Growth: 0, "Cash Flow Quality": 0, Valuation: 0 },
      reasoning: ["Financial statements are missing or incomplete, so the company is treated as high risk until data refresh succeeds."],
    };
  }
  const g = growthMetrics(company);
  const valuation = getValuationLabel(company);

  const profitability = avg([
    clamp((current.roe / 0.3) * 100),
    clamp((current.roa / 0.14) * 100),
    clamp((current.netMargin / 0.25) * 100),
    clamp((current.grossMargin / 0.55) * 100),
  ]);

  const liquidity = clamp((current.currentRatio / 1.8) * 100);
  const solvency = clamp(100 - current.debtToEquity * 28);
  const growthScore = avg([
    clamp(50 + g.revenueYoy * 160),
    clamp(50 + g.epsYoy * 150),
    clamp(50 + g.netIncomeYoy * 140),
  ]);
  const cashFlowQuality = avg([
    clamp((current.freeCashFlow / Math.max(current.netIncome, 1)) * 85),
    clamp(50 + g.fcfYoy * 130),
  ]);
  const valuationScore =
    valuation === "Undervalued" ? 82 : valuation === "Fairly Valued" ? 62 : clamp(48 - valuationPremium(company) * 25);

  const components = {
    Profitability: Math.round(profitability),
    Liquidity: Math.round(liquidity),
    Solvency: Math.round(solvency),
    Growth: Math.round(growthScore),
    "Cash Flow Quality": Math.round(cashFlowQuality),
    Valuation: Math.round(valuationScore),
  };

  const total = Math.round(
    components.Profitability * 0.22 +
      components.Liquidity * 0.13 +
      components.Solvency * 0.15 +
      components.Growth * 0.2 +
      components["Cash Flow Quality"] * 0.15 +
      components.Valuation * 0.15,
  );

  const reasoning = [
    `Profitability is driven by ${(current.netMargin * 100).toFixed(1)}% net margin and ${(current.roe * 100).toFixed(1)}% ROE.`,
    `Liquidity is ${current.currentRatio.toFixed(2)}x current ratio, while debt-to-equity is ${current.debtToEquity.toFixed(2)}x.`,
    `Growth model reads ${(g.revenueYoy * 100).toFixed(1)}% revenue YoY and ${(g.epsYoy * 100).toFixed(1)}% EPS YoY.`,
    `Free cash flow quality is supported by FCF/net income of ${(current.freeCashFlow / Math.max(current.netIncome, 1)).toFixed(2)}x.`,
    `Valuation is classified as ${valuation.toLowerCase()} versus industry benchmarks.`,
  ];

  return { total, label: getScoreLabel(total), components, reasoning };
};

export const sentimentScore = (news: NewsItem[], ticker: string) => {
  const relevant = news.filter((item) => item.relatedTickers.includes(ticker));
  if (!relevant.length) return 50;
  const score = avg(
    relevant.map((item) => {
      const base = item.sentiment === "Positive" ? 72 : item.sentiment === "Negative" ? 28 : 50;
      const weight = item.impact === "High" ? 1.25 : item.impact === "Medium" ? 1 : 0.75;
      return clamp(50 + (base - 50) * weight);
    }),
  );
  return Math.round(score);
};

export const getInvestmentSignal = (company: CompanyData, news: NewsItem[]) => {
  const health = calculateHealthScore(company);
  const valuation = getValuationLabel(company);
  const g = growthMetrics(company);
  const current = latest(company);
  const newsScore = sentimentScore(news, company.profile.ticker);

  const valuationPoints = valuation === "Undervalued" ? 78 : valuation === "Fairly Valued" ? 60 : 36;
  const growthPoints = clamp(50 + avg([g.revenueYoy, g.epsYoy, g.fcfYoy]) * 130);
  const cashFlowPoints = clamp((current.freeCashFlow / Math.max(current.netIncome, 1)) * 85);

  const total = Math.round(
    health.total * 0.3 +
      valuationPoints * 0.18 +
      growthPoints * 0.16 +
      cashFlowPoints * 0.12 +
      newsScore * 0.12 +
      company.marketTrend * 0.07 +
      company.analystConsensus * 0.05,
  );

  let signal: InvestmentSignal = "Hold";
  if (total >= 82) signal = "Strong Buy";
  else if (total >= 68) signal = "Buy";
  else if (total >= 52) signal = "Hold";
  else if (total >= 38) signal = "Watch";
  else signal = "Sell / Avoid";

  const reasoning = [
    `Composite signal score is ${total}/100 with financial health contributing ${health.total}/100.`,
    `${valuation} valuation contributes ${valuationPoints}/100 after peer comparison.`,
    `News sentiment for ${company.profile.ticker} is ${newsScore}/100 and market trend is ${company.marketTrend}/100.`,
    `Consensus input is ${company.analystConsensus}/100; this is treated as a secondary factor, not a guarantee.`,
  ];

  return { signal, total, reasoning };
};

const relationshipMap: Record<string, Array<Pick<AffectedStock, "ticker" | "relationship" | "reason">>> = {
  NVDA: [
    { ticker: "AMD", relationship: "Competitor", reason: "AI accelerator pricing and demand expectations often re-rate AMD with Nvidia." },
    { ticker: "TSMC", relationship: "Supplier", reason: "Foundry demand and advanced packaging capacity are linked to Nvidia order flow." },
    { ticker: "ASML", relationship: "Supplier", reason: "Semiconductor capex expectations influence lithography equipment sentiment." },
    { ticker: "AVGO", relationship: "Peer", reason: "AI networking and custom silicon demand can move with Nvidia datacenter trends." },
    { ticker: "SMCI", relationship: "Customer", reason: "AI server demand is tied to GPU availability and hyperscaler deployments." },
  ],
  MSFT: [
    { ticker: "NVDA", relationship: "Supplier", reason: "Azure AI demand increases accelerator and networking chip expectations." },
    { ticker: "AMZN", relationship: "Competitor", reason: "Cloud growth read-through affects AWS growth assumptions." },
    { ticker: "GOOGL", relationship: "Competitor", reason: "Enterprise AI workload share shifts expectations for Google Cloud." },
  ],
  TSLA: [
    { ticker: "RIVN", relationship: "Competitor", reason: "EV pricing pressure can compress margins across pure-play EV peers." },
    { ticker: "GM", relationship: "Competitor", reason: "Legacy automakers may need higher incentives to defend EV share." },
    { ticker: "F", relationship: "Competitor", reason: "Sector-level pricing changes affect EV profitability assumptions." },
  ],
};

export const calculateAffectedStocks = (news: NewsItem[], companies: CompanyData[]): AffectedStock[] => {
  const names = new Map(companies.map((company) => [company.profile.ticker, company.profile.name]));
  const results = new Map<string, AffectedStock>();

  news.forEach((item) => {
    const impactBase = item.impact === "High" ? 72 : item.impact === "Medium" ? 48 : 26;
    const sentimentMultiplier = item.sentiment === "Negative" ? 1.08 : item.sentiment === "Positive" ? 1 : 0.88;
    const directScore = Math.round(impactBase * sentimentMultiplier + 18);
    results.set(item.directTicker, {
      ticker: item.directTicker,
      companyName: names.get(item.directTicker) ?? item.directTicker,
      impactScore: Math.max(results.get(item.directTicker)?.impactScore ?? 0, directScore),
      relationship: "Direct",
      sentiment: item.sentiment,
      reason: compactReason(item.reason),
    });

    relationshipMap[item.directTicker]?.forEach((relation, index) => {
      const score = Math.round(impactBase * sentimentMultiplier - index * 6);
      const prior = results.get(relation.ticker)?.impactScore ?? 0;
      if (score > prior) {
        results.set(relation.ticker, {
          ticker: relation.ticker,
          companyName: names.get(relation.ticker) ?? relation.ticker,
          impactScore: score,
          relationship: relation.relationship,
          sentiment: item.sentiment,
          reason: compactReason(relation.reason),
        });
      }
    });
  });

  return [...results.values()].sort((a, b) => b.impactScore - a.impactScore).slice(0, 10);
};

export const valuationWarning = (company: CompanyData) => {
  const label = getValuationLabel(company);
  const g = growthMetrics(company);
  const weakGrowth = avg([g.revenueYoy, g.epsYoy, g.fcfYoy]) < 0.08;
  return label === "Overvalued" && weakGrowth;
};

export const calculatePositionMetrics = (position: PortfolioPosition, company?: CompanyData) => {
  const price = company?.profile.price ?? 0;
  const marketValue = position.shares * price;
  const costBasis = position.shares * position.averageCost;
  const unrealizedPl = marketValue - costBasis;
  const unrealizedPlPercent = costBasis ? unrealizedPl / costBasis : 0;
  return { price, marketValue, costBasis, unrealizedPl, unrealizedPlPercent };
};

export const calculatePortfolioTotals = (portfolio: PortfolioPosition[], companies: CompanyData[]) => {
  const byTicker = new Map(companies.map((company) => [company.profile.ticker, company]));
  const totals = portfolio.reduce(
    (totals, position) => {
      const metrics = calculatePositionMetrics(position, byTicker.get(position.ticker));
      totals.marketValue += metrics.marketValue;
      totals.costBasis += metrics.costBasis;
      totals.unrealizedPl += metrics.unrealizedPl;
      return totals;
    },
    { marketValue: 0, costBasis: 0, unrealizedPl: 0, unrealizedPlPercent: 0 },
  );
  totals.unrealizedPlPercent = totals.costBasis ? totals.unrealizedPl / totals.costBasis : 0;
  return totals;
};
