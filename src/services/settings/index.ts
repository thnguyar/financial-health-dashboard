import type { AppSettings } from "../../types";
import { defaultSettings } from "../storage";
import { requireSupabase } from "../database/client";

type SettingsRow = {
  user_id: string;
  refresh_interval_minutes: number;
  theme: string;
  default_currency: string;
};

const fromRow = (row: SettingsRow | null): AppSettings => ({
  ...defaultSettings,
  refreshIntervalMinutes: (row?.refresh_interval_minutes ?? defaultSettings.refreshIntervalMinutes) as AppSettings["refreshIntervalMinutes"],
  theme: row?.theme === "light" ? "light" : "dark",
  defaultCurrency: row?.default_currency ?? "USD",
});

export const settingsService = {
  load: async (userId: string): Promise<AppSettings> => {
    const client = requireSupabase();
    const { data, error } = await client.from("user_settings").select("*").eq("user_id", userId).maybeSingle();
    if (error) throw error;
    if (!data) {
      await settingsService.save(userId, defaultSettings);
      return defaultSettings;
    }
    return fromRow(data as SettingsRow);
  },
  save: async (userId: string, settings: AppSettings) => {
    const client = requireSupabase();
    const { error } = await client.from("user_settings").upsert({
      user_id: userId,
      refresh_interval_minutes: settings.refreshIntervalMinutes,
      theme: settings.theme ?? "dark",
      default_currency: settings.defaultCurrency ?? "USD",
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  },
};
