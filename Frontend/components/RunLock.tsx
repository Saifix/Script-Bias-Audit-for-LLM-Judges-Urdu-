"use client";
import { useEffect, useState } from "react";
import { runPassword } from "../lib/api";

/** Small inline field for the experiment password. Runs cost money, so starting one needs it. */
export function RunLock({ onChange }: { onChange?: (v: string) => void }) {
  const [v, setV] = useState("");
  useEffect(() => { const s = runPassword.get(); setV(s); onChange?.(s); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className="lock" title="Needed to start, resume or reload paid work">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
      Experiment password
      <input type="password" autoComplete="off" value={v} aria-label="Experiment password"
        onChange={(e) => { setV(e.target.value); runPassword.set(e.target.value); onChange?.(e.target.value); }} />
    </label>
  );
}
