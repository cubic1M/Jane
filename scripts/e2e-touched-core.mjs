// Which end-to-end specs a change could break (npm run e2e:touched). A PR runs only the @critical
// specs and the spec files it changes, so twice in twelve hours an area page's change passed its PR
// and failed main: #2161 broke e2e/insurance.spec.ts:66, #2166 e2e/hubs.spec.ts:20 (11-20). Pure.
//
// A spec is chosen when:
// - it changed;
// - it opens a page a changed file renders: src/app/<route>/** is that route,
//   src/lib/area-pages/<area>*.ts that area's page, and src/components/hub/** or src/lib/hub/** the
//   hubs (Home and every area page);
// - a shared area-page file changed whose page can't be told (src/lib/area-pages/tree.ts): every
//   area page;
// - it still expects wording a change removed (./e2e-wording-core.mjs).
import { staleWording } from "./e2e-wording-core.mjs";

// The area pages; Home draws their hubs, so a hub's change is Home's too.
export const AREA_ROUTES = ["/insurance", "/loans", "/money", "/taxes", "/investments", "/ahead"];
const HUB_ROUTES = ["/home", ...AREA_ROUTES];
// An area module's name to its page, where they differ.
const AREA_OF = { investing: "/investments" };

// Where npm run e2e:touched keeps the commit it last passed on, inside the worktree's git dir.
export const PASS_FILE = "e2e-touched-pass";

// Whether a push must wait for npm run e2e:touched: the branch changes a file that renders a page,
// and the last pass wasn't on this commit. The paths that render one, or [] when it may go.
export function pushNeedsE2e({ changedPaths, head, passedOn }) {
  if (passedOn && passedOn.trim() === head) return [];
  return changedPaths.filter((p) => {
    const routes = routesOf(p);
    return routes === null || routes.length > 0;
  });
}

// The routes a changed file renders: [] when it renders no page we can name, null when it renders
// area pages but which isn't known.
export function routesOf(path) {
  // A unit test or a fixture renders no page (#2166's regular-charges-line.test.ts read as a shared
  // area file and chose every area page).
  if (/\.test\.tsx?$|\/__fixtures__\//.test(path)) return [];
  if (/^src\/(?:components|lib)\/hub\//.test(path)) return HUB_ROUTES;
  const area = /^src\/lib\/area-pages\/([a-z]+)[-.]/.exec(path);
  if (area) {
    const route = AREA_OF[area[1]] ?? `/${area[1]}`;
    return AREA_ROUTES.includes(route) ? [route] : null;
  }
  if (path.startsWith("src/lib/area-pages/")) return null;
  const app = /^src\/app\/(.+)$/.exec(path);
  if (!app) return [];
  // The first segment a person sees: route groups ("(auth)") aren't in the address.
  const segments = app[1].split("/").filter((s) => !/^\(.*\)$/.test(s));
  if (segments[0] === "api" || segments.length === 0) return [];
  // A file of the app's own root (layout.tsx, globals.css) is on every page: the hubs' set.
  if (segments.length === 1) return segments[0] === "page.tsx" ? ["/"] : HUB_ROUTES;
  return [`/${segments[0]}`];
}

// The pages a spec opens, by their first segment ("/insurance/claims" is /insurance): its goto()
// paths, every path it names when it opens one from a list (goto(path) in a loop), and the pages
// the helpers it imports open. A spec that crawls (./crawl) opens every page: "*".
export function routesIn(text, helpers = new Map()) {
  const routes = new Set();
  const first = (path) => `/${path.split(/[/?#]/)[1] ?? ""}`;
  for (const m of text.matchAll(/goto\(\s*["'`](?:\$\{\w+\})?(\/[a-z][a-z0-9-]*)/g))
    routes.add(first(m[1]));
  if (/goto\(CHAT\b/.test(text)) routes.add("/chat");
  if (/goto\(\s*(?!CHAT\b)[a-z_]\w*\s*[,)]/i.test(text)) {
    for (const m of text.matchAll(/["'`](\/[a-z][a-z0-9-]*)(?=[/?#"'`$])/g)) routes.add(m[1]);
    if (/["'`]\/["'`]/.test(text)) routes.add("/");
  }
  for (const m of text.matchAll(/from\s+"\.\/([\w-]+)"/g)) {
    if (m[1] === "crawl") routes.add("*");
    for (const r of helpers.get(m[1]) ?? []) routes.add(r);
  }
  return routes;
}

// How close a reason is to the change, for a cap: a changed spec, then one that opens the very page
// a change renders or expects its removed words, then one picked for a set of pages (a shared area
// file, the hubs, the app's root).
const RANK = { changed: 0, page: 1, set: 2 };

// The specs to run, each with why and its closest reason's rank: [{ file, why: [...], rank }], in
// file order.
export function touchedSpecs({ changedPaths, diff = "", specs }) {
  const chosen = new Map();
  const ranks = new Map();
  // Whether a spec's file is named for a page it was chosen for (e2e/insurance-compare.spec.ts for
  // /insurance, e2e/hubs.spec.ts for the hubs): within a rank, those first.
  const named = new Set();
  const add = (file, why, rank = RANK.page, routes = []) => {
    chosen.set(file, [...new Set([...(chosen.get(file) ?? []), why])]);
    ranks.set(file, Math.min(rank, ranks.get(file) ?? rank));
    const base = file.replace(/^e2e\//, "");
    const forPage = routes.some((r) => r.length > 1 && base.startsWith(r.slice(1, 4)));
    // A set of pages' own specs: the hubs and the area pages as a whole.
    const forSet = rank === RANK.set && /^(?:hubs?|area|home)[-.]/.test(base);
    if (forPage || forSet) named.add(file);
  };
  const isSpec = (f) => /^e2e\/.*\.spec\.ts$/.test(f);
  const known = new Set(specs.map((s) => s.file));
  for (const path of changedPaths)
    if (isSpec(path) && known.has(path)) add(path, "changed", RANK.changed);
  // The helpers' own pages (e2e/demo-upload.ts opens /import), for the specs that import them.
  const helpers = new Map(
    specs
      .filter((s) => !isSpec(s.file))
      .map((s) => [s.file.replace(/^e2e\//, "").replace(/\.ts$/, ""), routesIn(s.text)]),
  );
  const visits = specs
    .filter((s) => isSpec(s.file))
    .map((s) => ({ ...s, routes: routesIn(s.text, helpers) }));
  for (const path of changedPaths.filter((p) => p.startsWith("src/"))) {
    const routes = routesOf(path);
    const wanted = routes ?? AREA_ROUTES;
    const reason = routes === null ? `${path} is shared by the area pages` : `${path} renders`;
    const rank = routes === null || routes.length > 1 ? RANK.set : RANK.page;
    for (const spec of visits) {
      const hit = spec.routes.has("*") ? wanted : wanted.filter((r) => spec.routes.has(r));
      if (hit.length > 0) add(spec.file, `${reason} ${hit.join(", ")}`, rank, hit);
    }
  }
  // One reason a spec, the first run of words it still expects (each four-word run is a hit).
  const stale = new Map();
  for (const { file, wording } of staleWording(
    diff,
    specs.filter((s) => isSpec(s.file)),
  )) {
    if (!stale.has(file)) stale.set(file, wording);
  }
  for (const [file, wording] of stale) add(file, `still expects "${wording}"`);
  return [...chosen]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, why]) => ({ file, why, rank: ranks.get(file), named: named.has(file) }));
}

// At most `cap` of them, the closest first and then in file order: what a run past the cap leaves
// out is said, never silently dropped.
export function capSpecs(chosen, cap) {
  const kept = [...chosen]
    .sort(
      (a, b) =>
        a.rank - b.rank || Number(b.named) - Number(a.named) || a.file.localeCompare(b.file),
    )
    .slice(0, cap)
    .map((c) => c.file)
    .sort();
  const left = chosen.filter((c) => !kept.includes(c.file)).map((c) => c.file);
  return { files: kept, left };
}
