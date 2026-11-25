import { adminDeleteMemo } from "@/lib/memoApi";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return adminDeleteMemo(request);
}
