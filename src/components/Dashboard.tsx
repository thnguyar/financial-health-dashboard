import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  Building2,
  Gauge,
  Moon,
  Newspaper,
  Plus,
  RefreshCcw,
  Search,
  ShieldCheck,
  Sun,
  Trash2,
  UserCircle,
  WalletCards,
  X,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  AppSettings,
  CompanyData,
  DashboardData,
  ImpactLevel,
  InvestmentSignal,
  NewsItem,
  PortfolioPosition,
  Sentiment,
  ValuationLabel,
} from "../types";
import { getCompaniesData, marketDataProvider, searchTickers } from "../services/marketData";
import { getNews } from "../services/news";
import { defaultSettings, storage } from "../services/storage";
import { authService } from "../services/auth";
import { isSupabaseConfigured } from "../services/database/client";
import { portfolioService } from "../services/portfolio";
import { settingsService } from "../services/settings";
import {
  calculateAffectedStocks,
  calculateHealthScore,
  calculatePortfolioTotals,
  calculatePositionMetrics,
  getInvestmentSignal,
  getValuationLabel,
  growthMetrics,
  latest,
  valuationWarning,
} from "../services/analytics";
import { tickerCatalog } from "../services/marketData/universe";
import { currency, dateTime, number, percent } from "../utils/format";

const cx = (...classes: Array<string | false | undefined>) => classes.filter(Boolean).join(" ");

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return fallback;
};

const sentimentStyle: Record<Sentiment, string> = {
  Positive: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  Neutral: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  Negative: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
};

const impactStyle: Record<ImpactLevel, string> = {
  Low: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  Medium: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  High: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
};

const valuationStyle: Record<ValuationLabel, string> = {
  Undervalued: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "Fairly Valued": "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  Overvalued: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
};

const signalStyle: Record<InvestmentSignal, string> = {
  "Strong Buy": "bg-emerald-500 text-white",
  Buy: "bg-lime-500 text-slate-950",
  Hold: "bg-sky-500 text-white",
  Watch: "bg-amber-500 text-slate-950",
  "Sell / Avoid": "bg-rose-600 text-white",
};

const navItems = [
  { id: "dashboard", label: "Dashboard", icon: BarChart3 },
  { id: "company-analysis", label: "Company Analysis", icon: Building2 },
  { id: "news-intelligence", label: "News Intelligence", icon: Newspaper },
  { id: "watchlist", label: "Watchlist", icon: WalletCards },
  { id: "portfolio-risk", label: "Portfolio Risk", icon: Gauge },
  { id: "alerts", label: "Alerts", icon: Bell },
];

function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold", className)}>{children}</span>;
}

function Card({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return <section id={id} className={cx("rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900", className)}>{children}</section>;
}

function SectionTitle({ icon: Icon, title, action }: { icon: typeof Activity; title: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">{title}</h2>
      </div>
      {action}
    </div>
  );
}

function MetricCard({ label, value, sub, tone = "neutral" }: { label: string; value: string; sub?: string; tone?: "good" | "bad" | "neutral" }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-bold text-slate-950 dark:text-white">{value}</p>
      {sub && <p className={cx("mt-1 text-xs", tone === "good" && "text-emerald-600 dark:text-emerald-300", tone === "bad" && "text-rose-600 dark:text-rose-300", tone === "neutral" && "text-slate-500 dark:text-slate-400")}>{sub}</p>}
    </div>
  );
}

function getDashboardSource(companies: CompanyData[]): DashboardData["source"] {
  if (companies.some((company) => company.source === "live")) return "live";
  if (companies.some((company) => company.source === "cache")) return "cache";
  return "demo";
}

function PortfolioManager({
  portfolio,
  setPortfolio,
  selectedTicker,
  setSelectedTicker,
  companies,
}: {
  portfolio: PortfolioPosition[];
  setPortfolio: (portfolio: PortfolioPosition[]) => void;
  selectedTicker: string;
  setSelectedTicker: (ticker: string) => void;
  companies: CompanyData[];
}) {
  const [query, setQuery] = useState("");
  const [shares, setShares] = useState("1");
  const [averageCost, setAverageCost] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [suggestions, setSuggestions] = useState<Array<{ ticker: string; name: string; exchange?: string }>>([]);
  const byTicker = new Map(companies.map((company) => [company.profile.ticker, company]));
  const totals = calculatePortfolioTotals(portfolio, companies);

  useEffect(() => {
    let active = true;
    searchTickers(query).then((items) => {
      if (active) setSuggestions(items);
    });
    return () => {
      active = false;
    };
  }, [query]);

  const addTicker = (ticker = query) => {
    const upper = ticker.trim().toUpperCase();
    if (!upper) return;
    const position: PortfolioPosition = {
      ticker: upper,
      shares: Math.max(0, Number(shares) || 0),
      averageCost: Math.max(0, Number(averageCost) || 0),
      purchaseDate,
      addedAt: new Date().toISOString(),
    };
    const next = portfolio.some((item) => item.ticker === upper)
      ? portfolio.map((item) => (item.ticker === upper ? { ...item, ...position } : item))
      : [...portfolio, position];
    setPortfolio(next);
    setSelectedTicker(upper);
    setQuery("");
    setAverageCost("");
  };

  const updatePosition = (ticker: string, patch: Partial<PortfolioPosition>) => {
    setPortfolio(portfolio.map((item) => (item.ticker === ticker ? { ...item, ...patch } : item)));
  };

  const removeTicker = (ticker: string) => {
    const next = portfolio.filter((item) => item.ticker !== ticker);
    setPortfolio(next);
    if (selectedTicker === ticker && next[0]) setSelectedTicker(next[0].ticker);
  };

  return (
    <Card>
      <SectionTitle icon={WalletCards} title="Portfolio & Watchlist" action={<Badge className="bg-slate-900 text-white dark:bg-white dark:text-slate-950">{portfolio.length} tickers</Badge>} />
      <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
          <div className="grid gap-2 md:grid-cols-[1fr_100px_120px_140px_auto]">
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ticker: AMD, META, GOOGL..." className="h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-cyan-500 dark:border-slate-700 dark:bg-slate-950" />
            </label>
            <input value={shares} onChange={(event) => setShares(event.target.value)} placeholder="Shares" type="number" min="0" className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950" />
            <input value={averageCost} onChange={(event) => setAverageCost(event.target.value)} placeholder="Avg cost" type="number" min="0" className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950" />
            <input value={purchaseDate} onChange={(event) => setPurchaseDate(event.target.value)} type="date" className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950" />
            <button onClick={() => addTicker()} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-cyan-500 px-3 text-sm font-bold text-slate-950">
              <Plus className="h-4 w-4" /> Add
            </button>
          </div>
          {suggestions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {suggestions.map((item) => (
                <button key={item.ticker} onClick={() => addTicker(item.ticker)} className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-semibold hover:border-cyan-500 dark:border-slate-800">
                  {item.ticker} <span className="font-normal text-slate-500">{item.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <MetricCard label="Market Value" value={currency(totals.marketValue, false)} />
          <MetricCard label="Cost Basis" value={currency(totals.costBasis, false)} />
          <MetricCard label="Unrealized P/L" value={currency(totals.unrealizedPl, false)} sub={percent(totals.unrealizedPlPercent)} tone={totals.unrealizedPl >= 0 ? "good" : "bad"} />
        </div>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[920px] text-left text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr>
              <th className="pb-3">Ticker</th>
              <th className="pb-3">Shares</th>
              <th className="pb-3">Avg Cost</th>
              <th className="pb-3">Purchase Date</th>
              <th className="pb-3">Last Price</th>
              <th className="pb-3">Market Value</th>
              <th className="pb-3">P/L</th>
              <th className="pb-3">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {portfolio.map((position) => {
              const company = byTicker.get(position.ticker);
              const metrics = calculatePositionMetrics(position, company);
              return (
                <tr key={position.ticker}>
                  <td className="py-3">
                    <button onClick={() => setSelectedTicker(position.ticker)} className={cx("font-black", selectedTicker === position.ticker ? "text-cyan-600 dark:text-cyan-300" : "text-slate-950 dark:text-white")}>{position.ticker}</button>
                    <p className="text-xs text-slate-500">{company?.profile.name ?? "Loading company data"}</p>
                  </td>
                  <td className="py-3"><input aria-label={`${position.ticker} shares`} type="number" min="0" value={position.shares} onChange={(event) => updatePosition(position.ticker, { shares: Number(event.target.value) || 0 })} className="h-9 w-24 rounded border border-slate-300 bg-white px-2 dark:border-slate-700 dark:bg-slate-950" /></td>
                  <td className="py-3"><input aria-label={`${position.ticker} average cost`} type="number" min="0" value={position.averageCost} onChange={(event) => updatePosition(position.ticker, { averageCost: Number(event.target.value) || 0 })} className="h-9 w-28 rounded border border-slate-300 bg-white px-2 dark:border-slate-700 dark:bg-slate-950" /></td>
                  <td className="py-3"><input aria-label={`${position.ticker} purchase date`} type="date" value={position.purchaseDate} onChange={(event) => updatePosition(position.ticker, { purchaseDate: event.target.value })} className="h-9 rounded border border-slate-300 bg-white px-2 dark:border-slate-700 dark:bg-slate-950" /></td>
                  <td className="py-3 font-semibold">{metrics.price ? currency(metrics.price, false) : "N/A"}</td>
                  <td className="py-3">{currency(metrics.marketValue, false)}</td>
                  <td className={cx("py-3 font-semibold", metrics.unrealizedPl >= 0 ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300")}>{currency(metrics.unrealizedPl, false)} · {percent(metrics.unrealizedPlPercent)}</td>
                  <td className="py-3"><button aria-label={`Remove ${position.ticker}`} onClick={() => removeTicker(position.ticker)} className="grid h-9 w-9 place-items-center rounded-md border border-slate-300 text-rose-600 hover:bg-rose-50 dark:border-slate-700 dark:hover:bg-rose-950/30"><Trash2 className="h-4 w-4" /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function CompanyOverview({ company, news }: { company: CompanyData; news: NewsItem[] }) {
  const current = latest(company);
  const g = growthMetrics(company);
  const health = calculateHealthScore(company);
  const valuation = getValuationLabel(company);
  const signal = getInvestmentSignal(company, news);
  const warning = valuationWarning(company);
  const trend = [...company.financials].reverse().map((period) => ({ period: period.period, Revenue: period.revenue, "Net Income": period.netIncome, FCF: period.freeCashFlow }));
  const valuationData = [
    { name: "P/E", Company: company.valuation.pe, Industry: company.valuation.industryAvg.pe },
    { name: "Fwd P/E", Company: company.valuation.forwardPe, Industry: company.valuation.industryAvg.forwardPe },
    { name: "P/B", Company: company.valuation.pb, Industry: company.valuation.industryAvg.pb },
    { name: "EV/EBITDA", Company: company.valuation.evEbitda, Industry: company.valuation.industryAvg.evEbitda },
    { name: "P/S", Company: company.valuation.ps, Industry: company.valuation.industryAvg.ps },
  ].filter((item) => item.Company > 0 && item.Industry > 0);
  const scoreChart = Object.entries(health.components).map(([name, value]) => ({ name, value }));

  return (
    <div className="grid gap-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-black text-slate-950 dark:text-white">{company.profile.name}</h1>
              <Badge className="bg-slate-900 text-white dark:bg-white dark:text-slate-950">{company.profile.ticker}</Badge>
              <Badge className={valuationStyle[valuation]}>{valuation}</Badge>
              <Badge className={signalStyle[signal.signal]}>{signal.signal}</Badge>
            </div>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {company.profile.industry} · {company.profile.sector ?? "Unknown sector"} · {company.profile.country} · Market Cap {currency(company.profile.marketCap)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Health Score</p>
            <p className="text-3xl font-black text-cyan-600 dark:text-cyan-300">{health.total}</p>
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-6">
          <MetricCard label="Price" value={company.profile.price ? currency(company.profile.price, false) : "N/A"} sub={company.profile.changePercent !== undefined ? percent(company.profile.changePercent) : "No quote"} tone={(company.profile.changePercent ?? 0) >= 0 ? "good" : "bad"} />
          <MetricCard label="Revenue" value={currency(current.revenue * 1_000_000)} sub={`YoY ${percent(g.revenueYoy)}`} tone={g.revenueYoy >= 0 ? "good" : "bad"} />
          <MetricCard label="Net Income" value={currency(current.netIncome * 1_000_000)} sub={`YoY ${percent(g.netIncomeYoy)}`} tone={g.netIncomeYoy >= 0 ? "good" : "bad"} />
          <MetricCard label="EPS" value={`$${current.eps.toFixed(2)}`} sub={`QoQ ${percent(g.epsQoq)}`} tone={g.epsQoq >= 0 ? "good" : "bad"} />
          <MetricCard label="Free Cash Flow" value={currency(current.freeCashFlow * 1_000_000)} sub={`YoY ${percent(g.fcfYoy)}`} tone={g.fcfYoy >= 0 ? "good" : "bad"} />
          <MetricCard label="Debt-to-Equity" value={`${current.debtToEquity.toFixed(2)}x`} sub="Solvency input" />
          <MetricCard label="ROE" value={percent(current.roe)} sub="Profitability" />
          <MetricCard label="ROA" value={percent(current.roa)} sub="Asset efficiency" />
          <MetricCard label="Gross Margin" value={percent(current.grossMargin)} sub="Pricing power" />
          <MetricCard label="Net Margin" value={percent(current.netMargin)} sub="Bottom-line margin" />
          <MetricCard label="Current Ratio" value={`${current.currentRatio.toFixed(2)}x`} sub="Liquidity input" />
          <MetricCard label="Dividend Yield" value={percent(company.valuation.dividendYield)} sub="Valuation input" />
        </div>
      </Card>

      <div className="grid gap-4 2xl:grid-cols-[1fr_1fr]">
        <Card>
          <SectionTitle icon={ShieldCheck} title="Financial Health Score" action={<Badge className="bg-cyan-500/15 text-cyan-700 dark:text-cyan-300">{health.label}</Badge>} />
          <div className="grid gap-5 xl:grid-cols-[220px_1fr]">
            <div className="flex flex-col items-center justify-center rounded-lg bg-slate-50 p-5 dark:bg-slate-950">
              <div className="grid h-36 w-36 place-items-center rounded-full border-[12px] border-cyan-500">
                <span className="text-4xl font-black text-slate-950 dark:text-white">{health.total}</span>
              </div>
              <p className="mt-3 text-center text-sm text-slate-500 dark:text-slate-400">0-100 composite score</p>
            </div>
            <div>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={scoreChart} layout="vertical" margin={{ left: 18, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#33415533" />
                    <XAxis type="number" domain={[0, 100]} hide />
                    <YAxis type="category" dataKey="name" width={116} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                      {scoreChart.map((_, index) => <Cell key={index} fill={["#0891b2", "#10b981", "#0f766e", "#2563eb", "#84cc16", "#f59e0b"][index]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                {health.reasoning.map((item) => <li key={item}>· {item}</li>)}
              </ul>
            </div>
          </div>
        </Card>

        <Card>
          <SectionTitle icon={Activity} title="Dynamic Investment Signal" action={<Badge className={signalStyle[signal.signal]}>{signal.signal}</Badge>} />
          <div className="mb-4 rounded-lg bg-slate-50 p-4 dark:bg-slate-950">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Signal Confidence</p>
            <div className="mt-2 flex items-center gap-4">
              <p className="text-3xl font-black text-slate-950 dark:text-white">{signal.total}/100</p>
              <div className="h-2 flex-1 rounded-full bg-slate-200 dark:bg-slate-800"><div className="h-2 rounded-full bg-cyan-500" style={{ width: `${signal.total}%` }} /></div>
            </div>
          </div>
          <div className="space-y-2">
            {signal.reasoning.map((item) => <p key={item} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300">{item}</p>)}
          </div>
          <p className="mt-4 rounded-md bg-amber-500/10 p-3 text-xs font-medium text-amber-800 dark:text-amber-200">
            Disclaimer: This is not personal financial advice. It is a data-driven analysis tool and does not promise investment returns.
          </p>
        </Card>
      </div>

      <div className="grid gap-4 2xl:grid-cols-[1fr_1fr]">
        <Card>
          <SectionTitle icon={BarChart3} title="Financial Statements Trend" />
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#33415533" />
                <XAxis dataKey="period" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip formatter={(value) => currency(Number(value) * 1_000_000)} />
                <Legend />
                <Area type="monotone" dataKey="Revenue" stroke="#0891b2" fill="#0891b233" strokeWidth={2} />
                <Line type="monotone" dataKey="Net Income" stroke="#10b981" strokeWidth={2} />
                <Line type="monotone" dataKey="FCF" stroke="#f59e0b" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <SectionTitle icon={Gauge} title="Valuation vs Industry" action={<Badge className={valuationStyle[valuation]}>{valuation}</Badge>} />
          {warning && <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">High valuation with weak growth. Watch earnings revisions and cash-flow momentum.</div>}
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={valuationData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#33415533" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="Company" fill="#0891b2" radius={[5, 5, 0, 0]} />
                <Bar dataKey="Industry" fill="#94a3b8" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  );
}

function NewsPanel({ news, settings, setSettings, companies }: { news: NewsItem[]; settings: AppSettings; setSettings: (settings: AppSettings) => void; companies: CompanyData[] }) {
  const sectors = ["All", ...new Set(companies.map((company) => company.profile.sector ?? company.profile.industry))];
  const tickers = ["All", ...companies.map((company) => company.profile.ticker)];
  const filters = settings.newsFilters;
  const filtered = news.filter((item) => {
    const tickerOk = filters.ticker === "All" || item.relatedTickers.includes(filters.ticker);
    const sectorOk = filters.sector === "All" || item.sector === filters.sector;
    const sentimentOk = filters.sentiment === "All" || item.sentiment === filters.sentiment;
    const impactOk = filters.impact === "All" || item.impact === filters.impact;
    return tickerOk && sectorOk && sentimentOk && impactOk;
  });
  const affected = calculateAffectedStocks(filtered, companies);

  const updateFilters = (patch: Partial<AppSettings["newsFilters"]>) => setSettings({ ...settings, newsFilters: { ...filters, ...patch } });

  return (
    <div className="grid gap-4 2xl:grid-cols-[0.95fr_1.05fr]">
      <Card>
        <SectionTitle icon={AlertTriangle} title="News Impact Engine" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr><th className="pb-3">Rank</th><th className="pb-3">Stock</th><th className="pb-3">Relationship</th><th className="pb-3">Impact</th><th className="pb-3">Why affected</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {affected.map((stock, index) => (
                <tr key={`${stock.ticker}-${stock.relationship}`}>
                  <td className="py-3 font-bold text-slate-500">#{index + 1}</td>
                  <td className="py-3"><p className="font-bold text-slate-950 dark:text-white">{stock.ticker}</p><p className="text-xs text-slate-500">{stock.companyName}</p></td>
                  <td className="py-3"><Badge className="bg-cyan-500/15 text-cyan-700 dark:text-cyan-300">{stock.relationship}</Badge></td>
                  <td className="py-3"><div className="flex items-center gap-2"><div className="h-2 w-24 rounded-full bg-slate-200 dark:bg-slate-800"><div className="h-2 rounded-full bg-rose-500" style={{ width: `${stock.impactScore}%` }} /></div><span className="font-semibold">{stock.impactScore}</span></div></td>
                  <td className="py-3 text-slate-600 dark:text-slate-300">{stock.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card>
        <SectionTitle icon={Newspaper} title="Realtime News Intelligence" />
        <div className="mb-3 grid gap-2 md:grid-cols-4">
          <select value={filters.ticker} onChange={(event) => updateFilters({ ticker: event.target.value })} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950">{tickers.map((ticker) => <option key={ticker}>{ticker}</option>)}</select>
          <select value={filters.sector} onChange={(event) => updateFilters({ sector: event.target.value })} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950">{sectors.map((sector) => <option key={sector}>{sector}</option>)}</select>
          <select value={filters.sentiment} onChange={(event) => updateFilters({ sentiment: event.target.value as AppSettings["newsFilters"]["sentiment"] })} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950">{["All", "Positive", "Neutral", "Negative"].map((value) => <option key={value}>{value}</option>)}</select>
          <select value={filters.impact} onChange={(event) => updateFilters({ impact: event.target.value as AppSettings["newsFilters"]["impact"] })} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950">{["All", "Low", "Medium", "High"].map((value) => <option key={value}>{value}</option>)}</select>
        </div>
        <div className="max-h-[620px] space-y-3 overflow-auto pr-1">
          {filtered.map((item) => (
            <article key={item.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-slate-900 text-white dark:bg-white dark:text-slate-950">{item.source}</Badge>
                <Badge className={sentimentStyle[item.sentiment]}>{item.sentiment}</Badge>
                <Badge className={impactStyle[item.impact]}>{item.impact} impact</Badge>
                <span className="text-xs text-slate-500">{dateTime(item.publishedAt)}</span>
              </div>
              <h3 className="mt-3 text-sm font-bold text-slate-950 dark:text-white">{item.title}</h3>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{item.summary}</p>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{item.reason}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">{item.relatedTickers.map((ticker) => <span key={ticker} className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">{ticker}</span>)}</div>
            </article>
          ))}
        </div>
      </Card>
    </div>
  );
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: User) => void }) {
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const submit = async () => {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      if (!isSupabaseConfigured) {
        throw new Error("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
      }
      if (mode === "forgot") {
        await authService.resetPassword(email);
        setMessage("Password reset email sent if the account exists.");
        return;
      }
      const result = mode === "signup" ? await authService.signUp(email, password) : await authService.signIn(email, password);
      if (result.session?.user) {
        onAuthenticated(result.session.user);
        setMessage(mode === "signup" ? "Account created and signed in." : "Signed in.");
        return;
      }
      setMessage("Account created. Check your email, confirm the account, then login here.");
    } catch (err) {
      setError(getErrorMessage(err, "Authentication failed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dark min-h-screen bg-slate-950 text-slate-100">
      <main className="mx-auto grid min-h-screen max-w-6xl items-center gap-8 px-4 py-10 lg:grid-cols-[1fr_420px]">
        <section>
          <Badge className="bg-cyan-400 text-slate-950">Production-ready</Badge>
          <h1 className="mt-5 text-4xl font-black leading-tight text-white md:text-5xl">Equity Health Intelligence</h1>
          <p className="mt-4 max-w-2xl text-lg text-slate-300">
            Sign in to sync your portfolio, watchlist, refresh settings, and analysis preferences to Supabase PostgreSQL with Row Level Security.
          </p>
          <div className="mt-8 grid gap-3 text-sm text-slate-300 md:grid-cols-3">
            <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">Private portfolios per user</div>
            <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">Server-side market API keys</div>
            <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">Database sync across devices</div>
          </div>
        </section>
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-5 shadow-2xl">
          <div className="mb-4 flex items-center gap-2">
            <UserCircle className="h-5 w-5 text-cyan-300" />
            <h2 className="text-lg font-black">{mode === "login" ? "Login" : mode === "signup" ? "Sign up" : "Reset password"}</h2>
          </div>
          {!isSupabaseConfigured && (
            <div className="mb-4 rounded-md border border-amber-700 bg-amber-950/40 p-3 text-sm text-amber-200">
              Supabase env vars are missing. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to enable login.
            </div>
          )}
          <div className="grid gap-3">
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="Email" className="h-11 rounded-md border border-slate-700 bg-slate-950 px-3 outline-none focus:ring-2 focus:ring-cyan-500" />
            {mode !== "forgot" && <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="Password" className="h-11 rounded-md border border-slate-700 bg-slate-950 px-3 outline-none focus:ring-2 focus:ring-cyan-500" />}
            <button onClick={submit} disabled={loading || !email || (mode !== "forgot" && !password)} className="h-11 rounded-md bg-cyan-400 font-black text-slate-950 disabled:opacity-60">
              {loading ? "Please wait..." : mode === "login" ? "Login" : mode === "signup" ? "Create account" : "Send reset email"}
            </button>
          </div>
          {error && <p className="mt-3 rounded-md bg-rose-950/50 p-3 text-sm text-rose-200">{error}</p>}
          {message && <p className="mt-3 rounded-md bg-emerald-950/50 p-3 text-sm text-emerald-200">{message}</p>}
          <div className="mt-4 flex flex-wrap gap-2 text-sm">
            <button onClick={() => setMode("login")} className="text-cyan-300">Login</button>
            <span className="text-slate-600">·</span>
            <button onClick={() => setMode("signup")} className="text-cyan-300">Sign up</button>
            <span className="text-slate-600">·</span>
            <button onClick={() => setMode("forgot")} className="text-cyan-300">Forgot password</button>
          </div>
        </section>
      </main>
    </div>
  );
}

export function Dashboard() {
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [dark, setDark] = useState(true);
  const [portfolio, setPortfolioState] = useState<PortfolioPosition[]>([]);
  const [settings, setSettingsState] = useState<AppSettings>(() => storage.loadSettings());
  const [data, setData] = useState<DashboardData>(() => storage.loadDashboard() ?? { companies: [], news: [], source: "demo", lastUpdatedAt: "", errors: [] });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState("");
  const [saveError, setSaveError] = useState("");
  const [activeNav, setActiveNav] = useState("dashboard");

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setAuthLoading(false);
      return;
    }
    authService
      .getSession()
      .then((state) => setUser(state.user))
      .catch((error) => setErrors([getErrorMessage(error, "Unable to load session")]))
      .finally(() => setAuthLoading(false));
    return authService.onAuthStateChange((state) => setUser(state.user));
  }, []);

  useEffect(() => {
    if (!user) return;
    setSyncing(true);
    setSaveError("");
    Promise.all([portfolioService.loadPositions(user.id), settingsService.load(user.id)])
      .then(async ([remotePortfolio, remoteSettings]) => {
        let nextPortfolio = remotePortfolio;
        if (!remotePortfolio.length && storage.loadPortfolio().length) {
          nextPortfolio = await portfolioService.migrateLocalPortfolio(user.id);
          setSyncStatus("Migrated local portfolio to your database account.");
        } else {
          setSyncStatus("Portfolio synced from database.");
        }
        setPortfolioState(nextPortfolio);
        setSettingsState(remoteSettings);
        setDark((remoteSettings.theme ?? "dark") === "dark");
      })
      .catch((error) => {
        setPortfolioState(storage.loadPortfolio());
        setSaveError(getErrorMessage(error, "Database sync failed. Using local fallback."));
      })
      .finally(() => setSyncing(false));
  }, [user?.id]);

  const setPortfolio = (next: PortfolioPosition[]) => {
    setPortfolioState(next);
    storage.savePortfolio(next);
    if (!user) return;
    setSyncStatus("Saving portfolio...");
    portfolioService
      .savePositions(user.id, next)
      .then((saved) => {
        setPortfolioState(saved);
        setSyncStatus("Portfolio saved.");
        setSaveError("");
      })
      .catch((error) => {
        setSaveError(getErrorMessage(error, "Portfolio save failed."));
      });
  };

  const setSettings = (next: AppSettings) => {
    setSettingsState(next);
    storage.saveSettings(next);
    if (next.theme) setDark(next.theme === "dark");
    if (!user) return;
    settingsService.save(user.id, next).catch((error) => {
      setSaveError(getErrorMessage(error, "Settings save failed."));
    });
  };

  const selected = data.companies.find((company) => company.profile.ticker === settings.selectedTicker) ?? data.companies[0];

  const refresh = useCallback(async (force = false) => {
    if (!user) return;
    setLoading(true);
    setErrors([]);
    const tickers = portfolio.map((position) => position.ticker);
    try {
      const [companies, news] = await Promise.all([getCompaniesData(tickers, force), getNews(tickers, force)]);
      const next: DashboardData = {
        companies,
        news,
        source: getDashboardSource(companies),
        lastUpdatedAt: new Date().toISOString(),
        errors: companies.flatMap((company) => (company.error ? [`${company.profile.ticker}: ${company.error}`] : [])),
      };
      setData(next);
      storage.saveDashboard(next);
      if (!tickers.includes(settings.selectedTicker) && companies[0]) setSettings({ ...settings, selectedTicker: companies[0].profile.ticker });
    } catch (error) {
      const message = getErrorMessage(error, "Refresh failed");
      const cached = storage.loadDashboard();
      if (cached) setData({ ...cached, source: "cache", errors: [message] });
      setErrors([message]);
    } finally {
      setLoading(false);
    }
  }, [portfolio, settings, user]);

  useEffect(() => {
    if (!user || syncing) return;
    refresh(false);
  }, [portfolio.map((item) => item.ticker).join("|"), user?.id, syncing]);

  useEffect(() => {
    const id = window.setInterval(() => refresh(true), settings.refreshIntervalMinutes * 60 * 1000);
    return () => window.clearInterval(id);
  }, [refresh, settings.refreshIntervalMinutes]);

  const portfolioHealth = useMemo(() => {
    if (!data.companies.length) return 0;
    return Math.round(data.companies.reduce((sum, company) => sum + calculateHealthScore(company).total, 0) / data.companies.length);
  }, [data.companies]);

  const scrollToSection = (id: string) => {
    setActiveNav(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (authLoading) {
    return <div className="dark grid min-h-screen place-items-center bg-slate-950 text-slate-100">Loading secure session...</div>;
  }

  if (!user) {
    return <AuthScreen onAuthenticated={setUser} />;
  }

  return (
    <div className={dark ? "dark" : ""}>
      <div className="min-h-screen bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <aside className="fixed left-0 top-0 hidden h-screen w-64 border-r border-slate-200 bg-slate-950 px-4 py-5 text-white lg:block">
          <div className="mb-7 flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-cyan-400 text-slate-950"><Activity className="h-5 w-5" /></div>
            <div><p className="text-sm font-bold">Equity Health</p><p className="text-xs text-slate-400">Live Intelligence</p></div>
          </div>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeNav === item.id;
            return (
              <button
                key={item.id}
                onClick={() => scrollToSection(item.id)}
                className={cx(
                  "mb-1 flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition",
                  isActive ? "bg-cyan-400 text-slate-950" : "text-slate-300 hover:bg-slate-900 hover:text-white",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </aside>
        <main className="min-w-0 lg:pl-64">
          <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 px-4 py-4 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90 md:px-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-cyan-600 dark:text-cyan-300">Auto-refresh financial data dashboard</p>
                <h1 className="text-xl font-black text-slate-950 dark:text-white md:text-2xl">Financial Health & News Impact Intelligence</h1>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge className={data.source === "live" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : data.source === "cache" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-rose-500/15 text-rose-700 dark:text-rose-300"}>{data.source === "live" ? "Live Data" : data.source === "cache" ? "Cached Data" : "Demo Data"}</Badge>
                  <Badge className="bg-slate-500/15 text-slate-700 dark:text-slate-300">Provider: {marketDataProvider.isConfigured() ? marketDataProvider.label : "Mock fallback"}</Badge>
                  <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">Signed in: {user.email}</Badge>
                  <span className="text-xs text-slate-500">Last updated at {data.lastUpdatedAt ? dateTime(data.lastUpdatedAt) : "not yet refreshed"}</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select value={settings.refreshIntervalMinutes} onChange={(event) => setSettings({ ...settings, refreshIntervalMinutes: Number(event.target.value) as AppSettings["refreshIntervalMinutes"] })} className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold dark:border-slate-700 dark:bg-slate-900">
                  <option value={5}>5 min</option>
                  <option value={15}>15 min</option>
                  <option value={30}>30 min</option>
                  <option value={60}>1 hour</option>
                </select>
                <button onClick={() => refresh(true)} className="inline-flex h-10 items-center gap-2 rounded-md bg-cyan-500 px-3 text-sm font-bold text-slate-950 disabled:opacity-60" disabled={loading}>
                  <RefreshCcw className={cx("h-4 w-4", loading && "animate-spin")} /> Refresh now
                </button>
                <button onClick={() => setDark((value) => !value)} className="grid h-10 w-10 place-items-center rounded-md border border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" aria-label="Toggle dark mode">
                  {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </button>
                <button onClick={() => authService.signOut()} className="h-10 rounded-md border border-slate-300 px-3 text-sm font-bold dark:border-slate-700">Logout</button>
              </div>
            </div>
          </header>

          <div id="dashboard" className="grid scroll-mt-28 gap-4 p-4 md:p-6">
            {(errors.length > 0 || data.errors.length > 0) && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>{[...errors, ...data.errors].slice(0, 3).join(" · ")}. Showing the latest available cached/demo data.</div>
              </div>
            )}
            {(syncing || syncStatus || saveError) && (
              <div className={cx("rounded-lg border p-3 text-sm", saveError ? "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200" : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200")}>
                {saveError || (syncing ? "Syncing portfolio and settings from database..." : syncStatus)}
              </div>
            )}
            {loading && <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-sm font-semibold text-cyan-800 dark:border-cyan-900/60 dark:bg-cyan-950/30 dark:text-cyan-200">Refreshing market data, financial statements, and news...</div>}
            <div id="watchlist" className="grid scroll-mt-28 gap-4 xl:grid-cols-[1fr_280px]">
              <PortfolioManager portfolio={portfolio} setPortfolio={setPortfolio} selectedTicker={settings.selectedTicker} setSelectedTicker={(ticker) => setSettings({ ...settings, selectedTicker: ticker })} companies={data.companies} />
              <Card id="portfolio-risk" className="scroll-mt-28">
                <SectionTitle icon={Gauge} title="Portfolio Pulse" />
                <div className="grid gap-3">
                  <MetricCard label="Avg Health" value={`${portfolioHealth}/100`} sub="Across loaded tickers" />
                  <MetricCard label="Live Coverage" value={`${data.companies.filter((company) => company.source === "live").length}/${portfolio.length}`} sub="Falls back safely" />
                  <MetricCard label="News Items" value={number(data.news.length, 0)} sub="Filtered below" />
                </div>
              </Card>
            </div>
            <div id="company-analysis" className="scroll-mt-28">
              {selected ? <CompanyOverview company={selected} news={data.news} /> : <Card><p>No ticker loaded yet. Add a ticker to begin.</p></Card>}
            </div>
            <div id="news-intelligence" className="scroll-mt-28">
              <NewsPanel news={data.news} settings={settings} setSettings={setSettings} companies={data.companies} />
            </div>
            <Card id="alerts" className="scroll-mt-28">
              <SectionTitle icon={Bell} title="Reliability Notes" action={<button onClick={() => setSettings({ ...defaultSettings, selectedTicker: settings.selectedTicker })} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold dark:border-slate-700"><X className="h-3 w-3" /> Reset filters</button>} />
              <div className="grid gap-3 text-sm text-slate-600 dark:text-slate-300 md:grid-cols-3">
                <p>Portfolio and settings are stored in Supabase PostgreSQL per authenticated user. LocalStorage is only a migration/cache fallback.</p>
                <p>Refresh uses API data when configured, cached data when APIs fail, and demo data when no API key is available.</p>
                <p>Signal, health score, valuation, news impact, and P/L are recalculated after each manual or scheduled refresh.</p>
              </div>
            </Card>
          </div>
        </main>
      </div>
    </div>
  );
}
