import Link from "next/link";
import type { AuditRecordsView } from "@/lib/audit-records";
import { formatCents } from "@/lib/money";
import type { Evidence } from "@/planning/audit-records";
import { RecordsButton } from "./records-button";

// Audit-ready records on /taxes (spec step 171): every deduction and credit with its
// sources, what's still needed, and how long to keep each year's records.

const CARD = "flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";
const LINK = "underline underline-offset-2";

const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

function EvidenceLine({ e }: { e: Evidence }) {
  switch (e.kind) {
    case "transaction":
      return (
        <Link href={`/transactions?q=${encodeURIComponent(e.payee)}`} className={LINK}>
          {e.payee}, {day(e.date)}, {formatCents(e.cents)}
          {e.receipt ? " (receipt on file)" : ""}
        </Link>
      );
    case "receipt":
      return (
        <Link href="/documents" className={LINK}>
          Receipt: {e.fileName}
        </Link>
      );
    case "form":
      return (
        <Link href="/taxes#forms" className={LINK}>
          {e.form} from {e.from}
        </Link>
      );
    case "loan":
      return <span>{e.name} (lender&apos;s figure)</span>;
    case "answer":
      return <span>{e.label}</span>;
  }
}

export function RecordsSection({ view }: { view: AuditRecordsView }) {
  return (
    <section aria-labelledby="records-heading" id="records" className={CARD}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="records-heading" className="text-xl font-semibold">
          Audit-ready records
        </h2>
        <a href={`/taxes/audit-pack/download?year=${view.year}`} className={LINK}>
          Download the {view.year} audit pack
        </a>
      </div>
      {view.items.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No deductions or credits for {view.year} to back up yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-3 text-sm">
          {view.items.map((i) => (
            <li key={i.label} className="flex flex-col gap-1">
              <details>
                <summary className="flex cursor-pointer flex-wrap justify-between gap-x-3">
                  <span className="font-medium">{i.label}</span>
                  <span>
                    {formatCents(i.claimedCents)}, {i.evidence.length}{" "}
                    {i.evidence.length === 1 ? "source" : "sources"}
                  </span>
                </summary>
                <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-zinc-600 dark:text-zinc-400">
                  {i.evidence.map((e, n) => (
                    <li key={n}>
                      <EvidenceLine e={e} />
                    </li>
                  ))}
                </ul>
              </details>
              {i.needs.map((n) => (
                <span key={n} className="font-medium">
                  Still needed: {n}
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
      {view.gaps.length > 0 && (
        <div className="text-sm">
          <p className="font-medium">Counted, but not in the pack: no source yet</p>
          <ul className="list-disc pl-5 text-zinc-600 dark:text-zinc-400">
            {view.gaps.map((g) => (
              <li key={g.label}>
                {g.label}, {formatCents(g.claimedCents)}: {g.needs.join(" ")}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="text-sm">
        <p className="font-medium">How long to keep it</p>
        <ul className="flex flex-col gap-2">
          {view.retention.map((r) => (
            <li key={r.year} className="flex flex-col gap-1">
              <span>
                {r.year}: keep until {day(r.keepUntil)}{" "}
                {r.status === "can_go"
                  ? "(can be thrown away)"
                  : r.status === "soon"
                    ? "(soon)"
                    : ""}
              </span>
              {r.status !== "keep" && <RecordsButton year={r.year} />}
            </li>
          ))}
        </ul>
        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
          {view.retention[0]?.rule} Jane never deletes anything.
        </p>
      </div>
    </section>
  );
}
