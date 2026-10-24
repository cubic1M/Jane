# Area pages: a tree first, few words

Written 2026-10-23 from the founder's brief: "for every subtab, you should limit words, make it
clearer to the user on what is important and what is not … best if with tree graph for every
one of the subtabs … The home page should have a treegraph that allows u to go into the subtabs
as well."

Insurance is the first area built this way. This doc is the pattern every other area
(Spending & bills, Loans & credit, Taxes, Investing, Plans) follows.

## The page, top to bottom

```
┌──────────────────────────────────────────────────────────────┐
│ Insurance                         Checkup · Claims · …       │  h1, one line, nav links
│ ◆ Renewal going up $240/yr  ◆ Card cover paid twice $96/yr   │  "What matters now": ≤ 3 chips
│ ┌────────────┐   ┌─────────────────────────┐   ┌───────────┐ │
│ │ Insurance  │──▶│ ◆ Renewals going up   1 │──▶│ ◆ Car  +$240│
│ │ 2 urgent · │   │ ▲ Your policies       3 │   └───────────┘ │  the area's tree
│ │ 4 to look  │   │ ■ Your health plan    1 │                 │
│ └────────────┘   └─────────────────────────┘                 │
│ ┌─ Renewals going up ───────────────────────────────────────┐│
│ │ ◆ Car                                         +$240/yr     ││  the detail of the one
│ │ Your car renewal goes up $240. Jane can call them.        ││  thing picked: summary,
│ │ [Call them]                                   More ▸       ││  actions, "More"
│ └────────────────────────────────────────────────────────────┘│
│ ▸ How Jane handles insurance  ▸ Your household  ▸ Add a policy│  closed <details>
└──────────────────────────────────────────────────────────────┘
```

- **Chips** (`role="group"`, "What matters now"): at most `CHIPS_MAX` (3). Only urgent items,
  biggest dollar figure first; ties keep branch order. A chip picks its item.
- **The tree**: area → branches → the open branch's items. A branch with no items is not drawn.
- **The detail**: a `<section aria-label={branch label}>` for the picked item only. Its
  summary, then its actions (the forms the page already had), then the long text behind a
  closed `<details>` "More".
- **Below**: nothing open by default. Setup forms and "how it works" text go in closed
  `<details>` at the bottom.

## Copy budget

Checked by `src/lib/area-pages/tree.ts` and each area's unit test:

| What | Budget |
| --- | --- |
| A node's label | `LABEL_MAX_WORDS` (6) words or fewer |
| A detail's summary, before "More" | `SUMMARY_MAX_SENTENCES` (2) sentences or fewer |
| Chips | `CHIPS_MAX` (3) or fewer |
| A node's figure | one figure ("$240/yr", "Missing", "Covered", "$1,200 short") |

Long words never get cut down to fit: what doesn't fit moves into "More".

## Status

Every node has one of three statuses, shown as a shape and spoken as words, never colour
alone (`STATUS` in `src/components/tree/interactive-tree.tsx`):

| Status | Shape | Words | Means |
| --- | --- | --- | --- |
| `good` | ■ | Good | Nothing to do |
| `look` | ▲ | Needs a look | Worth a look; nothing is lost by waiting a week |
| `act` | ◆ | Urgent | Money is being lost or cover is missing now |

A branch takes the worst status of its items (`worst()`), and its line says "N urgent" or
"N things to look at". The root's line counts both, or says "All good".

## Code

| Piece | File | What it does |
| --- | --- | --- |
| Tree engine | `src/components/tree/interactive-tree.tsx` | `InteractiveTree`: the zooming canvas, ARIA tree, keyboard; controlled `open` and `picked`. Also draws the feature map (`src/components/feature-tree.tsx`) |
| Layout | `src/lib/feature-map-layout.ts` | `layoutMap(TreeShape, open, width)`, `cameraFor`, `edgePath` |
| Shared rules | `src/lib/area-pages/tree.ts` | `buildAreaTree`: hides empty branches, branch status and line, root line, chips, summaries |
| Page shell | `src/components/area-page/area-page.tsx` | `AreaPage`: chips, tree, detail, "More", the `?focus=` deep link |
| An area | `src/lib/area-pages/insurance.ts` | Branch names and order, item labels, `insuranceTree(input)`: pure, unit tested |
| Its page | `src/app/insurance/page.tsx` | Loads the data, calls `insuranceTree`, renders each item's detail and "More" as `ReactNode` records |
| e2e helpers | `e2e/area-tree.ts` | `openBranch`, `pickItem(page, tree, branch, item \| "first-open")` |

## Building the next area

1. **List the branches.** One per thing the page already shows (a section heading today is
   usually a branch). Order: what loses money first, setup and reference last. Put the names
   in a `<AREA>_BRANCHES` record in `src/lib/area-pages/<area>.ts`.
2. **Write the pure builder** `<area>Tree(input): AreaTree`, calling `buildAreaTree`. Each item
   needs an id (`itemId(branch, key)`, so `branch:key`), a label of six words or fewer, a
   status, a figure where there is one, a summary of two sentences or fewer, and `cents` for
   urgent items so the chips sort.
   - No new math: take every number from the loader the page already uses.
   - Labels come from a label record per kind ("Turn on autopay", "A driver not on a policy"),
     not from the long titles the detectors write.
3. **Test it** (`src/lib/area-pages/<area>.test.ts`): every label is within the budget, every
   summary within two sentences, the branch order, statuses and figures for a sample person,
   the chips (at most three, ordered), and the all-good case.
4. **Rewrite the page body** as `<AreaPage tree chips summaries details more focus />`. Keep
   every existing form and server action: they move into `details[id]` unchanged. Explanations
   and secondary lists go into `more[id]`.
5. **Deep links.** Read `?focus=` (and any older query the page used, such as `?edit=`) and
   pass it as `focus`. A server action that redirects back should keep `focus` so the person
   lands on the same item.
6. **Update the e2e specs** to `pickItem(page, "<Area>", "<branch label>", "<item label>")`, and
   scope assertions to the returned region.
7. **Home tree.** Add the area's branches to the home hub's tree (see below) once its page
   reads `?focus=<branch>`.

## The home tree

On `/home`, under the area tiles ("Everything, as a tree"): Jane → the six areas → each area's
branches, drawn with the same engine (`src/components/hub/home-tree.tsx`, shaped by the pure
`homeTree` in `src/lib/hub/tree.ts`).

- An area with a tree page lists that tree's branches, with their statuses, loaded by the same
  loader as the page (`loadInsuranceArea` in `src/lib/area-pages/insurance-load.ts`, without
  the page's refresh). Picking one goes to `/<area>?focus=<branch>`, and the page opens with
  that branch open. The area's own status and line come from its tree, so the hub and the page
  agree.
- An area without one yet lists what Jane looks for there (the feature map's branches), and
  each links to the area's page. Once its page reads `?focus=`, add its tree to `areaTrees` in
  `src/app/home/page.tsx`.
- Every area's first item is "Open <area>". An area with nothing under it goes straight to its
  page.

## Keyboard and screen readers

`role="tree"` with flat `treeitem`s (`aria-level`, `aria-setsize`, `aria-posinset`,
`aria-expanded` on the root and branches, `aria-selected` on items) and one tab stop. Up and
Down move, Right opens or goes in, Left closes or goes out, Home and End jump, Enter or Space
opens a branch or picks an item. The detail region is `aria-live="polite"`.

On a phone, or when a branch has many items, the canvas pans so the items fill the view and the
branches are off to the left. An "All of <area>" button above the tree brings them back.

## Jane's pop-ups: no cards in the chat

The founder: "replace all the yellow cards in the chat as pop up ones that do not take any space
in the chat area. The yellow cards should also be very concise and easy and direct to
understand, with users having the ability to click more details to see more."

**What floats.** Everything Jane brings up on her own that waits on the person:
- the day's suggestions;
- the morning brief and agenda;
- something to decide, like the autopilot question;
- a heads-up with a button.

It floats as a card over the page or the chat, taking no room in the chat's list
(`isPopup` in `src/lib/jane-agent/popups.ts`). The day's suggestions come first, then the day's
brief, then the rest, newest first, with "+N" for the cards waiting behind. Her answers to what
the person typed stay in the conversation: anything she sends within five minutes of their
message is an answer (`ANSWER_WINDOW_MS`).

**The card:**
- **Headline:** eight words at most (`POPUP_HEADLINE_WORDS`; the detectors' `HEADLINE_MAX_WORDS`
  is 8 too, starting with a verb), with one number.
- **Buttons:** one action (the message's main button) and Not now (its own `snooze` when it has
  one). An X puts it off too.
- **More details:** expands in place with a height animation. It holds the reasoning and how
  sure Jane is (a suggestion), or the whole message and its other choices (a decision).

**After it's answered** it's back in the list as one line of history (`data-history`): what it
was, what was chosen, and the whole message behind More details. There's no gap or placeholder
while it floats.

**Where it shows:**
- The chat (`/chat?embed=1` in the side panel).
- Home, which loads the same pop-ups (`openPopupMessages`).
- Any page's side chat.

## Motion

One spec for everything that moves (`--motion-*` and `--ease-*` in `src/app/globals.css`, and
`MOTION` in `src/config/motion.ts` for the Web Animations API):

| Token | Value | For |
| --- | --- | --- |
| `--motion-fast` | 150 ms | Fades, the reduced-motion stand-ins |
| `--motion-base` | 200 ms | A card leaving, a page arriving, a detail shutting |
| `--motion-slow` | 250 ms | Pop-ups rising, the side chat and sheet, the tree's camera, a detail opening, lines drawing |
| `--ease-spring` | `cubic-bezier(0.2, 0.9, 0.3, 1.15)` | Things that arrive (pop-ups, the panel, nodes) |
| `--ease-out-soft` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | Everything else |

- **Pop-ups:** spring in from below. Yes slides them off right and Not now left, while the
  next rises in the same frame.
- **More details:** opens by animating its measured height.
- **Pages:** fade and rise a few pixels on every navigation (`src/app/template.tsx`). The
  animation leaves no transform behind, so fixed pop-ups stay put.
- **Side chat:** docks, folds and expands, and the sheet snaps, on `--motion-slow` with the spring.
- **Tree and net worth chart:** the tree's camera glides, and the net worth line draws itself
  in on a range change, both on `--motion-slow`.
- **Loading:** content that loads late has a skeleton or a held space (the tiles, the tree)
  rather than a jump.
- **Reduced motion:** all of it stops under `prefers-reduced-motion: reduce`. Things appear in
  place, and a short fade is the most that remains.
