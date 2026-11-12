import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, sameOrigin } from "../../../../lib/session";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req.headers)) return NextResponse.json({ detail: "Bad origin" }, { status: 403 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
