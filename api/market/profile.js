import { fetchJson, fmpUrl, sendCached } from "../_lib/market.js";

export default function handler(req, res) {
  return sendCached(req, res, "profile", (ticker) => fetchJson(fmpUrl(`/profile/${ticker}`)));
}
