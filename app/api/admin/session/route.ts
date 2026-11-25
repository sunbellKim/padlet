import { adminSessionStatus } from "@/lib/memoApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return adminSessionStatus();
}
