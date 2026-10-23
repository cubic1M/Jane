# Home hub, side chat, suggestion pop-ups and the feature map

Written 2026-10-23 from the founder's brief: "a home screen (that is not just the chat),
showing the different areas, and the chat as a side chat that can be expanded"; suggestions
that "pop up and not take over the entire chat screen", are "less wordy, and can be expanded";
on a computer "a main hub … graphs mainly … and on the top the different tabs"; and the
features shown "as a tree graph … so the user can interact with the graph".

Built in four PRs, each labelled `e2e`:

| PR | What | Main files |
| --- | --- | --- |
| a | The shell: area tabs on top, the side chat (desktop) and the bottom sheet (phone) | `src/components/area-tabs.tsx`, `src/components/side-chat.tsx`, `src/lib/side-chat.ts` |
| b | The hub: hero row, cash-flow strip, area tiles | `src/app/home/page.tsx`, `src/lib/hub/*`, `src/components/hub/*` |
| c | Compact suggestion pop-ups | `src/components/floating-cards.tsx`, `src/lib/floating-cards.ts` |
| d | The feature map | `src/app/home/map/page.tsx`, `src/lib/feature-map.ts`, `src/components/feature-tree.tsx` |

## Principles

- **Graphs first, few words.** The hub shows at most nine numbers: three big ones in the hero
  row and one per area tile. Everything else is a shape (a bar, a sparkline, a dot on a
  timeline) with its figure on hover, focus or tap.
- **No new math in components.** Every number comes from the code that already shows it on
  its own page (see "Where each number comes from"). The hub's loader only gathers; a pure view
  model (`src/lib/hub/view.ts`) shapes it for the charts and is unit tested.
- **Same words as the chat.** Short, plain, second person, no jargon. A tile says "2 gaps",
  not "Two coverage gaps were identified in your insurance profile".
- **Motion is CSS and the Web Animations API.** Springs are a `cubic-bezier` overshoot
  (`--ease-spring: cubic-bezier(.2,.9,.3,1.15)`), 200–300 ms. No motion library: nothing here
  needs physics or gesture inertia beyond what pointer events and transitions give us.
  Everything is still under `prefers-reduced-motion: reduce`.

## Layout

### Desktop (≥ 1024 px)

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ Jane   Home  Spending & bills  Insurance  Loans & credit  Taxes  Investing  Plans  ☺ │  top bar
├───────────────────────────────────────────────────────────────┬──────────────────────┤
│                                                               │ Jane          ⤢  ›  │
│  ┌ Safe to spend ──────┐ ┌ Net worth ─────────┐ ┌ Saved ────┐  │──────────────────────│
│  │ $1,240   until 10/31│ │ $48,200            │ │ $640/yr   │  │                      │
│  │ ████████▒▒▒▒░░░     │ │ ╱‾‾╲__╱‾‾‾‾╱       │ │ ▓▓▓░░░░░  │  │   chat thread        │
│  └─────────────────────┘ └────────────────────┘ └───────────┘  │   (the /chat page,   │
│                                                               │    embedded)         │
│  Next 30 days ───────────────────────────────────────────     │                      │
│  today ●──▼────▼──────▲─────▼──▼─────────────▲──────▼──── +30  │                      │
│          rent  phone  pay   gym car          pay    ins       │  ┌ suggestion ─────┐ │
│                                                               │  │ ✦ Cancel Hulu…  │ │
│  ┌ Spending ┐ ┌ Insurance ┐ ┌ Loans ┐ ┌ Taxes ┐ ┌ Invest ┐ ┌ Plans ┐   │  └────────────────┘ │
│  │ ● good   │ │ ● act     │ │ ● look│ │ ● good│ │ ● good │ │ ● look│   │ [ Ask Jane…    ➤ ] │
│  │ $2,310   │ │ 2 gaps    │ │ $8.4k │ │ 41 d  │ │ $10.2k │ │ 2 of 3│   │                      │
│  │ ▁▃▅▂▆▄   │ │ ●●○○      │ │ ███▒  │ │ ◔     │ │ ╱‾╲╱‾  │ │ ▰▰▱   │   │                      │
│  └──────────┘ └───────────┘ └───────┘ └───────┘ └────────┘ └───────┘   │                      │
│                                                               │                      │
│  What Jane does ›                                             │                      │
└───────────────────────────────────────────────────────────────┴──────────────────────┘
```

- The top bar holds the area tabs, the profile menu and, on the right, a "Chat" toggle.
  "What Jane did" and Settings live in the profile menu.
- The chat panel is docked on the right, 380 px wide, full height under the top bar. It has
  three states, remembered per person in `localStorage` (key `jane.sideChat:<userId>`, every
  read and write in try/catch):
  - **open** (default): docked, the page shrinks to make room;
  - **rail**: a 56 px strip with Jane's avatar and an unread dot; a click opens it;
  - **full**: the same panel over the whole window, with a control to dock it again.
- `/chat` stays the chat as its own page (deep links and every chat test keep working). It is
  the chat "expanded", with the area tabs above; the side panel never shows on it.

### Phone (< 1024 px)

```
┌───────────────────────────────┐
│ Jane                        ☺ │
│ Home  Spending  Insurance  Lo→│  tabs scroll sideways
├───────────────────────────────┤
│ Safe to spend until Oct 31    │
│ $1,240                        │
│ ████████▒▒▒▒░░                │
│ ┌ Net worth ──┐ ┌ Saved ─────┐ │
│ │ $48.2k ╱‾╲_ │ │ $640/yr    │ │
│ └─────────────┘ └────────────┘ │
│ Next 30 days                  │
│ ●─▼──▼───▲──▼─▼──────▲───▼──  │
│ ┌ Spending ┐ ┌ Insurance ┐     │
│ │ ● $2,310 │ │ ● 2 gaps  │     │
│ └──────────┘ └───────────┘     │
│ …                             │
│ ┌ suggestion ───────────────┐ │
│ │ ✦ Cancel Hulu, save $215 ⌄│ │
│ │ [Yes]  [Not now]       +2 │ │
│ └───────────────────────────┘ │
│                          (J)  │  Jane button
└───────────────────────────────┘

 Jane button → bottom sheet at half height:
┌───────────────────────────────┐
│ (hub, dimmed)                 │
├────────────── ▬ ──────────────┤  drag up: full height; swipe down: close
│ Jane                    ⤢  ✕  │
│ chat thread                   │
│ [ Ask Jane…                 ➤]│
└───────────────────────────────┘
```

- No bottom tab bar any more: the area tabs scroll sideways at the top, and the chat is a
  sheet. A drag on the handle moves the sheet with the finger; letting go snaps it to the
  nearest of half, full or closed (a fast flick down closes it). The ⤢ button does the same as
  dragging to full, and Escape or ✕ closes it, so nothing needs a gesture.
- Nothing scrolls sideways at 375 px.

### The side chat: why an embedded page

The panel shows `/chat?embed=1` in a same-origin `<iframe>`. The chat is a server-rendered
page with its own actions, streaming answers, cards, voice and scrolling; rendering it a
second time inside every page would mean moving all of that into a shared layout (every
signed-in page sits directly under `src/app`, so a layout means moving every page into a route
group, which every lane is editing tonight) and rewriting the chat's scrolling and its fixed
cards to live in a box. The frame gives the panel the chat exactly as it is, sized like a
phone, with its cards fixed to the bottom of the panel, which is where the brief wants them.

- `embed=1` leaves out the page header and the intro line and adds a small bridge
  (`src/app/chat/embed-bridge.tsx`): a link inside the chat to another page opens in the main
  window (`postMessage` to the parent, which calls `router.push`), and the parent tells the
  frame whether it is docked or full.
- The panel lives in the root layout, so it isn't reloaded when the person changes tab. It
  shows only on signed-in pages (once an app header has said who is signed in), and never
  inside a frame. The page's room for it is docked by default in CSS, so it is there from the
  first frame; folded or expanded, the panel sets `html[data-side-chat]` after it loads. (An
  inline boot script in the head was tried and broke streaming with cache components.)
- The security headers allow framing by our own origin only (`frame-ancestors 'self'`,
  `X-Frame-Options: SAMEORIGIN`); other sites still can't frame us.
- The frame loads after the page itself has loaded (idle), so it never slows the first view.
  In the rail state it isn't loaded at all; the unread dot comes from
  `GET /api/chat/unread` (a count, scoped to the signed-in person), checked on focus and every
  minute.

## The hub

Three bands, top to bottom.

1. **Hero row.** Three cards, each a big number and one small graphic:
   - *Safe to spend until payday*: the number, and a stacked bar of today's checking balance
     split into bills before payday, budgets left, goals, yearly set-aside and what's safe.
     Short shows in red with "Short by".
   - *Net worth*: today's number and a 12-month sparkline; the change over the year as an
     arrow, not a figure.
   - *Saved so far* (once anything is saved; before then *Money found*): the yearly figure and
     a bar of saved against found.
2. **Cash flow, next 30 days.** A timeline from today to +30 days: bills hang below the line
   (▼, size by amount), paydays sit above it (▲), deadlines are small diamonds. Hover, focus or
   tap shows the name, date and amount. It's a list for screen readers ("Next 30 days: Rent,
   $1,450, Nov 1 …").
3. **Area tiles.** One per area, in tab order. Each has a health dot and word (good / look /
   act), its one number, and a tiny chart. The whole tile opens the tab.

Under the tiles: "What Jane does ›" opens the feature map, and the "Needs you" strip (things
waiting on the person, new alerts, the first-week checklist, the autopilot question) shows
only when there is something in it.

### Where each number comes from

| On the hub | Source (same as the page that shows it) |
| --- | --- |
| Safe to spend, its bar | `homeSummary().safeToSpend` (`src/lib/home.ts` → `src/planning/safe-to-spend.ts`) |
| Net worth today | `netWorth()` (`src/insights/net-worth.ts`), as on `/net-worth` |
| Net worth sparkline | `monthlyNetWorth(…, NET_WORTH_MONTHS)` from balance snapshots, as on `/net-worth` |
| Saved so far / money found | `homeSummary().savedToDateCents` / `.moneyFoundCents` (`savedToDate`, `moneyFound`) |
| Cash-flow strip | `loadComingUp()` (`src/lib/coming-up.ts`): bills, deposits and deadlines, one source |
| Spending tile | this month's spending from `spendingInsights()` and the last six months for the bars, as on `/insights` |
| Insurance tile | `loadInsurance()`: policies and gaps, as on the Money hub's tile |
| Loans tile | `debtSummary()` (`src/insights/loans.ts`): what's owed, by account |
| Taxes tile | the next tax deadline from `loadComingUp()` deadlines (days left) |
| Investing tile | `loadPractice()` (`src/lib/practice/portfolio.ts`): practice total and its value path |
| Plans tile | `listGoals()`: goals on track out of all, and each goal's progress |
| Health dots | the money health score's parts (`healthFor`, `src/lib/health-score.ts`) and the waiting suggestions in that area (`suggestions` table, status `waiting`) |

### Area health

`areaHealth()` in `src/lib/hub/view.ts`, pure:

- **act**: a waiting suggestion in the area with urgency `now`, or a hard signal (a budget over,
  a loan overdue, a required cover gap, safe to spend short);
- **look**: any other waiting suggestion in the area, or the area's health-score part under
  half its points;
- **good**: otherwise. With no data for the area the tile says "Not set up" and links to how
  to set it up.

Which area a suggestion belongs to comes from its detector's capability through
`AREA_OF_CAPABILITY` (`src/config/areas.ts`), the same map the feature map uses; its test fails
on a capability with no area.

## Suggestion pop-ups

```
collapsed                                     expanded (chevron)
┌──────────────────────────────────┐          ┌──────────────────────────────────┐
│ ✦ Cancel Hulu, save $215/yr    ⌄ │          │ ✦ Cancel Hulu, save $215/yr    ⌃ │
│ [ Yes ]  [ Not now ]          +2 │          │ Why you: no plays since June.    │
└──────────────────────────────────┘          │ Cost a year            $215      │
                                              │ 90% sure · 8 months of charges   │
                                              │ Yes: I ask the team to cancel.   │
                                              │ [ Yes ]  [ Not now ]          +2 │
                                              └──────────────────────────────────┘
```

- A compact card anchored above the chat's message box (in the panel or on `/chat`), or at
  the bottom of the hub on Home. Collapsed it is about 96 px tall; expanded it never takes more
  than a third of the chat's height (its details scroll inside it).
- Collapsed: an icon, the headline (at most nine words, one number), Yes and Not now, and
  "+2" for the cards waiting behind it, drawn as two card edges peeking out under it.
- The chevron opens the details in place: why, the figures, the confidence %, and what Yes
  does. The height animates (measured, Web Animations API) with the spring ease.
- Enter: up from 12 px below with a slight scale (0.98 → 1), 260 ms spring. Yes and Not now:
  the card slides out sideways (Yes right, Not now left) in 200 ms while the next one rises
  from the stack in the same frame. The next card is on screen within 100 ms of a tap (e2e).
- Reduced motion: no movement, a 120 ms fade only.
- Suggestions show in one place at a time: on Home, at the bottom of the hub; elsewhere, in
  the chat. The docked panel on Home leaves its suggestion cards out (the hub has them); full
  screen, it shows them.

## The feature map

`/home/map` ("What Jane does"), reached from the hub. One map per area, chosen with the same
tabs (a tab list inside the page).

```
                         ┌ Bills and fees ──┬─ Bank fees          for you ›
 Spending & bills ───────┼ Subscriptions ───┼─ Price rises
                         ├ Safe to spend    └─ Free trials ending
                         └ The books
```

- A left-to-right tree: area → capability groups → features. Click (or Enter) on a group
  opens it, and the view zooms smoothly so the group and its features fill the space
  (an SVG `viewBox` transition with the spring ease). Escape or the area node zooms out.
- A feature node shows one line, a "for you" badge when its detector has reached this person
  (they have a suggestion with that key, waiting or answered), and either a link to its page
  or "Ask Jane about this", which opens the chat with that question.
- Keyboard and screen readers: `role="tree"`, `treeitem` with `aria-expanded`, `aria-level`,
  `aria-setsize` and `aria-posinset`; one roving tab stop; arrow keys move up and down, Right
  opens or goes to the first child, Left closes or goes to the parent, Home and End jump.
- The tree is generated (`buildFeatureTree()`, `src/lib/feature-map.ts`): the areas from
  `src/config/areas.ts`, the groups from the chat's capability registry
  (`src/lib/jane-agent/capabilities`), and the features from every detector
  (`src/detectors`), each with the page its tools read (`PAGE_TOOLS`). The words are a
  one-line description per detector topic (`src/config/feature-lines.ts`, short, tested for
  length); a detector without one fails the test, so new features show up on the map.

## Accessibility and quality checks

- The area tabs are a `navigation` named "Main" with links (`aria-current="page"` on the
  current one), not ARIA tabs: each is a page.
- The side panel is a `complementary` region named "Chat with Jane"; its toggle buttons say
  what they do ("Collapse chat", "Open chat", "Expand chat", "Dock chat"), and the frame has a
  title. The bottom sheet is a `dialog` with focus moved into it and back to the Jane button.
- Charts have a text alternative (`role="img"` and an `aria-label` with the figures, or a
  visually hidden list).
- e2e: `hub.spec.ts`, `feature-map.spec.ts`, `side-chat.spec.ts`, run on both projects
  (desktop and phone); the accessibility spec covers `/home` and `/home/map`.
