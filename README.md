# Equity Health Intelligence Dashboard

Production-ready React/Vite dashboard with Supabase Auth/PostgreSQL and Vercel Serverless API proxy.

## Final Architecture

- Frontend: React + TypeScript + Vite + Tailwind + Recharts.
- Auth: Supabase Auth with email/password, sign up, logout, password reset email.
- Database: Supabase PostgreSQL with Row Level Security.
- API Proxy: Vercel Functions under `api/` for market/news provider calls.
- Local dev proxy: Vite proxies `/api/*` to local Express server on `127.0.0.1:8787`.
- Source of truth: Supabase tables for portfolio, watchlist, settings, and user profile.
- Fallback only: localStorage is used for one-time migration and short-lived cached/demo data, not as the primary database.

## Local Setup

```bash
cd /Users/nguyenvy/Documents/Codex/2026-05-31/b-n-l-m-t-senior/outputs/financial-health-dashboard
node .tools/npm/bin/npm-cli.js install
cp .env.example .env
```

Fill `.env`:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_public_anon_key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_server_only_service_role_key
FMP_API_KEY=your_fmp_key
FINNHUB_API_KEY=your_finnhub_key
POLYGON_API_KEY=your_polygon_key
API_PORT=8787
API_CACHE_TTL_MS=600000
API_RATE_LIMIT=90
API_RATE_WINDOW_MS=60000
ALLOWED_ORIGIN=http://127.0.0.1:5174
```

Run frontend + local API proxy:

```bash
node .tools/npm/bin/npm-cli.js run dev:full
```

Open:

```text
http://127.0.0.1:5174/
```

Build:

```bash
node .tools/npm/bin/npm-cli.js run build
```

## Supabase Setup

1. Create a Supabase project.
2. Open SQL Editor.
3. Run [supabase/migrations/001_initial_schema.sql](./supabase/migrations/001_initial_schema.sql).
4. In Authentication settings, enable Email provider.
5. Copy Project URL and anon key into `.env` as `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

Tables created:

- `profiles`
- `portfolios`
- `portfolio_positions`
- `watchlist_items`
- `user_settings`
- `market_data_cache`

RLS behavior:

- Users can only read/write their own profile, portfolio, positions, watchlist, and settings.
- Authenticated users can read `market_data_cache`.
- Provider/service role writes for shared market cache should happen server-side only. Do not expose a service role key to the frontend.

## Vercel Deployment

This project remains Vite for the frontend and uses Vercel Functions in `api/`.

1. Push this project to GitHub.
2. Import the repo in Vercel.
3. Set Framework Preset to Vite.
4. Build command: `npm run build`
5. Output directory: `dist`
6. Add environment variables in Vercel:

```env
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
FMP_API_KEY
FINNHUB_API_KEY
POLYGON_API_KEY
API_CACHE_TTL_MS
API_RATE_LIMIT
API_RATE_WINDOW_MS
```

`vercel.json` is included and rewrites SPA routes to `index.html`.

## Internal API Proxy

Frontend calls internal endpoints only:

```text
/api/market/quote?ticker=AAPL
/api/market/profile?ticker=AAPL
/api/market/financials?ticker=AAPL
/api/market/ratios?ticker=AAPL
/api/news?ticker=AAPL
/api/health
```

Server functions validate ticker input, apply basic per-IP rate limit, cache responses in warm function memory, and return clear errors. If provider APIs fail, the frontend falls back to database/browser cache or demo data.
If `SUPABASE_SERVICE_ROLE_KEY` is configured, server functions also read/write shared provider responses in `market_data_cache`.

Provider keys are server-only:

- `FMP_API_KEY`
- `FINNHUB_API_KEY`
- `POLYGON_API_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Do not create `VITE_FMP_API_KEY`, `VITE_FINNHUB_API_KEY`, or `VITE_POLYGON_API_KEY`.
Never expose `SUPABASE_SERVICE_ROLE_KEY` in frontend code.

## Login and Portfolio Sync Testing

1. Start the app.
2. Sign up with email/password.
3. Log in.
4. Add a ticker position.
5. Edit shares, average cost, and purchase date.
6. Reload the browser. The portfolio should reload from Supabase.
7. Log out.
8. Sign in as another user. The previous user portfolio should not appear.
9. If old localStorage positions exist, first login migrates non-duplicate tickers to the database.

## Data State Meaning

- `Live Data`: backend proxy/provider returned fresh market data.
- `Cached Data`: app used cached provider/company/news data after a provider issue.
- `Demo Data`: no provider key/cache is available, so generated/mock data is shown.

## Production Checklist

- Run production build successfully.
- Run Supabase migration.
- Confirm RLS is enabled on user-owned tables.
- Confirm Vercel env vars are set.
- Confirm provider keys are not prefixed with `VITE_`.
- Test `/api/health` after deploy.
- Test login/sign up/logout.
- Test portfolio CRUD and browser reload persistence.
- Test second user isolation.
- Test invalid ticker returns clear API error.
- Review provider API quota and raise `API_RATE_LIMIT` conservatively.

## Remaining Limits and Next Steps

- Shared market-data cache writes require `SUPABASE_SERVICE_ROLE_KEY`. Without it, cache still works in warm serverless memory and browser fallback cache.
- Watchlist service exists, but the current UI still centers on portfolio positions. A dedicated watchlist UI can be added next.
- Bundle is large due to Recharts/Supabase; code splitting can reduce initial load.
- Add integration tests with seeded Supabase test users before public launch.
