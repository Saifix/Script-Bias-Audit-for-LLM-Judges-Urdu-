// Signed session tokens (HMAC-SHA256 via Web Crypto) and the user list from APP_USERS.
// Token = base64url(JSON {u, exp}) + "." + base64url(HMAC(payload)). No server-side session store needed.

export const COOKIE = "sba_session";
export const MAX_AGE = 60 * 60 * 24 * 7; // 7 days
export const MIN_SECRET = 32;
export const MIN_PASSWORD = 12;

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b + "===".slice((b.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** Create a session token for `user`, valid for MAX_AGE seconds. */
export async function signSession(user: string, secret: string, now = Date.now()): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ u: user, exp: Math.floor(now / 1000) + MAX_AGE })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(payload)));
  return `${payload}.${b64url(sig)}`;
}

/** Return the username if `token` is authentic and unexpired, else null. Verification is constant-time. */
export async function verifySession(token: string | undefined, secret: string | undefined, now = Date.now()): Promise<string | null> {
  if (!token || !secret || secret.length < MIN_SECRET) return null;
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64url(sig), enc.encode(payload));
    if (!ok) return null;
    const { u, exp } = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    if (typeof u !== "string" || typeof exp !== "number" || exp * 1000 < now) return null;
    return u;
  } catch {
    return null;
  }
}

/** Users from APP_USERS="alice:password,bob:password". Passwords shorter than MIN_PASSWORD are ignored. */
export function parseUsers(raw: string | undefined = process.env.APP_USERS): Map<string, string> {
  const users = new Map<string, string>();
  for (const pair of (raw ?? "").split(",")) {
    const i = pair.indexOf(":");
    if (i <= 0) continue;
    const name = pair.slice(0, i).trim();
    const pass = pair.slice(i + 1).trim();
    if (name && pass.length >= MIN_PASSWORD) users.set(name, pass);
  }
  return users;
}

/** Signed in as a currently configured user? (Removing a user from APP_USERS revokes their sessions.) */
export async function sessionUser(token: string | undefined): Promise<string | null> {
  const u = await verifySession(token, process.env.SESSION_SECRET);
  return u && parseUsers().has(u) ? u : null;
}

/** For state-changing requests: the browser's Origin must match the host we are served on (CSRF guard). */
export function sameOrigin(headers: Headers): boolean {
  const origin = headers.get("origin");
  if (!origin) return true; // non-browser clients; browsers always send Origin on POST
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
