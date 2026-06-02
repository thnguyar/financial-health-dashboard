import { fetchGoogleFinanceQuote, sendCached } from "../_lib/market.js";

export default function handler(req, res) {
  return sendCached(req, res, "google-quote", (ticker) => fetchGoogleFinanceQuote(ticker));
}
