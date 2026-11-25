import { adminDeleteAll, adminListMemos } from "@/lib/memoApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return adminListMemos();
}

export async function DELETE(request: Request) {
  return adminDeleteAll(request);
}

export async function POST(request: Request) {
  return adminDeleteAll(request);
}
