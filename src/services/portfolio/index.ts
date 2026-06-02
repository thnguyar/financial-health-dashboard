import type { PortfolioPosition } from "../../types";
import { requireSupabase } from "../database/client";
import { storage } from "../storage";

type PortfolioRow = {
  id: string;
  user_id: string;
  name: string;
  base_currency: string;
};

type PositionRow = {
  id: string;
  portfolio_id: string;
  ticker: string;
  company_name: string | null;
  shares: number | string;
  average_cost: number | string;
  purchase_date: string | null;
  notes: string | null;
  created_at: string;
};

const createId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const fromPositionRow = (row: PositionRow): PortfolioPosition => ({
  id: row.id,
  portfolioId: row.portfolio_id,
  ticker: row.ticker,
  companyName: row.company_name ?? undefined,
  shares: Number(row.shares) || 0,
  averageCost: Number(row.average_cost) || 0,
  purchaseDate: row.purchase_date ?? new Date().toISOString().slice(0, 10),
  notes: row.notes ?? undefined,
  addedAt: row.created_at,
});

const toPositionPayload = (portfolioId: string, userId: string, position: PortfolioPosition) => {
  const payload = {
    id: position.id || createId(),
    portfolio_id: portfolioId,
    user_id: userId,
    ticker: position.ticker.toUpperCase(),
    company_name: position.companyName ?? null,
    shares: position.shares,
    average_cost: position.averageCost,
    purchase_date: position.purchaseDate || null,
    notes: position.notes ?? null,
    updated_at: new Date().toISOString(),
  };
  return payload;
};

export const portfolioService = {
  getOrCreateDefaultPortfolio: async (userId: string) => {
    const client = requireSupabase();
    const { data, error } = await client.from("portfolios").select("*").eq("user_id", userId).order("created_at").limit(1).maybeSingle();
    if (error) throw error;
    if (data) return data as PortfolioRow;

    const { data: created, error: createError } = await client
      .from("portfolios")
      .insert({ user_id: userId, name: "Default Portfolio", base_currency: "USD" })
      .select("*")
      .single();
    if (createError) throw createError;
    return created as PortfolioRow;
  },
  loadPositions: async (userId: string): Promise<PortfolioPosition[]> => {
    const client = requireSupabase();
    const portfolio = await portfolioService.getOrCreateDefaultPortfolio(userId);
    const { data, error } = await client
      .from("portfolio_positions")
      .select("*")
      .eq("user_id", userId)
      .eq("portfolio_id", portfolio.id)
      .order("created_at");
    if (error) throw error;
    return (data as PositionRow[]).map(fromPositionRow);
  },
  savePositions: async (userId: string, positions: PortfolioPosition[]) => {
    const client = requireSupabase();
    const portfolio = await portfolioService.getOrCreateDefaultPortfolio(userId);
    const { data: existing, error: existingError } = await client
      .from("portfolio_positions")
      .select("id,ticker")
      .eq("user_id", userId)
      .eq("portfolio_id", portfolio.id);
    if (existingError) throw existingError;

    const normalized = positions.map((position) => ({ ...position, ticker: position.ticker.toUpperCase(), portfolioId: portfolio.id }));
    const keepTickers = new Set(normalized.map((position) => position.ticker));
    const deleteIds = (existing ?? []).filter((row) => !keepTickers.has(row.ticker)).map((row) => row.id);
    if (deleteIds.length) {
      const { error } = await client.from("portfolio_positions").delete().in("id", deleteIds).eq("user_id", userId);
      if (error) throw error;
    }

    const payload = normalized.map((position) => toPositionPayload(portfolio.id, userId, position));
    if (!payload.length) return [];
    const { data, error } = await client.from("portfolio_positions").upsert(payload, { onConflict: "user_id,portfolio_id,ticker" }).select("*");
    if (error) throw error;
    return (data as PositionRow[]).map(fromPositionRow);
  },
  migrateLocalPortfolio: async (userId: string) => {
    const local = storage.loadPortfolio();
    if (!local.length) return [];
    const remote = await portfolioService.loadPositions(userId);
    const byTicker = new Map(remote.map((position) => [position.ticker, position]));
    local.forEach((position) => {
      const ticker = position.ticker.toUpperCase();
      if (!byTicker.has(ticker)) byTicker.set(ticker, { ...position, ticker });
    });
    const merged = [...byTicker.values()];
    return portfolioService.savePositions(userId, merged);
  },
};
