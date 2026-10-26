import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdminTable } from "./admin-table";

describe("AdminTable", () => {
  it("renders the header and one row per item, the last column unpadded", () => {
    const html = renderToStaticMarkup(
      <AdminTable
        head={["Kind", "Times"]}
        rows={[
          { key: "a", cells: ["fees", 3] },
          { key: "b", cells: ["subscriptions", 1] },
        ]}
        data-test-table=""
      />,
    );
    expect(html).toContain('<table class="w-full text-left text-sm" data-test-table="">');
    expect(html).toContain('<th class="py-2 pr-4 font-semibold">Kind</th>');
    expect(html).toContain('<th class="py-2 font-semibold">Times</th>');
    expect(html).toContain('<td class="py-2 pr-4">fees</td><td class="py-2">3</td>');
    expect(html.match(/<tr class="border-b border-zinc-100/g)).toHaveLength(2);
  });
});
