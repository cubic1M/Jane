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
│ ● Renewal going up $240/yr  ● Card cover paid twice $96/yr   │  "What matters now": ≤ 3 chips
│ ┌────────────┐   ┌─────────────────────────┐   ┌───────────┐ │
│ │ Insurance  │──▶│ ● Renewals going up   1 │──▶│ ● Car  +$240│
│ │ 2 urgent · │   │ ◐ Your policies       3 │   └───────────┘ │  the area's tree
│ │ 4 to look  │   │ ○ Your health plan    1 │                 │
│ └────────────┘   └─────────────────────────┘                 │
│ ┌─ Renewals going up ───────────────────────────────────────┐│
│ │ ● Car                                         +$240/yr     ││  the detail of the one
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

Every node has one of three statuses, shown as a glyph and spoken as words, never colour (`STATUS` in `src/components/tree/interactive-tree.tsx`):

| Status | Shape | Words | Means |
| --- | --- | --- | --- |
| `good` | ○ | Good | Nothing to do |
| `look` | ◐ | Needs a look | Worth a look; nothing is lost by waiting a week |
| `act` | ● (bold) | Urgent | Money is being lost or cover is missing now |

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
7. **Home tree.** Move the page's loading into `src/lib/area-pages/<area>-load.ts`
   (`load<Area>Area(userId)`, returning `area` and whatever the page renders), have the page call
   it, and add it to `areaTrees` in `AreasTree` (`src/app/home/page.tsx`). The giant tree then
   shows the area's own branches and items, with statuses and figures, each linking to
   `/<area>?focus=…`. The page and Home read the same data, so they never disagree.
   All six areas are wired.

## The home tree: "What Jane does"

On `/home`, right under the net worth hero. The founder, first: "one giant tree graph, not like u
have to click through each subtab"; then: "rn it's too big, I think you should not make it drag
around freely. Instead, put the subsections fixed (without the first layer of jane, just remove
that), and when u click on a subsection like taxes, it expands into a tree graph. The full names
should also be there, and not like '...'".

- **Tiles:** the six areas are fixed tiles: a row of six on a wide screen, three by two on a
  tablet, two by three on a phone. No "Jane" box above them; nothing to drag, pan or zoom. Each
  tile has its status, its full name (wrapping, never "…"), its line and `[+]`.
- **Opening an area:** a tile opens its tree below the row (`[−]` shuts it; another tile swaps
  it): the area with `[OPEN]`, a dotted line down to its branches side by side (as many columns
  as fit), and each branch's features under it on a dotted line, as a terminal draws a tree.
  An area with a tree page shows that tree's branches and items, from the page's own loader
  (all six do); an area whose loader fails shows what Jane looks for there, from the feature
  map, as `/home/map` does. The component is `src/components/hub/giant-tree.tsx`; what each
  area holds is `giantAreas` in `src/lib/giant-tree.ts`.
- **Opening a feature:** a click opens it in place: one line, `[OPEN]` into its page, and the
  Ask Jane box. The floating cards step aside while a feature is open; the dock stays.
- **Ask Jane:** an inverted `[ASK JANE]` box under the open feature. One click sends its
  question straight into the side chat (no Send). A dotted line marches from the box to the
  question and fades when Jane starts answering. Each question goes once per session
  (`src/lib/ask-jane.ts`); asked again, the chat scrolls to the earlier answer. The messages
  are `jane:send`, `jane:find`, `jane:bubble`, `jane:answering` and `jane:answered`
  (`src/lib/side-chat.ts`).

## Keyboard and screen readers

`role="tree"` with flat `treeitem`s (`aria-level`, `aria-setsize`, `aria-posinset`,
`aria-expanded` on the root and branches, `aria-selected` on items) and one tab stop. Up and
Down move, Right opens or goes in, Left closes or goes out, Home and End jump, Enter or Space
opens a branch or picks an item. The detail region is `aria-live="polite"`.

On a phone, or when a branch has many items, the canvas pans so the items fill the view and the
branches are off to the left. An "All of <area>" button above the tree brings them back.

## Visual language: monochrome terminal

The founder's words: "the entire design of the website should be this ascii, cool, almost spyware
like", and "remove the green on every part of the site. I want a black and white and gray color
scheme". Jane looks like a surveillance console, in black, white and greys only, in light and
dark mode alike.

**Colour.** None. `src/app/globals.css` remaps every Tailwind palette (emerald, amber, red, sky,
zinc and the rest, every shade from 50 to 950) to a grey of the same lightness. Existing classes
stay, and contrast between shades stays as designed. New code uses `neutral-*` or `zinc-*`.
`src/app/monochrome.test.ts` fails on three things:
- a palette shade that isn't remapped;
- a hex colour that isn't a grey (`#737373`; emails and icons included);
- a file with more colour-named classes than it had in `src/app/monochrome-baseline.json`.

**Meaning lives in shape, words and weight:**

| What | How |
| --- | --- |
| Status | ● urgent (bold), ◐ worth a look, ○ fine, plus words for screen readers |
| Up and down | ▲ / ▼ and a + / − sign |
| Jane's own cards (suggestions) | Inverted (`.invert-scope`): white on black in light mode, black on white in dark mode, a heavy dashed border and a `[JANE]` tag, so they never look like an answer |
| Primary button | Inverted: the text colour as its background (any `bg-emerald-600/700/800`) |
| Secondary button | Bracketed outline: `[Ask me first]` |
| Error | `role="alert"` with a heavy border and an `[ERROR]` tag |
| Net worth line | The text colour on the page background, with a dashed baseline |

**Terminal details:**
- Monospace everywhere, square corners and dashed borders (already global).
- Bracketed labels for actions: `[OPEN]`, `[ASK]`.
- Small uppercase tags for states: `LIVE`, `SCANNING`, `3 FLAGS`.
- `> ` before page titles and `# ` before section headings.
- A blinking cursor on headings.
- Tree edges drawn as dotted lines.
- Tabular figures for numbers.
- Optionally, a faint scanline or grid texture, and a short "decrypting" reveal of text on first load.

**Never at the cost of reading:**
- AA contrast for every grey pair (the axe tests check).
- Effects never cover text.
- All motion stops under `prefers-reduced-motion`.

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
the person typed stay in the conversation: her first message after theirs, within five minutes,
is the answer (`ANSWER_WINDOW_MS`); anything else she posts meanwhile floats.

**The card:**
- **Headline:** eight words at most for the detectors (`HEADLINE_MAX_WORDS`, starting with a
  verb), with one number; anything else shows its first sentence whole, never cut with "…".
- **Buttons:** one row (founder: "show the whole option lined up horizontally in one line
  instead of stacked on each other"): the main action, the message's other choices, and Not now
  (its own `snooze` when it has one), every label whole. Too many to fit, the row scrolls
  sideways under a fading edge (`.card-actions`). An X puts it off too.
- **More details:** expands in place with a height animation, and the card grows: wider when it
  floats (`max-w-2xl`), taller up to about 70% of the screen, scrolling inside itself (the
  scroll stays in the card). It shrinks back when shut. Inside, real paragraphs (founder: "each
  new paragraph is a new line with an empty line in between"): each line of the source is a
  paragraph, a long run is split into twos, "- " lines are a list (`paragraphs` in
  `src/lib/floating-cards.ts`), figures are tabular, and how sure Jane is comes last, on its own
  line.

**After it's answered** (anything but a suggestion, which never shows in the chat) it's back in the list as one line of history (`data-history`): what it
was, what was chosen, and the whole message behind More details. There's no gap or placeholder
while it floats.

**Where it shows** (founder: "Don't let the suggestion cards repeat in the chat again, I want
them right above the chat on the right (but not in the chat), also slightly bigger so that the
info isn't all gone"):
- **On a computer:** in the dock directly above the side chat, in the right column
  (`src/components/side-chat/card-dock.tsx`, loading `/api/chat/cards`), on every page. One card
  at a time, a little bigger, with "+N" and ‹ › arrows. The page's own floating stack and the
  chat in the panel leave them out. With the chat folded to its rail, the page's stack shows.
- **On a phone:** in the chat's sheet, over its message box; and on Home, folded into one line at
  the very bottom, "[JANE] 3 for you ▲", left of the Jane button, so the net worth is the first
  thing seen (QA round 6); a tap opens the card (`foldOnPhone`).
- **Never twice:** one stack (`popupStack`, loaded by `loadPopupStack`): one card per message and
  per headline, so a finding a source also posted as a decision shows once. The chat's list
  (`chatList`) has no suggestion at all, waiting or answered, and nothing that's floating.
- **Whole headlines:** a card's headline is its message's first sentence, never cut with "…";
  the rest is behind More details.

## Jane's logos

The ">Jane" wordmark in the top bar and the "J_" mark over the chat are only marks (founder: "It
should just be the logo, and no interaction"): no link, no button, no pointer, no focus stop
(`data-jane-logo`). Home and the area tabs do the moving; the folded chat has its own "Open
chat" button under the mark, and the phone's labelled "Chat with Jane" button opens the sheet.

## Loading

Every page and section that waits shows the ASCII bar, never "Loading…" in words (founder: "it
should always show a loading bar ... The loading bar should not cover up anything, including the
titles and suggestion box or chat box"): "[████░░░░░░░░░░░░] 34% · loading", in the flow where
the content will be (`LoadingBar` in `src/components/loading-bar.tsx`, every Suspense fallback).
A tapped link shows it under the top bar (`#page-loading`, `src/components/nav-pending.tsx`),
and the first scan's bar sits there too (`src/components/scan-bar.tsx`). None is fixed over the
page, the card dock or the chat.

## The chat's scroll

Scrolling past either end of the chat never scrolls the page (founder: "Never let the chat
scroll affect the whole screen scroll"): `overscroll-behavior: contain` on the framed chat and
the panel, and `containScroll` (`src/lib/contain-scroll.ts`) for what the browser would still
hand on, such as a chat too short to scroll. Wheel, trackpad and touch.

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

## Comparison cards

Wherever Jane recommends insurance or a loan (the chat, the area trees, /insurance/quotes), the
options are comparison cards (founder, 2026-10-24): two to four side by side on a wide screen,
a stack to swipe through on a phone with a Compare toggle that lines them up as a table.

```
Sort by  ● Lowest total cost  ○ Lowest monthly  ○ Fastest payoff
┌─────────────────────┐ ┌─────────────────────┐ ┌─────────────────────┐
│ [JANE'S PICK]       │ │ [LOWEST MONTHLY]    │ │ [FASTEST PAYOFF]    │
│ [LOWEST TOTAL]      │ │                     │ │                     │
│ Lakeside CU         │ │ Harbor Bank         │ │ Summit              │
│ $412/mo             │ │ $318/mo             │ │ $640/mo             │
│ ▸ APR      6.90%    │ │ ▸ APR      7.20%    │ │ ▸ APR      6.50%    │
│ ▸ Term     48 mo    │ │ ▸ Term     72 mo    │ │ ▸ Term     24 mo    │
│ ▸ Total    $19,776  │ │ ▸ Total    $22,896  │ │ ▸ Total    $15,360  │
│ · Fees     none     │ │ · Fees     none     │ │ · Fees     none     │  same on all: dimmed
│ » Best for the least│ │ » Best for the small│ │ » Best for debt-free│
│ [CHOOSE] More ▾     │ │ [CHOOSE] More ▾     │ │ [CHOOSE] More ▾     │
└─────────────────────┘ └─────────────────────┘ └─────────────────────┘
```

- **Data**: every pick-one card (`src/lib/option-card.ts`) carries `compare` on each option: the
  monthly figure, the total, how much cover (insurance) or how many months (loans), three or four
  rows and a "best for" line. The builders set it: `insuranceCard`, `shopCard`, `fitCard`.
- **Model**: `toComparison(card)` in `src/lib/comparison.ts` lines the rows up, marks the ones
  that differ, tags the unique winner of each preference (CHEAPEST, BEST COVER, LOWEST MONTHLY,
  LOWEST TOTAL, FASTEST PAYOFF) and opens on the preference that puts Jane's pick first.
  `rank(options, preference)` is the re-ranking, stable on ties.
- **Drawing**: `ComparisonCards` (`src/components/comparison-cards.tsx`). Monospace, black,
  white and grey: tags in brackets, ▸ for a row that differs (bold), · for one that doesn't
  (dimmed), the chosen card inverted. Sorting re-ranks on the screen with a FLIP glide, none
  under reduced motion.
- **Choosing**: one tap shows the choice at once; `pickCompared` (`src/lib/compare-actions.ts`)
  queues it behind through the lane's own picker, which prices the options again. In the chat
  the sheet sends `option.pick` instead.
