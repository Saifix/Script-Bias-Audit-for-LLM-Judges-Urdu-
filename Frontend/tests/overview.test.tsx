// Smoke test: the home page insight cards render with mock data.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) => (
    <a href={href} {...rest}>{children as never}</a>
  ),
}));

import { InsightsView } from "../components/Insights";
import type { Insights } from "../lib/api";

const dataset = {
  items: 300, code_mixed_items: 100, job: { state: "done", message: "" },
  generated: { roman_translit: { pending: 20, approved: 270, rejected: 10 }, code_mixed: { pending: 100, approved: 0, rejected: 0 } },
};

describe("Home insights", () => {
  it("renders headline numbers from the latest runs", () => {
    const data: Insights = {
      screening: { pass: 1, screened: 2, judges: 2 },
      dataset,
      pointwise: { run_id: 3, judges: 2, by_condition: {
        urdu_script: { gap: null, auc: 0.8, accept_wrong: 0.1 },
        roman_belebele: { gap: -1.75, auc: 0.7, accept_wrong: 0.2 },
        english: { gap: 0.4, auc: 0.9, accept_wrong: 0.1 },
      } },
      pairwise: { run_id: 4, by_condition: { roman_belebele: 0.38, english: 0.55 } },
      comprehension: { run_id: 5, by_condition: { urdu_script: 0.72, roman_belebele: 0.61 } },
    };
    const html = renderToStaticMarkup(<InsightsView data={data} />);
    expect(html).toContain("−1.75");
    expect(html).toContain("Roman (Belebele)");
    expect(html).toContain("38%");
    expect(html).toContain("72%");
    expect(html).toContain("1/2");
    expect(html).toContain("270 generated versions reviewed");
  });

  it("shows empty states before any run", () => {
    const html = renderToStaticMarkup(<InsightsView data={{ screening: { pass: 0, screened: 0, judges: 2 }, dataset }} />);
    expect(html).toContain("No pointwise results yet");
    expect(html).toContain("No pairwise results yet");
  });
});
