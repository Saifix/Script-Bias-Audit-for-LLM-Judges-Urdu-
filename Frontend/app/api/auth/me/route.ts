import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, sessionUser } from "../../../../lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await sessionUser(req.cookies.get(COOKIE)?.value);
  return user ? NextResponse.json({ user }) : NextResponse.json({ detail: "Not signed in" }, { status: 401 });
}
