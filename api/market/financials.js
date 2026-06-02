import { fetchJson, fmpUrl, sendCached } from "../_lib/market.js";

export default function handler(req, res) {
  return sendCached(req, res, "financials", async (ticker) => {
    const [income, balance, cashflow] = await Promise.all([
      fetchJson(fmpUrl(`/income-statement/${ticker}`, { period: "quarter", limit: 6 })),
      fetchJson(fmpUrl(`/balance-sheet-statement/${ticker}`, { period: "quarter", limit: 6 })),
      fetchJson(fmpUrl(`/cash-flow-statement/${ticker}`, { period: "quarter", limit: 6 })),
    ]);
    return { income, balance, cashflow };
  });
}
