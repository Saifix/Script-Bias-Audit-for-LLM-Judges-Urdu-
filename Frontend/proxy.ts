// Runs before every request: everything except the login page requires a valid session.
import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, sessionUser } from "./lib/session";

const PUBLIC = new Set(["/login", "/api/auth/login", "/icon.svg"]);

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC.has(pathname)) return NextResponse.next();
  if (await sessionUser(req.cookies.get(COOKIE)?.value)) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ detail: "Not signed in" }, { status: 401 });
  }
  // Build the redirect from the public host/proto (correct behind Caddy or any reverse proxy).
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  const url = new URL("/login", `${proto}://${host}`);
  if (pathname !== "/") url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url, 307);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
