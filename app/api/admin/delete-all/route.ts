import { adminDeleteAll } from "@/lib/memoApi";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return adminDeleteAll(request);
}
