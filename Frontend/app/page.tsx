"use client";
import { OverviewView } from "../components/OverviewView";
import { ErrorNote } from "../components/ui";
import { useApi, type Overview } from "../lib/api";

export default function OverviewPage() {
  const { data, error } = useApi<Overview>("/overview", 5000);
  if (!data) return error ? <ErrorNote error={error} /> : <p className="muted">Loading…</p>;
  return <OverviewView data={data} />;
}
