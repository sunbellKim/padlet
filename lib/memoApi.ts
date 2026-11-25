import "server-only";

import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  ADMIN_SESSION_SECONDS,
  adminCookieOptions,
  createAdminSession,
  isAdminRequest,
  revokeAdminSession,
} from "@/lib/adminSession";
import { isAllowedColor, randomPastelColor } from "@/lib/colors";
import { hashPassword, isBcryptHash, isFourDigitPassword, verifyPassword } from "@/lib/password";
import { RATE_LIMITS, hitRateLimit, resetRateLimit } from "@/lib/rateLimit";
import {
  getClientIp,
  internalError,
  isUuid,
  jsonError,
  readJsonObject,
  rejectIfCrossOrigin,
} from "@/lib/requestSecurity";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const MEMO_COLUMNS = "id,title,content,color,position,created_at,updated_at";

function tooMany(windowSeconds: number) {
  return jsonError("요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", 429, {
    "Retry-After": String(windowSeconds),
  });
}

export async function createMemo(request: Request) {
  const blocked = rejectIfCrossOrigin(request);
  if (blocked) return blocked;

  try {
    const ip = getClientIp(request);
    if (!(await hitRateLimit(`create:${ip}`, RATE_LIMITS.create))) {
      return tooMany(RATE_LIMITS.create.windowSeconds);
    }

    const body = await readJsonObject(request);
    if (!body) return jsonError("잘못된 요청입니다.", 400);

    const title = typeof body.title === "string" ? body.title.trim() : "";
    const content = typeof body.content === "string" ? body.content.trim() : "";

    if (!title || !content) {
      return jsonError("제목과 내용을 모두 입력해 주세요.", 400);
    }
    if (title.length > 80 || content.length > 2000) {
      return jsonError("메모가 허용된 길이를 초과했습니다.", 400);
    }
    if (!isFourDigitPassword(body.password)) {
      return jsonError("삭제 비밀번호는 숫자 4자리여야 합니다.", 400);
    }

    let color: string;
    if (body.color === undefined || body.color === null || body.color === "") {
      color = randomPastelColor();
    } else if (isAllowedColor(body.color)) {
      color = body.color;
    } else {
      return jsonError("허용되지 않은 색상입니다.", 400);
    }

    const passwordHash = await hashPassword(body.password);
    const { data, error } = await getSupabaseAdmin().rpc(
      "create_memo_with_credentials",
      {
        p_title: title,
        p_content: content,
        p_color: color,
        p_password_hash: passwordHash,
      },
    );
    if (error) throw error;

    return NextResponse.json({ memo: data }, { status: 201 });
  } catch (error) {
    console.error("create memo failed", error);
    return internalError("메모를 저장하지 못했습니다.");
  }
}

export async function deleteMemoWithPassword(request: Request, idFromPath?: string) {
  const blocked = rejectIfCrossOrigin(request);
  if (blocked) return blocked;

  try {
    const ip = getClientIp(request);
    const body = await readJsonObject(request);
    if (!body) return jsonError("잘못된 요청입니다.", 400);

    const id = idFromPath ?? body.id;
    if (!isUuid(id) || !isFourDigitPassword(body.password)) {
      return jsonError("메모와 숫자 4자리 비밀번호를 확인해 주세요.", 400);
    }

    if (!(await hitRateLimit(`delete:${ip}`, RATE_LIMITS.delete))) {
      return tooMany(RATE_LIMITS.delete.windowSeconds);
    }
    const failKey = `delete-fail:${id}:${ip}`;
    if (!(await hitRateLimit(failKey, RATE_LIMITS.deleteFail))) {
      return tooMany(RATE_LIMITS.deleteFail.windowSeconds);
    }

    const supabase = getSupabaseAdmin();
    const { data: credential, error: readError } = await supabase
      .from("memo_credentials")
      .select("password_hash")
      .eq("memo_id", id)
      .maybeSingle();
    if (readError) throw readError;
    if (!credential) return jsonError("메모를 찾을 수 없습니다.", 404);

    if (!(await verifyPassword(body.password, credential.password_hash))) {
      return jsonError("삭제 비밀번호가 일치하지 않습니다.", 403);
    }

    const { error: deleteError } = await supabase.from("memos").delete().eq("id", id);
    if (deleteError) throw deleteError;

    await resetRateLimit(failKey);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("delete memo failed", error);
    return internalError("메모를 삭제하지 못했습니다.");
  }
}

export async function adminLogin(request: Request) {
  const blocked = rejectIfCrossOrigin(request);
  if (blocked) return blocked;

  try {
    const adminHash = process.env.ADMIN_PASSWORD_HASH;
    if (!adminHash || !isBcryptHash(adminHash)) {
      console.error("ADMIN_PASSWORD_HASH is missing or not a bcrypt hash");
      return internalError("관리자 설정을 확인해 주세요.");
    }

    const limitKey = `admin-login:${getClientIp(request)}`;
    if (!(await hitRateLimit(limitKey, RATE_LIMITS.adminLogin))) {
      return tooMany(RATE_LIMITS.adminLogin.windowSeconds);
    }

    const body = await readJsonObject(request);
    if (
      !body ||
      typeof body.password !== "string" ||
      body.password.length === 0 ||
      body.password.length > 200
    ) {
      return jsonError("잘못된 요청입니다.", 400);
    }

    if (!(await verifyPassword(body.password, adminHash))) {
      return jsonError("관리자 비밀번호가 일치하지 않습니다.", 401);
    }

    const token = await createAdminSession();
    await resetRateLimit(limitKey);

    const response = NextResponse.json({ ok: true });
    response.cookies.set(ADMIN_COOKIE, token, {
      ...adminCookieOptions,
      maxAge: ADMIN_SESSION_SECONDS,
    });
    return response;
  } catch (error) {
    console.error("admin login failed", error);
    return internalError("관리자 로그인에 실패했습니다.");
  }
}

export async function adminLogout(request: Request) {
  const blocked = rejectIfCrossOrigin(request);
  if (blocked) return blocked;

  try {
    await revokeAdminSession();
  } catch (error) {
    console.error("admin session revoke failed", error);
    return internalError("로그아웃하지 못했습니다.");
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE, "", { ...adminCookieOptions, maxAge: 0 });
  return response;
}

export async function adminSessionStatus() {
  try {
    return NextResponse.json({ isAdmin: await isAdminRequest() });
  } catch (error) {
    console.error("admin session check failed", error);
    return NextResponse.json({ isAdmin: false });
  }
}

async function requireAdmin(request: Request) {
  const blocked = rejectIfCrossOrigin(request);
  if (blocked) return blocked;

  if (!(await isAdminRequest())) {
    return jsonError("관리자 인증이 필요합니다.", 401);
  }
  return null;
}

export async function adminListMemos() {
  try {
    if (!(await isAdminRequest())) {
      return jsonError("관리자 인증이 필요합니다.", 401);
    }
    const { data, error } = await getSupabaseAdmin()
      .from("memos")
      .select(MEMO_COLUMNS)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ memos: data ?? [] });
  } catch (error) {
    console.error("admin list memos failed", error);
    return internalError("메모 목록을 불러오지 못했습니다.");
  }
}

export async function adminDeleteMemo(request: Request, idFromPath?: string) {
  try {
    const denied = await requireAdmin(request);
    if (denied) return denied;

    let id: unknown = idFromPath;
    if (id === undefined) {
      const body = await readJsonObject(request);
      id = body?.id;
    }
    if (!isUuid(id)) return jsonError("잘못된 요청입니다.", 400);

    const { error } = await getSupabaseAdmin().from("memos").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("admin delete memo failed", error);
    return internalError("메모를 강제 삭제하지 못했습니다.");
  }
}

export async function adminDeleteAll(request: Request) {
  try {
    const denied = await requireAdmin(request);
    if (denied) return denied;

    const { error } = await getSupabaseAdmin()
      .from("memos")
      .delete()
      .not("id", "is", null);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("admin delete all failed", error);
    return internalError("전체 메모를 삭제하지 못했습니다.");
  }
}
