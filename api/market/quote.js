import { fetchGoogleFinanceQuote, fetchJson, fmpUrl, sendCached } from "../_lib/market.js";

export default function handler(req, res) {
  return sendCached(req, res, "quote", (ticker) => (process.env.FMP_API_KEY ? fetchJson(fmpUrl(`/quote/${ticker}`)) : fetchGoogleFinanceQuote(ticker)));
}
