// Smoke test: the overview renders with mock data.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) => (
    <a href={href} {...rest}>{children as never}</a>
  ),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import { OverviewView } from "../components/OverviewView";
import type { Overview } from "../lib/api";

const mock: Overview = {
  judges: [
    { id: "qwen/qwen-2.5-7b-instruct", status: "pass", auc: { urdu_script: 0.82, english: 0.91 } },
    { id: "mock/judge", status: "untested", auc: {} },
  ],
  dataset: {
    items: 300, code_mixed_items: 100, job: { state: "done", message: "" },
    generated: { roman_translit: { pending: 20, approved: 270, rejected: 10 }, code_mixed: { pending: 100, approved: 0, rejected: 0 } },
  },
  total_cost_usd: 1.234, total_calls: 4200, runs: 3, api_key_set: false, threshold: 0.7,
};

describe("Overview page", () => {
  it("renders title, judges, dataset status and cost", () => {
    const html = renderToStaticMarkup(<OverviewView data={mock} />);
    expect(html).toContain("Roman Urdu");
    expect(html).toContain("qwen/qwen-2.5-7b-instruct");
    expect(html).toContain("0.82");
    expect(html).toContain("not screened");
    expect(html).toContain("270");
    expect(html).toContain("$1.23");
    expect(html).toContain("OpenRouter key not set");
  });
});
