"use client";
import { useState, type FormEvent } from "react";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!r.ok) {
        setError((await r.json().catch(() => ({}))).detail ?? "Sign-in failed.");
        setBusy(false);
        return;
      }
      const next = new URLSearchParams(window.location.search).get("next") ?? "/";
      window.location.href = next.startsWith("/") && !next.startsWith("//") ? next : "/"; // no open redirect
    } catch {
      setError("Network error.");
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 400, margin: "8vh auto 0" }}>
      <p className="eyebrow">Script-Bias Audit</p>
      <h1 className="title" style={{ fontSize: 36 }}>Sign in</h1>
      <p className="muted" style={{ marginTop: 0 }}>This research platform is private.</p>
      <form className="tile stack" onSubmit={submit}>
        <label className="field">Username
          <input className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
        </label>
        <label className="field">Password
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="notice error" style={{ margin: 0 }}>{error}</p>}
        <button className="btn" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );
}
