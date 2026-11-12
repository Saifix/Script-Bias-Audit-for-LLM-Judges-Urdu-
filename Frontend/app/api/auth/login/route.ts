// POST {username, password} -> sets the session cookie. Rate-limited per IP and per username.
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, MAX_AGE, MIN_SECRET, parseUsers, sameOrigin, signSession } from "../../../../lib/session";

export const dynamic = "force-dynamic";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 8;
const fails = new Map<string, { n: number; until: number }>();

function blocked(key: string): boolean {
  const f = fails.get(key);
  return !!f && f.n >= MAX_FAILS && f.until > Date.now();
}
function fail(key: string) {
  const f = fails.get(key);
  const fresh = !f || f.until < Date.now();
  fails.set(key, { n: fresh ? 1 : f!.n + 1, until: Date.now() + WINDOW_MS });
  if (fails.size > 10_000) fails.clear(); // bound memory
}
const sha = (s: string) => createHash("sha256").update(s).digest();
const safeEqual = (a: string, b: string) => timingSafeEqual(sha(a), sha(b));

export async function POST(req: NextRequest) {
  const secret = process.env.SESSION_SECRET ?? "";
  const users = parseUsers();
  if (secret.length < MIN_SECRET || users.size === 0) {
    return NextResponse.json({ detail: "Login is not configured on the server (set APP_USERS and SESSION_SECRET)." }, { status: 503 });
  }
  if (!sameOrigin(req.headers)) return NextResponse.json({ detail: "Bad origin" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const username = String(body?.username ?? "").trim().slice(0, 100);
  const password = String(body?.password ?? "").slice(0, 200);
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
  const keys = [`ip:${ip}`, `user:${username.toLowerCase()}`];
  if (keys.some(blocked)) {
    return NextResponse.json({ detail: "Too many attempts. Try again in 15 minutes." }, { status: 429 });
  }

  const expected = users.get(username);
  const ok = safeEqual(password, expected ?? "\u0000invalid") && expected !== undefined;
  if (!ok) {
    keys.forEach(fail);
    await new Promise((r) => setTimeout(r, 400));
    return NextResponse.json({ detail: "Invalid username or password." }, { status: 401 });
  }
  keys.forEach((k) => fails.delete(k));

  const res = NextResponse.json({ ok: true, user: username });
  res.cookies.set(COOKIE, await signSession(username, secret), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true" || req.headers.get("x-forwarded-proto") === "https",
    path: "/",
    maxAge: MAX_AGE,
  });
  return res;
}
