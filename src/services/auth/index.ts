import type { Session, User } from "@supabase/supabase-js";
import { requireSupabase, supabase } from "../database/client";

export type AuthState = {
  session: Session | null;
  user: User | null;
};

export const authService = {
  isConfigured: () => Boolean(supabase),
  getSession: async (): Promise<AuthState> => {
    const client = requireSupabase();
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    return { session: data.session, user: data.session?.user ?? null };
  },
  onAuthStateChange: (callback: (state: AuthState) => void) => {
    const client = requireSupabase();
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      callback({ session, user: session?.user ?? null });
    });
    return () => data.subscription.unsubscribe();
  },
  signIn: async (email: string, password: string) => {
    const client = requireSupabase();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  },
  signUp: async (email: string, password: string) => {
    const client = requireSupabase();
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) throw error;
    return data;
  },
  resetPassword: async (email: string) => {
    const client = requireSupabase();
    const { data, error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    if (error) throw error;
    return data;
  },
  signOut: async () => {
    const client = requireSupabase();
    const { error } = await client.auth.signOut();
    if (error) throw error;
  },
};
