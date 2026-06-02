import { requireSupabase } from "../database/client";

export type WatchlistItem = {
  id?: string;
  ticker: string;
  companyName?: string;
  sector?: string;
  createdAt?: string;
};

export const watchlistService = {
  load: async (userId: string): Promise<WatchlistItem[]> => {
    const client = requireSupabase();
    const { data, error } = await client.from("watchlist_items").select("*").eq("user_id", userId).order("created_at");
    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: row.id,
      ticker: row.ticker,
      companyName: row.company_name ?? undefined,
      sector: row.sector ?? undefined,
      createdAt: row.created_at,
    }));
  },
  add: async (userId: string, item: WatchlistItem) => {
    const client = requireSupabase();
    const { error } = await client.from("watchlist_items").upsert(
      {
        user_id: userId,
        ticker: item.ticker.toUpperCase(),
        company_name: item.companyName ?? null,
        sector: item.sector ?? null,
      },
      { onConflict: "user_id,ticker" },
    );
    if (error) throw error;
  },
  remove: async (userId: string, ticker: string) => {
    const client = requireSupabase();
    const { error } = await client.from("watchlist_items").delete().eq("user_id", userId).eq("ticker", ticker.toUpperCase());
    if (error) throw error;
  },
};
