import { NextResponse } from "next/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function jsonError(
  message: string,
  status: number,
  headers?: Record<string, string>,
) {
  return NextResponse.json({ error: message }, { status, headers });
}

export function internalError(message: string) {
  return jsonError(message, 500);
}

/**
 * Compares the browser-sent Origin with the origin of the request URL that
 * Next.js reconstructs from the platform-validated Host. A missing or
 * mismatching Origin is rejected; no address is hard-coded.
 */
export function rejectIfCrossOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") {
    return jsonError("허용되지 않은 요청입니다.", 403);
  }

  try {
    if (new URL(origin).origin === new URL(request.url).origin) return null;
  } catch {
    // fall through to rejection
  }
  return jsonError("허용되지 않은 요청입니다.", 403);
}

/**
 * On Vercel, x-vercel-forwarded-for / x-forwarded-for are set by the platform
 * and client-supplied values are overwritten (not forwarded):
 * https://vercel.com/docs/headers/request-headers#x-forwarded-for
 * Outside Vercel these headers are client-controlled, so they are ignored.
 */
export function getClientIp(request: Request) {
  if (!process.env.VERCEL) return "local";

  const raw =
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for") ??
    "";
  const ip = raw.split(",")[0]?.trim();
  return ip && ip.length <= 64 ? ip : "unknown";
}

export async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
  } catch {
    // invalid JSON
  }
  return null;
}
