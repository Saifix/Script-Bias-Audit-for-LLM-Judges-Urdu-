"use client";
import { useState } from "react";

/** Contributor photo, or a neutral silhouette when there is no photo (or it fails to load). */
export function Portrait({ src, name }: { src?: string; name: string }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) {
    return <img className="portrait" src={src} alt={name} width={132} height={132} onError={() => setBroken(true)} />;
  }
  return (
    <div className="portrait" aria-label="Photo coming soon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>
    </div>
  );
}
