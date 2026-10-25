import Link from "next/link";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { AreaPage } from "@/components/area-page/area-page";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { ViewTracker } from "@/components/view-tracker";
import { TAX_TAG_ORDER, TAX_TAGS, TAX_YEAR, whatJaneDoes } from "@/config/tax";
import { TAXES_ANCHORS, TOPICS, itemId } from "@/lib/area-pages/taxes";
import { firstSentences } from "@/lib/area-pages/tree";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { loadTaxesArea, type ProfileField } from "@/lib/area-pages/taxes-load";
import { type TaxTagsView } from "@/lib/tax-organizer";
import { byHerself } from "@/lib/jane-agent/replies-autopilot";
import { type FieldStatus } from "@/planning/tax-profile";
import { EstimateSection } from "./estimate-section";
import { SavingActions } from "./savings-section";
import { InvestmentsSection } from "./investments-section";
import { RefundSection } from "./refund-section";
import { WithholdingSection } from "./withholding-section";
import { FormToggle } from "./form-toggle";
import { DocumentButtons } from "./document-buttons";
import { PlanMoveActions } from "./plan-section";
import { ConfirmDependants } from "./profile/confirm-dependants";
import { GivingSection } from "./giving-section";
import { FamilySection } from "./family-section";
import { SideIncomeSection } from "./side-income-section";
import { RecordsSection } from "./records-section";
import { HomeSection } from "./home-section";
import { type TaxDocumentsView } from "@/lib/tax-documents";
import { COMPARED } from "@/planning/tax-document-check";
import { LoadingBar } from "@/components/loading-bar";

// Taxes (spec steps 118–127): Jane keeps the person's taxes organised all year. The page is a
// tree (docs/design/area-pages.md): what's due soon, ways to pay less, this year's numbers,
// records and forms, their situation, the tax profile, filing and special cases. Each item's
// detail is the section it had before. Step 118: the tax profile, and what Jane does by
// herself at their autopilot level.

const CARD = "flex flex-col gap-3 border border-zinc-200 p-4 dark:border-zinc-800";
const LINK = "font-medium underline underline-offset-2 hover:no-underline";

const BADGE: Readonly<Record<FieldStatus, string>> = {
  yours: "Your answer",
  found: "Found by Jane: check it",
  missing: "Not set yet",
};

function Row({ label, value, status }: { label: string; value: string; status: FieldStatus }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-zinc-200 pt-2 first:border-0 first:pt-0 dark:border-zinc-800">
      <dt className="text-zinc-600 dark:text-zinc-400">{label}</dt>
      <dd className="flex flex-col items-end text-right">
        <span className="[overflow-wrap:anywhere]">{value}</span>
        <span className={`text-xs ${status === "yours" ? "text-zinc-500" : "font-semibold"}`}>
          {status === "yours" ? "" : "▲ "}
          {BADGE[status]}
        </span>
      </dd>
    </div>
  );
}

function ProfileCard({
  fields,
  complete,
  newIncome,
  confirm,
}: {
  fields: ProfileField[];
  complete: boolean;
  newIncome: string[];
  // "Are these your dependants?" when Jane found them (#660).
  confirm: ReactNode;
}) {
  return (
    <section aria-labelledby="profile" className={CARD}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="profile" className="text-xl font-semibold">
          Your tax profile
        </h2>
        <Link href="/taxes/profile" className={LINK}>
          {complete ? "Change it" : "Finish it"}
        </Link>
      </div>
      <dl className="flex flex-col gap-2 text-sm">
        {fields.map((f) => (
          <Row key={f.key} label={f.label} value={f.value} status={f.status} />
        ))}
      </dl>
      {confirm}
      {newIncome.length > 0 && (
        <p className="text-sm font-medium">
          New since you answered: {newIncome.join("; ")}.{" "}
          <Link href="/taxes/profile#income" className={LINK}>
            Add it
          </Link>
        </p>
      )}
    </section>
  );
}

function TagsCard({ tags, year }: { tags: TaxTagsView; year: number }) {
  return (
    <section aria-labelledby="organised" className={CARD}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="organised" className="text-xl font-semibold">
          Tagged for {year}
        </h2>
        <Link href="/taxes/tags" className={LINK}>
          See and change tags
        </Link>
      </div>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
        {TAX_TAG_ORDER.map((tag) => (
          <div key={tag} className="flex justify-between gap-2">
            <dt className="text-zinc-600 dark:text-zinc-400">{TAX_TAGS[tag].label}</dt>
            <dd className="whitespace-nowrap">{formatCents(tags.totals[tag].totalCents)}</dd>
          </div>
        ))}
      </dl>
      {tags.checks.length > 0 && (
        <p className="text-sm font-medium">
          Jane isn&apos;t sure about {tags.checks.length}{" "}
          {tags.checks.length === 1 ? "merchant" : "merchants"}.{" "}
          <Link href="/taxes/tags#checks" className={LINK}>
            Check them
          </Link>
        </p>
      )}
    </section>
  );
}

function FormsCard({ forms, year }: { forms: TaxDocumentsView; year: number }) {
  return (
    <section aria-labelledby="forms" className={CARD}>
      <h2 id="forms" className="text-xl font-semibold">
        Tax forms to expect for {year}
      </h2>
      {forms.forms.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          None from what&apos;s in your accounts.
        </p>
      ) : (
        <ul className="flex flex-col gap-3 text-sm">
          {forms.forms.map((f) => (
            <li key={f.key} className="flex flex-col gap-1">
              <span className="[overflow-wrap:anywhere]">
                <strong>{f.form}</strong> from {f.from}, for {f.what}
              </span>
              {f.document && f.check && (
                <span className={f.usable ? "" : "font-semibold"}>
                  {f.usable ? "■ " : "▲ "}
                  {f.check.status === "differs"
                    ? `Collected by Jane: it shows ${COMPARED[f.formKey]} of ${formatCents(f.check.formCents)}; your accounts show ${formatCents(f.check.seenCents ?? 0)}. ${f.usable ? "You said it's right, so it's used." : "Not used until you say it's right."}`
                    : f.check.status === "unchecked"
                      ? "Collected by Jane. Nothing in your accounts to check it against."
                      : "Collected by Jane: matches your accounts."}
                </span>
              )}
              {f.document && !f.usable && f.document.decision === null && (
                <DocumentButtons year={year} formKey={f.key} label={`${f.form} from ${f.from}`} />
              )}
              <span className="text-zinc-600 dark:text-zinc-400">
                {f.received
                  ? "Received"
                  : f.mayNotSend
                    ? "May not send one: below the reporting threshold. Your own records count."
                    : `Usually sent by ${new Date(`${f.by}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`}
              </span>
              <FormToggle
                year={year}
                formKey={f.key}
                received={f.received}
                label={`${f.form} from ${f.from}`}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Behind "More" only when the summary had to be cut.
const rest = (full: string) => (firstSentences(full) === full.trim() ? null : <p>{full}</p>);

async function TaxesContent({
  searchParams,
}: {
  searchParams: PageProps<"/taxes">["searchParams"];
}) {
  const user = await requireUser();
  await connection();
  const params = await searchParams;
  const focus = typeof params.focus === "string" ? params.focus : undefined;
  const now = new Date();
  const {
    today,
    year,
    view,
    taxes,
    tags,
    forms,
    estimate,
    advice,
    refunds,
    investments,
    savings,
    sideIncome,
    records,
    home,
    family,
    giving,
    plan,
    check,
    kids,
    fields,
    newIncome,
    area,
  } = await loadTaxesArea(user.id, { now });

  const details: Record<string, ReactNode> = {};
  const more: Record<string, ReactNode> = {};

  for (const m of plan.moves) {
    const id = itemId("soon", m.id);
    details[id] = <PlanMoveActions move={m} today={today} />;
    more[id] = rest(m.detail);
  }
  if (savings.advice)
    for (const s of savings.savings) {
      const id = itemId("savings", s.key);
      details[id] = (
        <>
          <SavingActions saving={s} year={savings.year} />
          <DemoAdviceLabel />
        </>
      );
      more[id] = (
        <>
          <p>{s.why}</p>
          <p className="text-xs text-zinc-500">
            Each saving is an estimate from your accounts and the {savings.year} tax figures.
          </p>
        </>
      );
    }

  details[itemId("estimate", "estimate")] = <EstimateSection view={estimate} />;
  details[itemId("estimate", "withholding")] = (
    <WithholdingSection view={{ estimate, check, advice }} />
  );
  details[itemId("estimate", "refund")] = <RefundSection refunds={refunds} />;
  details[itemId("estimate", "investments")] = (
    <InvestmentsSection view={investments} estimate={estimate} advice={advice} />
  );

  details[itemId("records", "forms")] = <FormsCard forms={forms} year={year} />;
  details[itemId("records", "tags")] = <TagsCard tags={tags} year={year} />;
  details[itemId("records", "audit")] = <RecordsSection view={records} />;

  details[itemId("life", "side-income")] = <SideIncomeSection view={sideIncome} advice={advice} />;
  details[itemId("life", "home")] = <HomeSection view={home} />;
  details[itemId("life", "family")] = <FamilySection view={family} />;
  details[itemId("life", "giving")] = <GivingSection view={giving} />;

  const profileCard = (
    <ProfileCard
      fields={fields}
      complete={view.complete}
      newIncome={newIncome}
      confirm={
        kids.status === "found" &&
        kids.childrenUnder17 !== null &&
        kids.otherDependants !== null && (
          <ConfirmDependants
            childrenUnder17={kids.childrenUnder17}
            otherDependants={kids.otherDependants}
            from={kids.from ?? "your accounts"}
          />
        )
      }
    />
  );
  for (const f of fields) details[itemId("profile", f.key)] = profileCard;
  details[itemId("profile", "new-income")] = profileCard;

  for (const branch of ["filing", "topics"] as const)
    for (const t of TOPICS[branch])
      details[itemId(branch, t.key)] = (
        <Link href={t.href} className={`${LINK} text-sm`}>
          {t.link}
        </Link>
      );

  return (
    <>
      <AppHeader user={user} />
      <ViewTracker event="taxes_viewed" />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Taxes: {TAX_YEAR}</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Kept organised all year from your accounts. Open a branch to see more.
        </p>
        <nav aria-label="Tax pages" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link prefetch={false} href="/taxes/file" className={LINK}>
            File
          </Link>
          <Link prefetch={false} href="/taxes/profile" className={LINK}>
            Profile
          </Link>
          <Link prefetch={false} href="/taxes/tags" className={LINK}>
            Tags
          </Link>
          <Link prefetch={false} href="/tax-pack" className={LINK}>
            Tax-time pack
          </Link>
        </nav>
      </div>

      <AreaPage
        tree={area.tree}
        label="Taxes"
        chips={area.chips}
        summaries={area.summaries}
        details={details}
        more={more}
        focus={focus}
        anchors={TAXES_ANCHORS}
      />

      {/* Below the tree: nothing open by default (docs/design/area-pages.md). */}
      <div className="flex flex-col gap-2">
        <details className="border-t border-zinc-200 pt-2 dark:border-zinc-800">
          <summary className={`cursor-pointer text-sm ${LINK}`}>What Jane does by herself</summary>
          <section aria-labelledby="by-herself" className="mt-2 flex flex-col gap-2 text-sm">
            <h2 id="by-herself" className="sr-only">
              What Jane does by herself
            </h2>
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {whatJaneDoes(taxes.level).map((line) => (
                <li key={line}>{line}</li>
              ))}
              {/* Spec step 141: what the Taxes area may do by itself, as Settings has it. */}
              <li>{byHerself(taxes)} Nothing is ever filed or signed without your tap.</li>
            </ul>
            <Link href="/settings#sectors" className={LINK}>
              Change your autopilot
            </Link>
          </section>
        </details>
        {!savings.advice && (
          <details className="border-t border-zinc-200 pt-2 dark:border-zinc-800">
            <summary className={`cursor-pointer text-sm ${LINK}`}>Ways to pay less</summary>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Suggestions on paying less tax will come once Jane works with a tax professional. Your
              estimate, tags and forms are all here meanwhile.
            </p>
          </details>
        )}
      </div>
    </>
  );
}

export default function TaxesPage({ searchParams }: PageProps<"/taxes">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
      <Suspense fallback={<LoadingBar />}>
        <TaxesContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
