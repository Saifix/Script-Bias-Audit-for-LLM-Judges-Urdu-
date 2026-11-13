"use client";
import { useCallback, useEffect, useState } from "react";
import { Badge, ErrorNote, Header, Segmented } from "../../components/ui";
import { api, label, useApi } from "../../lib/api";

type Entry = {
  item_id: string; pos: number; condition: string; question: string;
  source: string[]; belebele_roman: string[]; generated: string[]; raw: string; parse_ok: boolean;
  status: string; edited: boolean; reviewer: string | null; model?: string; correct_idx: number; wrong_idx: number;
};

function Options({ texts, entry, urdu, editing, onEdit }: {
  texts: string[]; entry: Entry; urdu?: boolean; editing?: boolean; onEdit?: (i: number, v: string) => void;
}) {
  return (
    <div>
      {texts.map((t, i) => (
        <div key={i} className={`option ${i === entry.correct_idx ? "is-correct" : i === entry.wrong_idx ? "is-wrong" : ""}`}>
          <span className="n">{i + 1}</span>
          {editing ? (
            <textarea className="input" rows={2} value={t} onChange={(e) => onEdit?.(i, e.target.value)} aria-label={`Option ${i + 1}`} />
          ) : (
            <span className={urdu ? "urdu" : ""} dir={urdu ? "rtl" : "ltr"} style={{ flex: 1 }}>{t || <em className="faint">empty</em>}</span>
          )}
          {i === entry.correct_idx && <Badge kind="correct">correct</Badge>}
          {i === entry.wrong_idx && <Badge kind="wrong">wrong</Badge>}
        </div>
      ))}
    </div>
  );
}

export default function ReviewPage() {
  const [condition, setCondition] = useState("roman_translit");
  const [status, setStatus] = useState("pending");
  const [idx, setIdx] = useState(0);
  const [editing, setEditing] = useState<string[] | null>(null);
  const [reviewer, setReviewer] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const queue = useApi<{ items: Entry[] }>(`/review?condition=${condition}&status=${status}`);

  // The backend records the signed-in user as reviewer; this is only for display.
  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => setReviewer(d?.user ?? "")).catch(() => {});
  }, []);
  useEffect(() => { setIdx(0); setEditing(null); }, [condition, status]);

  const items = queue.data?.items ?? [];
  const entry = items[Math.min(idx, Math.max(0, items.length - 1))];

  const act = useCallback(async (action: "approve" | "reject" | "edit") => {
    if (!entry) return;
    setErr(null);
    try {
      await api(`/review/${entry.item_id}/${condition}`, { action, reviewer, options: action === "edit" ? editing : undefined });
      setEditing(null);
      await queue.reload();
      if (status === "all") setIdx((i) => Math.min(i + 1, items.length - 1));
    } catch (e) { setErr((e as Error).message); }
  }, [entry, reviewer, condition, editing, queue, status, items.length]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const typing = e.target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName);
      if (editing) {
        if (e.key === "Escape") setEditing(null);
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); act("edit"); }
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "a") act("approve");
      else if (k === "r") act("reject");
      else if (k === "e" && entry) { e.preventDefault(); setEditing([...entry.generated]); }
      else if (k === "j" || e.key === "ArrowRight") setIdx((i) => Math.min(i + 1, items.length - 1));
      else if (k === "k" || e.key === "ArrowLeft") setIdx((i) => Math.max(i - 1, 0));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [act, editing, entry, items.length]);

  return (
    <>
      <Header eyebrow="Review queue" title="Check generated text"
        lede="Compare the Urdu-script source with the generated text. Transliterations must keep every word — no rewording or English substitutes. Only approved items are used in runs." />

      <div className="row between" style={{ marginBottom: 24 }}>
        <div className="row">
          <Segmented value={condition} onChange={setCondition}
            options={[{ value: "roman_translit", label: label("roman_translit") }, { value: "code_mixed", label: label("code_mixed") }]} />
          <Segmented value={status} onChange={setStatus}
            options={["pending", "approved", "rejected", "all"].map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))} />
        </div>
{reviewer && <span className="faint">Reviewing as <strong>{reviewer}</strong></span>}
      </div>

      <ErrorNote error={err ?? queue.error} />

      {!entry ? (
        <div className="tile"><p className="muted" style={{ margin: 0 }}>{queue.data ? "Nothing here. Generate text on the Data page, or pick another filter." : "Loading…"}</p></div>
      ) : (
        <div className="stack">
          <div className="row between">
            <div className="row">
              <strong>Item #{entry.pos + 1}</strong><span className="faint mono">{entry.item_id}</span>
              <Badge kind={entry.status} />{entry.edited && <Badge kind="warn">edited</Badge>}
              {!entry.parse_ok && <Badge kind="warn">output did not parse — check it</Badge>}
              {entry.model && <span className="faint">generated by {entry.model}</span>}
              {entry.reviewer && <span className="faint">· reviewed: {entry.reviewer}</span>}
            </div>
            <span className="faint">{Math.min(idx, items.length - 1) + 1} of {items.length}</span>
          </div>
          <p className="urdu" dir="rtl" style={{ margin: 0, fontSize: 17 }}>{entry.question}</p>
          <div className="grid cols-2">
            <div className="tile tight">
              <p className="eyebrow">Urdu-script source</p>
              <Options texts={entry.source} entry={entry} urdu />
            </div>
            <div className="tile tight tint">
              <p className="eyebrow">Generated · {label(condition)}</p>
              <Options texts={editing ?? entry.generated} entry={entry} editing={!!editing}
                onEdit={(i, v) => setEditing((o) => o && o.map((x, j) => (j === i ? v : x)))} />
            </div>
          </div>
          <details>
            <summary>Belebele's own Roman Urdu (often reworded) and raw model output</summary>
            <div className="grid cols-2" style={{ marginTop: 12 }}>
              <div className="tile tight"><Options texts={entry.belebele_roman} entry={entry} /></div>
              <div className="tile tight"><pre className="mono" style={{ whiteSpace: "pre-wrap", margin: 0 }}>{entry.raw}</pre></div>
            </div>
          </details>
          <div className="row">
            {editing ? (
              <>
                <button className="btn" onClick={() => act("edit")}>Save &amp; approve<span className="kbd">⌘↵</span></button>
                <button className="btn secondary" onClick={() => setEditing(null)}>Cancel<span className="kbd">Esc</span></button>
              </>
            ) : (
              <>
                <button className="btn positive" onClick={() => act("approve")}>Approve<span className="kbd">A</span></button>
                <button className="btn secondary" onClick={() => setEditing([...entry.generated])}>Edit<span className="kbd">E</span></button>
                <button className="btn danger" onClick={() => act("reject")}>Reject<span className="kbd">R</span></button>
                <span style={{ flex: 1 }} />
                <button className="btn secondary small" onClick={() => setIdx((i) => Math.max(i - 1, 0))}>Previous<span className="kbd">K</span></button>
                <button className="btn secondary small" onClick={() => setIdx((i) => Math.min(i + 1, items.length - 1))}>Next<span className="kbd">J</span></button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
