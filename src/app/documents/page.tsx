import Link from "next/link";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { ViewTracker } from "@/components/view-tracker";
import {
  DOCUMENT_KINDS,
  DOCUMENT_TYPES,
  MAX_DOCUMENTS,
  MAX_DOCUMENT_BYTES,
  POLICY_TYPES,
  PREMIUM_FREQUENCIES,
  type DocumentContentType,
  type DocumentKind,
  type PolicyType,
  type PremiumFrequency,
} from "@/config/documents";
import { scopedDb } from "@/lib/db-scoped";
import { documentTitle } from "@/lib/documents/dates";
import { PROVIDER_LABELS, rawFacts } from "@/lib/documents/facts";
import { DOCUMENT_SELECT } from "@/lib/documents/store";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { deleteDocument } from "./actions";
import { FactsSection, UploadForm } from "./forms";

// Insurance policies, warranties and receipts (spec step 68).

const LINK = "font-medium text-emerald-700 hover:underline";

const dateLabel = (date: Date) =>
  date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

const sizeLabel = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const SOURCE_NOTE: Record<string, string> = {
  claude: "Jane read these facts from the file. Check them and fix anything that's off.",
  you: "Facts you entered.",
  none: "No facts yet. Fill them in so Jane can use them.",
};

async function DocumentsContent() {
  const user = await requireUser();
  const db = await scopedDb();
  const documents = await db.documents.findMany({
    select: DOCUMENT_SELECT,
    orderBy: [{ uploadedAt: "desc" }, { id: "asc" }],
  });

  return (
    <>
      <AppHeader email={user.email} />
      <ViewTracker event="documents_viewed" />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Policies and receipts</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Keep your insurance policies, warranties and receipts here. Jane reads the key facts, like
          the price and the renewal date, and uses them on your insurance card and your deadlines.
          Files are encrypted, and only you can open them.
        </p>
      </div>

      <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-xl font-semibold">Add a document</h2>
        <UploadForm />
        <p className="text-xs text-zinc-500">
          {Object.values(DOCUMENT_TYPES)
            .map((t) => t.label)
            .join(", ")}{" "}
          files up to {MAX_DOCUMENT_BYTES / 1024 / 1024} MB, and up to {MAX_DOCUMENTS} files in all.
        </p>
      </section>

      {documents.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          Nothing here yet. Start with your car or home insurance policy: Jane will show its renewal
          date and price on your insurance card.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {documents.map((d) => {
            const kind = d.kind as DocumentKind;
            const frequency = PREMIUM_FREQUENCIES[d.premiumFrequency as PremiumFrequency];
            const facts: [string, string][] = [];
            if (d.provider) facts.push([PROVIDER_LABELS[kind], d.provider]);
            const policyType = POLICY_TYPES[d.policyType as PolicyType];
            if (policyType) facts.push(["Type", policyType]);
            if (d.premiumCents !== null && frequency) {
              facts.push(["Price", `${formatCents(d.premiumCents)} ${frequency.label}`]);
            }
            if (d.renewalDate) facts.push(["Renews on", dateLabel(d.renewalDate)]);
            if (d.warrantyEndsOn) facts.push(["Warranty ends", dateLabel(d.warrantyEndsOn)]);
            if (d.purchaseDate) facts.push(["Bought on", dateLabel(d.purchaseDate)]);
            if (d.purchaseAmountCents !== null) {
              facts.push(["Price paid", formatCents(d.purchaseAmountCents)]);
            }
            const type = DOCUMENT_TYPES[d.contentType as DocumentContentType]?.label ?? "File";
            return (
              <li
                key={d.id}
                className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 [overflow-wrap:anywhere] dark:border-zinc-800"
              >
                <div className="flex flex-col gap-1">
                  <h2 className="font-semibold">{documentTitle(d)}</h2>
                  <span className="text-sm text-zinc-500">
                    {DOCUMENT_KINDS[kind] ?? "Document"} · {type} · {sizeLabel(d.sizeBytes)} · added{" "}
                    {dateLabel(d.uploadedAt)}
                  </span>
                </div>
                {d.coverageSummary && <p>{d.coverageSummary}</p>}
                {facts.length > 0 && (
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                    {facts.map(([label, value]) => (
                      <div key={label} className="min-w-0">
                        <dt className="text-zinc-500">{label}</dt>
                        <dd className="font-medium">{value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <p className="text-xs text-zinc-500">
                  {SOURCE_NOTE[d.extractionSource] ?? SOURCE_NOTE.none}
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {/* PDFs only download: Chrome won't show one sandboxed. */}
                  {d.contentType !== "application/pdf" && (
                    <a
                      href={`/api/documents/${d.id}`}
                      target="_blank"
                      rel="noopener"
                      className={LINK}
                    >
                      Open<span className="sr-only"> {d.fileName}</span>
                    </a>
                  )}
                  <a href={`/api/documents/${d.id}?download=1`} className={LINK}>
                    Download<span className="sr-only"> {d.fileName}</span>
                  </a>
                </div>
                <FactsSection
                  needsFacts={d.extractionSource === "none"}
                  documentId={d.id}
                  kind={kind}
                  values={rawFacts(d)}
                />
                <details>
                  <summary className="cursor-pointer text-xs text-zinc-500">
                    Delete this file
                  </summary>
                  <form action={deleteDocument} className="mt-2 flex flex-wrap items-center gap-3">
                    <input type="hidden" name="documentId" value={d.id} />
                    <span className="text-sm">This removes the file and its facts for good.</span>
                    <button
                      type="submit"
                      className="text-sm font-semibold text-red-700 hover:underline"
                    >
                      Yes, delete it
                    </button>
                  </form>
                </details>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        &quot;Download my data&quot; on{" "}
        <Link href="/settings" className={LINK}>
          Settings
        </Link>{" "}
        lists these documents and their facts; the files themselves download from here.
      </p>
    </>
  );
}

export default function DocumentsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <DocumentsContent />
      </Suspense>
    </main>
  );
}
