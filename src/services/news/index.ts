import { newsItems } from "../../data/mockData";
import type { ImpactLevel, NewsItem, Sentiment } from "../../types";
import { isCacheFresh, storage } from "../storage";
import { sectorPeers, tickerCatalog } from "../marketData/universe";

const trustedSources = ["Reuters", "Bloomberg", "CNBC", "Financial Times", "Wall Street Journal", "MarketWatch", "Yahoo Finance", "SEC EDGAR"];

const keywordRules: Array<{ words: string[]; sentiment: Sentiment; impact: ImpactLevel; reason: string }> = [
  { words: ["ai", "chip", "semiconductor", "gpu"], sentiment: "Positive", impact: "High", reason: "AI and chip keywords can affect semiconductor peers and hyperscaler capex sentiment." },
  { words: ["ev", "delivery", "price cut", "battery"], sentiment: "Neutral", impact: "High", reason: "EV keywords can move Tesla and peer pricing-power assumptions." },
  { words: ["interest rate", "fed", "credit", "capital"], sentiment: "Neutral", impact: "Medium", reason: "Rate and credit keywords affect banks, valuation multiples, and risk appetite." },
  { words: ["regulation", "antitrust", "export", "sec"], sentiment: "Negative", impact: "High", reason: "Regulatory keywords can trigger multiple compression or revenue restrictions." },
  { words: ["oil", "energy", "opec"], sentiment: "Neutral", impact: "Medium", reason: "Energy keywords can change inflation expectations and sector rotation." },
];

const inferSentiment = (title: string): Sentiment => {
  const text = title.toLowerCase();
  if (/(beat|surge|record|upgrade|strong|growth|raises|approval)/.test(text)) return "Positive";
  if (/(miss|cuts|probe|downgrade|weak|falls|risk|lawsuit|pressure)/.test(text)) return "Negative";
  return "Neutral";
};

const inferImpact = (title: string): ImpactLevel => {
  const text = title.toLowerCase();
  if (/(earnings|guidance|regulation|export|downgrade|upgrade|lawsuit|price cut|rate)/.test(text)) return "High";
  if (/(launch|demand|sales|margin|credit|capex)/.test(text)) return "Medium";
  return "Low";
};

export const enrichNewsItem = (item: NewsItem, portfolioTickers: string[]): NewsItem => {
  const text = `${item.title} ${item.summary}`.toLowerCase();
  const direct = portfolioTickers.find((ticker) => text.includes(ticker.toLowerCase())) ?? item.directTicker;
  const directMeta = tickerCatalog.find((ticker) => ticker.ticker === direct);
  const industry = directMeta?.industry ?? item.sector ?? "Software & Cloud";
  const peers = sectorPeers[industry] ?? [];
  const matchedRule = keywordRules.find((rule) => rule.words.some((word) => text.includes(word)));
  const related = [...new Set([direct, ...item.relatedTickers, ...peers.filter((ticker) => ticker !== direct).slice(0, 4)])];
  return {
    ...item,
    directTicker: direct,
    sector: directMeta?.sector ?? industry,
    sentiment: item.sentiment ?? matchedRule?.sentiment ?? inferSentiment(item.title),
    impact: item.impact ?? matchedRule?.impact ?? inferImpact(item.title),
    relatedTickers: related,
    keywords: matchedRule?.words ?? [],
    reason: matchedRule ? `${item.reason} ${matchedRule.reason}` : item.reason,
  };
};

const getProxyNews = async (tickers: string[]): Promise<NewsItem[]> => {
  const batches = await Promise.all(
    tickers.slice(0, 8).map(async (ticker) => {
      const response = await fetch(`/api/news?ticker=${encodeURIComponent(ticker)}`);
      const envelope = (await response.json()) as { data?: Array<Record<string, any>>; error?: string };
      if (!response.ok && !envelope.data) throw new Error(envelope.error || `News proxy HTTP ${response.status}`);
      const rows = envelope.data ?? [];
      return rows.slice(0, 8).map((row, index): NewsItem => ({
        id: row.id ? String(row.id) : `${ticker}-${index}`,
        title: row.title ?? row.headline ?? "Untitled company news",
        source: row.site ?? row.source ?? "Market News",
        publishedAt: row.publishedDate ? new Date(row.publishedDate).toISOString() : row.datetime ? new Date(Number(row.datetime) * 1000).toISOString() : new Date().toISOString(),
        summary: row.text ?? row.summary ?? row.title ?? row.headline ?? "",
        sentiment: inferSentiment(row.title ?? row.headline ?? ""),
        impact: inferImpact(`${row.title ?? row.headline ?? ""} ${row.text ?? row.summary ?? ""}`),
        relatedTickers: row.symbol ? String(row.symbol).split(",").map((symbol) => symbol.trim()).filter(Boolean) : [ticker],
        directTicker: row.symbol ? String(row.symbol).split(",")[0].trim() : ticker,
        reason: "Company-news provider mentioned the ticker directly; impact is enriched with keyword and sector rules.",
      }));
    }),
  );
  return batches.flat();
};

export const getNews = async (tickers: string[], force = false): Promise<NewsItem[]> => {
  const cached = storage.loadNews();
  const newest = cached[0]?.publishedAt;
  if (!force && cached.length && isCacheFresh(newest, 15)) return cached;

  try {
    const live = await getProxyNews(tickers);
    const enriched = live.map((item) => enrichNewsItem(item, tickers)).filter((item) => trustedSources.includes(item.source) || item.source);
    storage.saveNews(enriched);
    return enriched;
  } catch {
    const fallback = (cached.length ? cached : newsItems).map((item) => enrichNewsItem(item, tickers));
    storage.saveNews(fallback);
    return fallback;
  }
};
