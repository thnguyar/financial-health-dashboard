import { fetchJson, fmpUrl, sendCached } from "../_lib/market.js";

export default function handler(req, res) {
  return sendCached(req, res, "ratios", async (ticker) => {
    const [ratios, metrics] = await Promise.all([
      fetchJson(fmpUrl(`/ratios-ttm/${ticker}`)),
      fetchJson(fmpUrl(`/key-metrics-ttm/${ticker}`)),
    ]);
    return { ratios, metrics };
  });
}
