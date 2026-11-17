import type { Page } from "@playwright/test";

// The phone pass (founder, 11-16: "build the mobile webpage better"): what one look at a page on a
// phone finds, in the order the founder ranked them. (1) Anything scrolling sideways, running past
// the right edge, cut short, or covered by something else; (2) tap targets under 44 px, or too
// close together. The rest (the first screen, one-thumb reach, the chat sheet, slow loading) are
// measured by e2e/mobile-pass.spec.ts on the pages they're about.

export const TAP_MIN = 44;
export const TAP_GAP = 8;

export type PhoneLook = {
  url: string;
  // How far the page scrolls sideways, in px (0 when it doesn't).
  sideways: number;
  // Things that run past the right edge of the screen.
  offRight: string[];
  // Text cut short (an ellipsis, or a clamp).
  clipped: string[];
  // Controls cut by the edge of a sideways scroller they sit in (a tab row, a chip row).
  cutByScroller: string[];
  // Controls with something else on top of them, at the top of the page or scrolled to its end.
  covered: string[];
  // Controls under TAP_MIN in either direction (not links inside a sentence).
  small: string[];
  // Small controls closer than TAP_GAP to another control.
  crowded: string[];
};

export async function phoneLook(page: Page): Promise<PhoneLook> {
  const at = (where: "top" | "end") =>
    page.evaluate(
      ({ where, TAP_MIN, TAP_GAP }) => {
        if (where === "end") window.scrollTo(0, document.documentElement.scrollHeight);
        else window.scrollTo(0, 0);
        const W = document.documentElement.clientWidth;
        const H = window.innerHeight;
        const visible = (el: Element) => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return (
            r.width > 0 &&
            r.height > 0 &&
            s.visibility !== "hidden" &&
            s.display !== "none" &&
            Number(s.opacity) > 0 &&
            !el.closest("[aria-hidden=true], [hidden], .sr-only")
          );
        };
        const name = (el: Element) =>
          (
            el.getAttribute("aria-label") ||
            (el as HTMLElement).innerText ||
            el.getAttribute("title") ||
            el.getAttribute("placeholder") ||
            el.tagName.toLowerCase()
          )
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 60);
        const scrollerOf = (el: Element): Element | null => {
          for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
            const s = getComputedStyle(p);
            if (/(auto|scroll|hidden|clip)/.test(s.overflowX) && p.scrollWidth > p.clientWidth + 1)
              return p;
          }
          return null;
        };
        const TARGETS =
          "a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=treeitem], [role=link], [role=switch], [role=checkbox]";
        const targets = [...document.querySelectorAll(TARGETS)].filter(
          (el) => visible(el) && !el.closest("[inert]"),
        );
        const own = (el: Element) => !targets.some((t) => t !== el && t.contains(el));
        const out = {
          sideways: Math.max(0, document.documentElement.scrollWidth - W),
          offRight: [] as string[],
          clipped: [] as string[],
          cutByScroller: [] as string[],
          covered: [] as string[],
          small: [] as string[],
          crowded: [] as string[],
        };

        if (where === "top") {
          // Past the right edge: the outermost thing that does, not each child inside it.
          const flagged: Element[] = [];
          for (const el of document.body.querySelectorAll("*")) {
            if (!visible(el) || flagged.some((f) => f.contains(el))) continue;
            const s = getComputedStyle(el);
            if (s.position === "fixed" && el.getBoundingClientRect().width >= W) continue;
            const r = el.getBoundingClientRect();
            if (r.right > W + 1 && !scrollerOf(el)) {
              flagged.push(el);
              out.offRight.push(`${name(el)} (right ${Math.round(r.right)} of ${W})`);
            }
          }
          // Text cut short.
          for (const el of document.body.querySelectorAll("*")) {
            if (!visible(el)) continue;
            const hasText = [...el.childNodes].some(
              (n) => n.nodeType === 3 && (n.textContent ?? "").trim() !== "",
            );
            if (!hasText) continue;
            const s = getComputedStyle(el);
            const el2 = el as HTMLElement;
            const ellipsis =
              (s.textOverflow === "ellipsis" || /(hidden|clip)/.test(s.overflowX)) &&
              el2.scrollWidth > el2.clientWidth + 1;
            const clamp = s.webkitLineClamp !== "none" && el2.scrollHeight > el2.clientHeight + 1;
            if (ellipsis || clamp) out.clipped.push(name(el));
          }
          // Cut by the edge of the sideways scroller they sit in.
          for (const el of targets) {
            const box = scrollerOf(el);
            if (!box) continue;
            const r = el.getBoundingClientRect();
            const b = box.getBoundingClientRect();
            if (
              (r.left < b.left - 1 && r.right > b.left + 1) ||
              (r.right > b.right + 1 && r.left < b.right - 1)
            )
              out.cutByScroller.push(name(el));
          }
          // Small, or crowded.
          for (const el of targets) {
            if (!own(el)) continue;
            // A checkbox or radio in a label: the label is what a finger hits.
            const label = /^(checkbox|radio)$/.test((el as HTMLInputElement).type ?? "")
              ? el.closest("label")
              : null;
            const r = (label ?? el).getBoundingClientRect();
            const s = getComputedStyle(el);
            // A link inside a sentence is part of the text, not a button.
            const parent = el.parentElement;
            const inSentence =
              s.display === "inline" &&
              !!parent &&
              ((parent as HTMLElement).innerText ?? "").trim().length >
                ((el as HTMLElement).innerText ?? "").trim().length + 3;
            if (inSentence) continue;
            if (r.height < TAP_MIN - 0.5 || r.width < TAP_MIN - 0.5) {
              out.small.push(`${name(el)} (${Math.round(r.width)}×${Math.round(r.height)})`);
              const near = targets.find((o) => {
                if (o === el || o.contains(el) || el.contains(o)) return false;
                const q = o.getBoundingClientRect();
                const dx = Math.max(0, Math.max(q.left - r.right, r.left - q.right));
                const dy = Math.max(0, Math.max(q.top - r.bottom, r.top - q.bottom));
                return dx < TAP_GAP && dy < TAP_GAP && (dx > 0 || dy > 0);
              });
              if (near) out.crowded.push(`${name(el)} ↔ ${name(near)}`);
            }
          }
        }

        // Covered: what's on top at the middle of each control in sight is something else.
        for (const el of targets) {
          const r = el.getBoundingClientRect();
          const x = r.left + r.width / 2;
          const y = r.top + r.height / 2;
          if (x < 0 || x > W || y < 0 || y > H) continue;
          const top = document.elementFromPoint(x, y);
          if (!top || top === el || el.contains(top) || top.contains(el)) continue;
          // Under a label that is part of it (a label for an input), or a wrapper that passes taps.
          if (top.closest("label")?.contains(el)) continue;
          if (getComputedStyle(top).pointerEvents === "none") continue;
          out.covered.push(`${name(el)} under ${name(top.closest(TARGETS) ?? top)} (${where})`);
        }
        return out;
      },
      { where, TAP_MIN, TAP_GAP },
    );
  const top = await at("top");
  const end = await at("end");
  await page.evaluate(() => window.scrollTo(0, 0));
  return {
    url: page.url(),
    ...top,
    covered: [...new Set([...top.covered, ...end.covered])],
  };
}
