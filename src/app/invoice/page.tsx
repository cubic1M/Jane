import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { PageShell } from "@/components/page-shell";
import { explanationWords } from "@/lib/jane-agent/charge-explain";
import { loadChargeExplanation } from "@/lib/jane-agent/invoice-for-charge";
import { requireUser } from "@/lib/session";
import { InvoiceForm } from "./invoice-form";

// What the bank can't show (founder 11-24): paste an invoice's text and Jane lists its line items and,
// set against the charge it is for, the ones that explain the difference from what you usually pay.
// Read by rules, in memory, and not kept. A PDF or a picture can't be read here.

const MUTED = "text-zinc-600 dark:text-zinc-400";

async function Invoice({ searchParams }: { searchParams: PageProps<"/invoice">["searchParams"] }) {
  const user = await requireUser();
  const { charge } = await searchParams;
  const id = typeof charge === "string" && charge ? charge : null;
  const explanation = id ? await loadChargeExplanation(user.id, id) : null;
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Read an invoice</h1>
        <p className={MUTED}>
          Your bank&apos;s line shows who was paid and how much, not why. Paste the text of the
          invoice here and I&apos;ll list its line items. It&apos;s read here and not kept.
        </p>
      </div>
      {explanation && (
        <p className="text-sm">{explanationWords(explanation).slice(0, 2).join(" ")}</p>
      )}
      <InvoiceForm charge={explanation ? id : null} />
      <p className={`text-sm ${MUTED}`}>
        I can read text, not a PDF or a picture: open the invoice, copy its text and paste it here.
        Each line item should end with its amount, like &ldquo;Pro plan $20.00&rdquo;.
      </p>
      <Link href="/chat" className="text-sm font-medium text-zinc-900 underline dark:text-zinc-100">
        Back to the chat
      </Link>
    </>
  );
}

export default function InvoicePage({ searchParams }: PageProps<"/invoice">) {
  return (
    <PageShell>
      <Invoice searchParams={searchParams} />
    </PageShell>
  );
}
