"use client";

// The browser's Supabase client. It uses the publishable key (public by
// design) plus the signed-in user's Clerk token, so row-level security knows
// who is asking. Realtime asks accessToken() for a token when it connects and
// every 25 s after, so the token must last at least that long.

import { useAuth } from "@clerk/nextjs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { useMemo } from "react";
import { MIN_TOKEN_LIFE_S, tokenSecondsLeft } from "./live";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/** False if the site was built without the two NEXT_PUBLIC_SUPABASE_* variables. */
export const supabaseConfigured = Boolean(url && key);

type GetToken = ReturnType<typeof useAuth>["getToken"];

/** Clerk's token, or a brand-new one if the cached token would expire before Realtime asks again. */
async function freshToken(getToken: GetToken): Promise<string | null> {
  const token = await getToken();
  if (token && tokenSecondsLeft(token, Date.now()) < MIN_TOKEN_LIFE_S) {
    return getToken({ skipCache: true });
  }
  return token;
}

/** One client per signed-in user, or null while signed out or on the server. */
export function useSupabase(): SupabaseClient | null {
  // Clerk keeps getToken the same function for the page's lifetime, so the
  // client (and its live connection) is only rebuilt when the user changes.
  const { userId, getToken } = useAuth();

  return useMemo(() => {
    if (!userId || !url || !key || typeof window === "undefined") return null;
    return createClient(url, key, { accessToken: () => freshToken(getToken) });
  }, [userId, getToken]);
}
