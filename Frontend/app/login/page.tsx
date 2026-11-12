"use client";
import { useState, type FormEvent } from "react";
import { Logo } from "../../components/ui";

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
    <div className="auth-wrap">
      <form className="auth-card glass stack" onSubmit={submit}>
        <div className="brand-big"><Logo size={56} /></div>
        <div style={{ textAlign: "center" }}>
          <h1 className="title" style={{ fontSize: 32, marginBottom: 6 }}>Welcome back</h1>
          <p className="muted" style={{ margin: 0 }}>Sign in to <span className="gradient-text" style={{ fontWeight: 600 }}>Script-Bias Audit</span></p>
        </div>
        <label className="field">Username
          <input className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
        </label>
        <label className="field">Password
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="notice error" style={{ margin: 0 }}>{error}</p>}
        <button className="btn large" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        <p className="faint" style={{ textAlign: "center", margin: 0 }}>Private research platform · access by invitation</p>
      </form>
    </div>
  );
}
