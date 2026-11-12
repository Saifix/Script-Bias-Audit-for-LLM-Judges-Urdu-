// Session tokens: valid tokens verify; tampered, expired or wrongly signed ones do not.
import { describe, expect, it } from "vitest";
import { MAX_AGE, parseUsers, sameOrigin, signSession, verifySession } from "../lib/session";

const SECRET = "s".repeat(48);

describe("session", () => {
  it("round-trips a valid token", async () => {
    const t = await signSession("alice", SECRET);
    expect(await verifySession(t, SECRET)).toBe("alice");
  });

  it("rejects tampering, wrong secret, expiry and weak secrets", async () => {
    const t = await signSession("alice", SECRET);
    const [payload, sig] = t.split(".");
    const forged = btoa(JSON.stringify({ u: "admin", exp: 9e9 })).replace(/=+$/, "");
    expect(await verifySession(`${forged}.${sig}`, SECRET)).toBeNull();
    expect(await verifySession(`${payload}.${sig}x`, SECRET)).toBeNull();
    expect(await verifySession(t, "x".repeat(48))).toBeNull();
    expect(await verifySession(t, SECRET, Date.now() + (MAX_AGE + 5) * 1000)).toBeNull();
    expect(await verifySession(t, "short")).toBeNull();
    expect(await verifySession(undefined, SECRET)).toBeNull();
  });

  it("parses users and ignores short passwords", () => {
    const u = parseUsers("alice:correct-horse-battery, bob:short, :nouser, carol:pass:with:colons-ok");
    expect([...u.keys()]).toEqual(["alice", "carol"]);
    expect(u.get("carol")).toBe("pass:with:colons-ok");
  });

  it("checks Origin against Host", () => {
    expect(sameOrigin(new Headers({ host: "audit.example.com", origin: "https://audit.example.com" }))).toBe(true);
    expect(sameOrigin(new Headers({ host: "audit.example.com", origin: "https://evil.example" }))).toBe(false);
    expect(sameOrigin(new Headers({ host: "audit.example.com" }))).toBe(true);
  });
});
