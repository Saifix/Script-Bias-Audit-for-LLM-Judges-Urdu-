"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

const LINKS = [
  ["/", "Home"],
  ["/data", "Data"],
  ["/runs", "Experiments"],
  ["/results", "Results"],
  ["/trends", "Trends"],
  ["/contributors", "Contributors"],
] as const;

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path.startsWith(href));

/** Brand mark: a balance (a fair judge) on a graphite tile. */
export function Logo({ size = 28 }: { size?: number }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#48484A" /><stop offset="1" stopColor="#1C1C1E" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${id})`} />
      <g fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 8v15M11.5 23.5h9M8.5 11.5h15" />
        <path d="M8.5 11.5 6 17.2a2.6 2.6 0 0 0 5 0z" />
        <path d="M23.5 11.5 21 17.2a2.6 2.6 0 0 0 5 0z" />
      </g>
    </svg>
  );
}

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

/** Floating glass header: brand, segmented nav with a sliding active pill, theme + account. */
export function SiteHeader() {
  const path = usePathname();
  const isLogin = path === "/login";
  const [user, setUser] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);

  useEffect(() => {
    if (isLogin) return;
    fetch("/api/auth/me", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => setUser(d?.user ?? null)).catch(() => {});
  }, [isLogin]);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  useEffect(() => setOpen(false), [path]);
  useLayoutEffect(() => {
    const measure = () => {
      const el = navRef.current?.querySelector<HTMLAnchorElement>("a.active");
      setPill(el ? { x: el.offsetLeft, w: el.offsetWidth } : null);
    };
    measure();
    window.addEventListener("resize", measure);
    document.fonts?.ready.then(measure).catch(() => {});
    return () => window.removeEventListener("resize", measure);
  }, [path, isLogin]);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <header className={`site-header ${scrolled ? "scrolled" : ""}`}>
      <div className="header-bar glass">
        <Link href="/" className="brand"><Logo /><span>Script-Bias Audit</span></Link>
        {!isLogin && (
          <nav className="nav-pill" ref={navRef} aria-label="Main">
            {pill && <span className="nav-indicator" style={{ transform: `translateX(${pill.x}px)`, width: pill.w }} />}
            {LINKS.map(([href, name]) => (
              <Link key={href} href={href} className={isActive(path, href) ? "active" : ""} aria-current={isActive(path, href) ? "page" : undefined}>{name}</Link>
            ))}
          </nav>
        )}
        <div className="header-right">
          <ThemeToggle />
          {user && (
            <div className="user-chip">
              <span className="avatar" aria-hidden="true">{user.slice(0, 1).toUpperCase()}</span>
              <span className="user-name">{user}</span>
              <button className="icon-btn small" onClick={signOut} aria-label="Sign out" title="Sign out">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /></svg>
              </button>
            </div>
          )}
          {!isLogin && (
            <button className="icon-btn menu-btn" onClick={() => setOpen(!open)} aria-label="Menu" aria-expanded={open}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
              </svg>
            </button>
          )}
        </div>
      </div>
      {open && !isLogin && (
        <nav className="mobile-menu glass" aria-label="Main">
          {LINKS.map(([href, name]) => (
            <Link key={href} href={href} className={isActive(path, href) ? "active" : ""}>{name}</Link>
          ))}
          {user && <button className="btn secondary small" onClick={signOut}>Sign out ({user})</button>}
        </nav>
      )}
    </header>
  );
}

export function SiteFooter() {
  const path = usePathname();
  if (path === "/login") return <footer className="site-footer minimal"><span className="faint">© 2026 Script-Bias Audit · Private research platform</span></footer>;
  return (
    <footer className="site-footer">
      <div className="footer-inner glass">
        <div className="footer-brand">
          <Link href="/" className="brand"><Logo size={32} /><span>Script-Bias Audit</span></Link>
          <p className="muted">Is the AI judge fair to Roman Urdu? A university research project measuring script bias in LLM judges.</p>
          <p className="urdu footer-urdu" lang="ur" dir="rtl">منصفانہ جانچ، ہر رسم الخط میں</p>
        </div>
        <div>
          <p className="footer-head">Platform</p>
          {LINKS.map(([href, name]) => <Link key={href} href={href}>{name}</Link>)}
        </div>
        <div>
          <p className="footer-head">Research</p>
          <a href="https://huggingface.co/datasets/facebook/belebele" target="_blank" rel="noreferrer">Belebele dataset</a>
          <span>Lost in the Mix (ACL 2026)</span>
          <a href="https://openrouter.ai" target="_blank" rel="noreferrer">OpenRouter</a>
        </div>
        <div>
          <p className="footer-head">Project</p>
          <Link href="/contributors">Contributors</Link>
          <span>Pointwise · Pairwise · Comprehension</span>
          <span>Bootstrap 95% CIs</span>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© 2026 Script-Bias Audit</span>
        <span>Urdu script · Roman Urdu · English · Code-mixed</span>
      </div>
    </footer>
  );
}

export function Header({ eyebrow, title, lede }: { eyebrow: string; title: ReactNode; lede?: ReactNode }) {
  return (
    <header className="page-header">
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
    <div className="tile stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="faint">{sub}</div>}
    </div>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  return error ? <p className="notice error">{error}</p> : null;
}
