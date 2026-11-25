import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let adminClient: SupabaseClient | null = null;

function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} 환경 변수가 설정되지 않았습니다.`);
  }
  return value;
}

export function getSupabaseAdmin() {
  if (adminClient) return adminClient;

  const url = getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const secretKey = getRequiredEnv("SUPABASE_SECRET_KEY");

  adminClient = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return adminClient;
}

export function getSupabaseServerAnon() {
  const url = getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const publishableKey = getRequiredEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
