import { NextRequest, NextResponse } from "next/server";
import { refreshConfig, refreshStatus, startRefresh } from "@/lib/backoffice";

export const dynamic = "force-dynamic";

/** Operator-only, localhost-only during the testing phase. */
function localOnly(req: NextRequest): NextResponse | null {
  const host = req.headers.get("host") ?? "";
  if (!host.startsWith("localhost") && !host.startsWith("127.0.0.1")) {
    return NextResponse.json({ error: "Backoffice is localhost-only during the testing phase." }, { status: 403 });
  }
  return null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const guard = localOnly(req);
  if (guard) return guard;
  return NextResponse.json({ configured: refreshConfig() != null, ...refreshStatus() });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = localOnly(req);
  if (guard) return guard;
  const result = startRefresh();
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: result.status ?? 400 });
  return NextResponse.json({ started: true, pid: result.pid });
}
