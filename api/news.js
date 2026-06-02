import { fetchJson, fetchYahooFinanceNews, finnhubUrl, fmpUrl, sendCached } from "./_lib/market.js";

export default function handler(req, res) {
  return sendCached(req, res, "news", (ticker) => {
    if (process.env.FMP_API_KEY) {
      return fetchJson(fmpUrl("/stock_news", { tickers: ticker, limit: 40 }));
    }
    if (!process.env.FINNHUB_API_KEY) {
      return fetchYahooFinanceNews(ticker);
    }
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return fetchJson(finnhubUrl("/company-news", { symbol: ticker, from, to }));
  });
}
