import Link from "next/link";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { AreaPage } from "@/components/area-page/area-page";
import { HorizontalBars } from "@/app/insights/bars";
import { SUGGESTION_NODES, dayLabel, itemId, moneyTree } from "@/lib/area-pages/money";
import { loadMoneyArea } from "@/lib/area-pages/money-load";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";

// Spending & bills (spec step 80; docs/design/area-pages.md): what matters now, the area's
// tree, and the detail of the one thing picked. Each detail links to the page that has the
// whole list or the form (/bills, /subscriptions, /budgets, /insights, /transactions,
// /transfers, /net-worth); the explanations wait behind "More".

const LINK = "font-medium text-emerald-700 hover:underline";
const MUTED = "text-sm text-zinc-600 dark:text-zinc-400";

function Go({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={`self-start text-sm ${LINK}`}>
      {children}
    </Link>
  );
}

function Rows({ rows }: { rows: { key: string; name: string; value: string }[] }) {
  return (
    <ul className="flex flex-col divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
      {rows.map((r) => (
        <li key={r.key} className="flex justify-between gap-4 py-1.5 [overflow-wrap:anywhere]">
          <span>{r.name}</span>
          <span className="shrink-0 font-medium tabular-nums">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

async function MoneyContent({
  searchParams,
}: {
  searchParams: PageProps<"/money">["searchParams"];
}) {
  const user = await requireUser();
  await connection();
  const params = await searchParams;
  const focus = typeof params.focus === "string" ? params.focus : undefined;
  const data = await loadMoneyArea(user.id);
  const area = moneyTree(data);

  const details: Record<string, ReactNode> = {};
  const more: Record<string, ReactNode> = {};

  for (const s of data.suggestions) {
    const action = data.actions[s.topic];
    const node = SUGGESTION_NODES[s.topic];
    if (!node || !action) continue;
    const id = itemId(node.branch, s.topic);
    if (action.href) details[id] = <Go href={action.href}>{action.label || "Open it"}</Go>;
    if (action.why) more[id] = <p className={MUTED}>{action.why}</p>;
  }

  for (const l of data.lows) {
    details[itemId("coming", `low-${l.accountId}`)] = <Go href="/bills">See the next month</Go>;
  }
  const billRows = (rows: typeof data.bills) =>
    rows.map((b) => ({
      key: `${b.merchant}-${b.date}`,
      name: `${dayLabel(b.date)} · ${b.merchant}`,
      value: formatCents(b.amountCents),
    }));
  const estimates = (
    <p className={MUTED}>
      Regular charges we expect, from your past transactions. Dates and amounts are estimates.
    </p>
  );
  details[itemId("coming", "week")] = (
    <Rows rows={billRows(data.bills.filter((b) => b.date <= data.weekEnds))} />
  );
  more[itemId("coming", "week")] = estimates;
  details[itemId("coming", "month")] = (
    <>
      <Rows rows={billRows(data.bills)} />
      <Go href="/bills">Coming up, by account</Go>
    </>
  );
  more[itemId("coming", "month")] = estimates;

  for (const r of data.recurring) {
    if (r.findingId)
      details[itemId("subscriptions", r.key)] = (
        <Go href={`/report/${r.findingId}`}>Cancel or review</Go>
      );
  }
  const yearlyRows = (subscription: boolean) =>
    data.recurring
      .filter((r) => r.subscription === subscription)
      .map((r) => ({
        key: r.key,
        name: r.merchant,
        value: `${formatCents(r.annualCostCents)} a year`,
      }));
  details[itemId("subscriptions", "all")] = (
    <>
      <Rows rows={yearlyRows(true)} />
      <Go href="/subscriptions">Every regular charge</Go>
    </>
  );
  if (yearlyRows(false).length > 0) {
    more[itemId("subscriptions", "all")] = (
      <>
        <p className="text-sm font-semibold">Other regular bills</p>
        <Rows rows={yearlyRows(false)} />
        <p className={MUTED}>Yearly and quarterly renewals get an alert a week ahead.</p>
      </>
    );
  }

  for (const p of data.budgets.progress) {
    const share = Math.min(100, Math.round((p.spentCents / p.budgetCents) * 100));
    details[itemId("budgets", p.category)] = (
      <>
        <div
          role="progressbar"
          aria-label={`${p.category} budget used`}
          aria-valuenow={share}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
        >
          <div
            className={`h-full ${p.over ? "bg-red-600" : "bg-emerald-600"}`}
            style={{ width: `${share}%` }}
          />
        </div>
        <Go href="/budgets">Change your budgets</Go>
      </>
    );
  }
  details[itemId("budgets", "set")] = <Go href="/budgets">Set a budget</Go>;

  for (const y of data.yearly) {
    details[itemId("yearly", y.key)] = <Go href="/budgets#yearly">All your yearly bills</Go>;
    more[itemId("yearly", y.key)] = (
      <p className={MUTED}>
        Bills that come less often than monthly, spread over the year. Safe to spend on Home already
        takes this month&apos;s share off. Math from your data, not a recommendation.
      </p>
    );
  }

  details[itemId("spending", "month")] = <Go href="/insights">Month by month</Go>;
  more[itemId("spending", "month")] = (
    <p className={MUTED}>
      Moving money between your own accounts and paying off cards isn&apos;t counted as spending.
    </p>
  );
  if (data.spending) {
    details[itemId("spending", "top")] = (
      <>
        <HorizontalBars
          rows={data.spending.categories
            .slice(0, 5)
            .map((c) => ({ label: c.category, cents: c.cents }))}
        />
        <Go href="/insights">Where your money goes</Go>
      </>
    );
    if (data.topMerchants.length > 0) {
      more[itemId("spending", "top")] = (
        <>
          <p className="text-sm font-semibold">Where you spend the most</p>
          <Rows
            rows={data.topMerchants.map((m) => ({
              key: m.merchant,
              name: m.merchant,
              value: formatCents(m.cents),
            }))}
          />
        </>
      );
    }
    for (const c of data.spending.changes) {
      details[itemId("spending", `up-${c.category}`)] = (
        <Go href="/budgets">Set a budget for it</Go>
      );
    }
  }

  for (const b of data.books) {
    const fix = data.fixes[b.id];
    if (fix) details[itemId("books", b.id)] = <Go href={fix.href}>{fix.label}</Go>;
  }

  for (const t of data.transfers) {
    details[itemId("transfers", t.id)] = (
      <Go href="/transfers">{t.status === "pending" ? "Undo it on Transfers" : "All transfers"}</Go>
    );
  }

  details[itemId("have", "net-worth")] = <Go href="/net-worth">Net worth, month by month</Go>;
  if (data.missing.length > 0) {
    more[itemId("have", "net-worth")] = (
      <p className={MUTED}>
        Not included, because there&apos;s no balance: {data.missing.join(", ")}. Add a balance on
        the{" "}
        <Link href="/import" className={LINK}>
          import page
        </Link>
        .
      </p>
    );
  }
  details[itemId("have", "investments")] = <Go href="/investments">See what&apos;s in them</Go>;
  details[itemId("have", "owned")] = (
    <Go href={data.have.owned === 0 && data.assetPromptHref ? data.assetPromptHref : "/things"}>
      {data.have.owned > 0 ? "Things you own" : "Add what it's worth"}
    </Go>
  );
  details[itemId("have", "goals")] = <Go href="/goals">Your savings goals</Go>;
  details[itemId("have", "loans")] = <Go href="/loans">Loans and credit</Go>;

  details[itemId("transactions", "find")] = (
    <form action="/transactions" className="flex gap-2" role="search">
      <label htmlFor="money-q" className="sr-only">
        Search by merchant
      </label>
      <input
        id="money-q"
        name="q"
        placeholder="Search by merchant"
        className="h-11 min-w-0 flex-1 rounded-full border border-zinc-300 bg-transparent px-4 dark:border-zinc-700"
      />
      <button
        type="submit"
        className="h-11 rounded-full border border-zinc-300 px-5 font-semibold dark:border-zinc-700"
      >
        Search
      </button>
    </form>
  );
  details[itemId("transactions", "rules")] = <Go href="/transactions">See or remove them</Go>;

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Spending & bills</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          What goes out, at a glance. Open a branch to see more.
        </p>
        <nav
          aria-label="Spending and bills pages"
          className="flex flex-wrap gap-x-4 gap-y-1 text-sm"
        >
          <Link href="/bills" className={LINK}>
            Coming up
          </Link>
          <Link href="/subscriptions" className={LINK}>
            Subscriptions
          </Link>
          <Link href="/budgets" className={LINK}>
            Budgets
          </Link>
          <Link href="/insights" className={LINK}>
            Where it goes
          </Link>
          <Link href="/transactions" className={LINK}>
            Transactions
          </Link>
          <Link href="/net-worth" className={LINK}>
            Net worth
          </Link>
        </nav>
      </div>

      {!data.hasAccounts && (
        <p className="bg-emerald-50 p-4 dark:bg-emerald-950">
          Link a bank to fill this in.{" "}
          <Link href="/connect" className={LINK}>
            Link an account
          </Link>
        </p>
      )}

      <AreaPage
        tree={area.tree}
        label="Spending & bills"
        chips={area.chips}
        summaries={area.summaries}
        details={details}
        more={more}
        focus={focus}
      />

      {/* Below the tree: nothing open by default (docs/design/area-pages.md). */}
      <details className="border-t border-zinc-200 pt-2 dark:border-zinc-800">
        <summary className={`cursor-pointer text-sm ${LINK}`}>Your files</summary>
        <p className={`mt-2 ${MUTED}`}>
          Policies, warranties and receipts are in{" "}
          <Link href="/documents" className={LINK}>
            Policies and receipts
          </Link>
          ; your cover is in{" "}
          <Link href="/insurance" className={LINK}>
            Insurance
          </Link>
          .
        </p>
      </details>
    </>
  );
}

export default function MoneyPage({ searchParams }: PageProps<"/money">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <MoneyContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
