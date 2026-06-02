import type { CompanyData, FinancialPeriod, MarketDataProvider } from "../../types";

const toMillions = (value?: number) => (Number(value) || 0) / 1_000_000;
const safeRatio = (a?: number, b?: number) => (Number(b) ? Number(a || 0) / Number(b) : 0);

type ProxyEnvelope<T> = {
  data?: T;
  source?: "live" | "cache" | "stale-cache";
  cachedAt?: string;
  ticker?: string;
  error?: string;
};

async function proxyGet<T>(path: string, ticker: string): Promise<ProxyEnvelope<T>> {
  const response = await fetch(`/api/market/${path}?ticker=${encodeURIComponent(ticker)}`);
  const payload = (await response.json()) as ProxyEnvelope<T>;
  if (!response.ok) {
    if (payload.data) return payload;
    throw new Error(payload.error || `API proxy returned HTTP ${response.status}`);
  }
  return payload;
}

export const fmpProvider: MarketDataProvider = {
  id: "proxy",
  label: "Backend API Proxy",
  isConfigured: () => true,
  async searchTickers() {
    return [];
  },
  async getCompanyData(ticker) {
    const upper = ticker.toUpperCase();
    const [profileEnvelope, quoteEnvelope, financialsEnvelope, ratiosEnvelope] = await Promise.all([
      proxyGet<Array<Record<string, any>>>("profile", upper),
      proxyGet<Array<Record<string, any>>>("quote", upper),
      proxyGet<{ income: Array<Record<string, any>>; balance: Array<Record<string, any>>; cashflow: Array<Record<string, any>> }>("financials", upper),
      proxyGet<{ ratios: Array<Record<string, any>>; metrics: Array<Record<string, any>> }>("ratios", upper),
    ]);

    const profile = profileEnvelope.data?.[0] ?? {};
    const quote = quoteEnvelope.data?.[0] ?? {};
    const incomeRows = financialsEnvelope.data?.income ?? [];
    const balanceRows = financialsEnvelope.data?.balance ?? [];
    const cashRows = financialsEnvelope.data?.cashflow ?? [];
    const ratios = ratiosEnvelope.data?.ratios?.[0] ?? {};
    const metrics = ratiosEnvelope.data?.metrics?.[0] ?? {};
    const financials: FinancialPeriod[] = incomeRows.slice(0, 4).map((income, index) => {
      const balance = balanceRows[index] ?? {};
      const cash = cashRows[index] ?? {};
      const assets = Number(balance.totalAssets) || 0;
      const equity = Number(balance.totalStockholdersEquity) || 0;
      const liabilities = Number(balance.totalLiabilities) || 0;
      const currentAssets = Number(balance.totalCurrentAssets) || 0;
      const currentLiabilities = Number(balance.totalCurrentLiabilities) || 0;
      const revenue = Number(income.revenue) || 0;
      const netIncome = Number(income.netIncome) || 0;
      const grossProfit = Number(income.grossProfit) || 0;
      const operatingCashFlow = Number(cash.operatingCashFlow) || 0;
      const capex = Number(cash.capitalExpenditure) || 0;
      return {
        period: income.period ? `${income.period} ${String(income.calendarYear ?? "").trim()}` : income.date ?? `Q${index + 1}`,
        type: "Quarter",
        revenue: toMillions(revenue),
        ebitda: toMillions(income.ebitda),
        netIncome: toMillions(netIncome),
        eps: Number(income.epsdiluted ?? income.eps ?? 0),
        freeCashFlow: toMillions(operatingCashFlow + capex),
        debtToEquity: safeRatio(liabilities, equity),
        roe: safeRatio(netIncome * 4, equity),
        roa: safeRatio(netIncome * 4, assets),
        grossMargin: safeRatio(grossProfit, revenue),
        netMargin: safeRatio(netIncome, revenue),
        currentRatio: safeRatio(currentAssets, currentLiabilities),
      };
    });

    if (!financials.length) throw new Error(`No financial statements returned for ${upper}`);

    const source = [profileEnvelope, quoteEnvelope, financialsEnvelope, ratiosEnvelope].some((item) => item.source === "stale-cache")
      ? "cache"
      : "live";
    const error = [profileEnvelope, quoteEnvelope, financialsEnvelope, ratiosEnvelope].map((item) => item.error).filter(Boolean).join(" · ");

    const marketCap = Number(profile.mktCap || quote.marketCap || 0);
    const company: CompanyData = {
      source,
      fetchedAt: new Date().toISOString(),
      error: error || undefined,
      profile: {
        ticker: upper,
        name: profile.companyName ?? quote.name ?? upper,
        industry: profile.industry ?? "Unknown",
        sector: profile.sector ?? profile.industry ?? "Unknown",
        country: profile.country ?? "United States",
        marketCap,
        price: Number(quote.price || profile.price || 0),
        changePercent: Number(quote.changesPercentage || 0) / 100,
        currency: profile.currency ?? "USD",
      },
      financials,
      valuation: {
        pe: Number(quote.pe || metrics.peRatioTTM || 0),
        forwardPe: Number(metrics.forwardPERatioTTM || quote.pe || 0),
        pb: Number(metrics.pbRatioTTM || 0),
        evEbitda: Number(metrics.enterpriseValueOverEBITDATTM || 0),
        ps: Number(metrics.priceToSalesRatioTTM || 0),
        dividendYield: Number(ratios.dividendYielTTM || ratios.dividendYieldTTM || 0),
        industryAvg: { pe: 28, forwardPe: 24, pb: 7.5, evEbitda: 18, ps: 5.5, dividendYield: 0.01 },
      },
      analystConsensus: 60,
      marketTrend: Math.round(50 + Math.max(-25, Math.min(25, Number(quote.changesPercentage || 0) * 3))),
      nextEarnings: "TBD",
    };

    return company;
  },
};
