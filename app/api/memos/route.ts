import { NextResponse } from "next/server";
import { createMemo } from "@/lib/memoApi";
import { getSupabaseServerAnon } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { data, error } = await getSupabaseServerAnon()
      .from("memos")
      .select("id,title,content,color,position,created_at,updated_at")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return NextResponse.json({ memos: data ?? [] });
  } catch (error) {
    console.error("GET /api/memos", error);
    return NextResponse.json(
      { error: "메모 목록을 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  return createMemo(request);
}
