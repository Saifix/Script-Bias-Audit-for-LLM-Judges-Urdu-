// Server-side proxy: browser -> /api/* -> backend (internal Docker network only).
// Checks the session again (defence in depth), blocks cross-site POSTs, and adds the shared
// backend token + the signed-in username. The browser never sees the token or the OpenRouter key.
import type { NextRequest } from "next/server";
import { COOKIE, sameOrigin, sessionUser } from "../../../lib/session";

export const dynamic = "force-dynamic";

const BACKEND = process.env.BACKEND_URL || "http://backend:8000";

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const user = await sessionUser(req.cookies.get(COOKIE)?.value);
  if (!user) return Response.json({ detail: "Not signed in" }, { status: 401 });
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  if (hasBody && !sameOrigin(req.headers)) return Response.json({ detail: "Bad origin" }, { status: 403 });
  const token = process.env.BACKEND_TOKEN ?? "";
  if (token.length < 32) return Response.json({ detail: "BACKEND_TOKEN is not configured on the server." }, { status: 503 });

  const { path } = await ctx.params;
  const url = `${BACKEND}/api/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;
  const headers: Record<string, string> = { "x-backend-token": token, "x-auth-user": user };
  if (hasBody) headers["content-type"] = req.headers.get("content-type") ?? "application/json";
  try {
    const r = await fetch(url, { method: req.method, headers, body: hasBody ? await req.text() : undefined, cache: "no-store" });
    const out = new Headers({ "content-type": r.headers.get("content-type") ?? "application/json", "cache-control": "no-store" });
    const cd = r.headers.get("content-disposition");
    if (cd) out.set("content-disposition", cd);
    return new Response(r.body, { status: r.status, headers: out });
  } catch {
    return Response.json({ detail: "Backend unreachable" }, { status: 502 });
  }
}

export { proxy as GET, proxy as POST };
