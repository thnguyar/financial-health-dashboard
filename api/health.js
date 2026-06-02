export default function handler(_req, res) {
  res.status(200).json({
    ok: true,
    runtime: "vercel-serverless",
    fmpConfigured: Boolean(process.env.FMP_API_KEY),
    finnhubConfigured: Boolean(process.env.FINNHUB_API_KEY),
    polygonConfigured: Boolean(process.env.POLYGON_API_KEY),
    googleFinanceConfigured: true,
    yahooFinanceNewsConfigured: true,
  });
}
