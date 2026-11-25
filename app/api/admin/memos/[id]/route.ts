import { adminDeleteMemo } from "@/lib/memoApi";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, { params }: Context) {
  return adminDeleteMemo(request, (await params).id);
}

export async function POST(request: Request, { params }: Context) {
  return adminDeleteMemo(request, (await params).id);
}
