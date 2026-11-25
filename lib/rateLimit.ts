import "server-only";

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const RATE_LIMITS = {
  create: { limit: 20, windowSeconds: 10 * 60 },
  delete: { limit: 30, windowSeconds: 10 * 60 },
  deleteFail: { limit: 5, windowSeconds: 10 * 60 },
  adminLogin: { limit: 5, windowSeconds: 15 * 60 },
} as const;

/** Counts one attempt atomically. Returns false when over the limit. Throws if the store fails. */
export async function hitRateLimit(
  key: string,
  rule: { limit: number; windowSeconds: number },
) {
  const { data, error } = await getSupabaseAdmin().rpc("rate_limit_hit", {
    p_key: key,
    p_limit: rule.limit,
    p_window_seconds: rule.windowSeconds,
  });
  if (error || typeof data !== "boolean") {
    throw new Error("rate limit store unavailable");
  }
  return data;
}

export async function resetRateLimit(key: string) {
  const { error } = await getSupabaseAdmin().rpc("rate_limit_reset", {
    p_key: key,
  });
  if (error) throw new Error("rate limit store unavailable");
}
