import "server-only";

import { createHmac, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const ADMIN_COOKIE = "mindlet_admin";
export const ADMIN_SESSION_SECONDS = 60 * 60 * 8;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function sessionSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "ADMIN_SESSION_SECRET 환경 변수가 없거나 32자보다 짧습니다.",
    );
  }
  return secret;
}

function tokenVerifier(token: string) {
  return createHmac("sha256", sessionSecret()).update(token).digest("hex");
}

export const adminCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
};

export async function createAdminSession() {
  const token = randomBytes(32).toString("base64url");
  const supabase = getSupabaseAdmin();
  const now = new Date();
  const verifier = tokenVerifier(token);

  await supabase
    .from("admin_sessions")
    .delete()
    .lt("expires_at", now.toISOString());

  const { error } = await supabase.from("admin_sessions").insert({
    token_hash: verifier,
    expires_at: new Date(
      now.getTime() + ADMIN_SESSION_SECONDS * 1000,
    ).toISOString(),
  });
  if (error) throw error;

  return token;
}

async function currentToken() {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  return token && TOKEN_PATTERN.test(token) ? token : null;
}

export async function isAdminRequest() {
  const token = await currentToken();
  if (!token) return false;

  const { data, error } = await getSupabaseAdmin()
    .from("admin_sessions")
    .select("token_hash")
    .eq("token_hash", tokenVerifier(token))
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw error;

  return Boolean(data);
}

export async function revokeAdminSession() {
  const token = await currentToken();
  if (!token) return;

  const { error } = await getSupabaseAdmin()
    .from("admin_sessions")
    .delete()
    .eq("token_hash", tokenVerifier(token));
  if (error) throw error;
}
