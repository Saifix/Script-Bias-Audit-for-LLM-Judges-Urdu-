"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

const LINKS = [
  ["/", "Overview"],
  ["/demo", "Live demo"],
  ["/data", "Data"],
  ["/review", "Review"],
  ["/runs", "Runs"],
  ["/results", "Results"],
] as const;

/** Light by default; the choice is remembered per browser. */
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.dataset.theme === "dark"), []);
  function flip() {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch { /* storage blocked */ }
    setDark(!dark);
  }
  return (
    <button className="icon-btn" onClick={flip} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} title={dark ? "Light mode" : "Dark mode"}>
      {dark ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4.5" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" /></svg>
      )}
    </button>
  );
}

export function Nav() {
  const path = usePathname();
  const [user, setUser] = useState<string | null>(null);
  const isLogin = path === "/login";
  useEffect(() => {
    if (isLogin) return;
    fetch("/api/auth/me", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => setUser(d?.user ?? null)).catch(() => {});
  }, [isLogin]);
  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }
  return (
    <nav className="nav">
      <div className="nav-inner">
        <Link href="/" className="brand">Script-Bias Audit</Link>
        {!isLogin && (
          <div className="nav-links">
            {LINKS.map(([href, name]) => (
              <Link key={href} href={href} className={(href === "/" ? path === "/" : path.startsWith(href)) ? "active" : ""}>
                {name}
              </Link>
            ))}
          </div>
        )}
        <div className="nav-right">
          <ThemeToggle />
          {user && (
            <>
              <span className="faint nav-user">{user}</span>
              <button className="btn secondary small" onClick={signOut}>Sign out</button>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}

export function Header({ eyebrow, title, lede }: { eyebrow: string; title: ReactNode; lede?: ReactNode }) {
  return (
    <header>
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="title">{title}</h1>
      {lede && <p className="lede">{lede}</p>}
    </header>
  );
}

export function Segmented<T extends string>({ options, value, onChange, disabled }: {
  options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; disabled?: boolean;
}) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={o.value === value} className={o.value === value ? "on" : ""}
          onClick={() => onChange(o.value)} disabled={disabled}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Badge({ kind, children }: { kind: string; children?: ReactNode }) {
  return <span className={`badge ${kind}`}>{children ?? kind}</span>;
}

export function Progress({ value, total }: { value: number; total: number }) {
  const pct = total ? Math.min(100, (100 * value) / total) : 0;
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="tile">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="faint">{sub}</div>}
    </div>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  return error ? <p className="notice error">{error}</p> : null;
}
