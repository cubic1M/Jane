import { MAX_AFFORD_CENTS } from "@/config/afford";
import { parseMoneyToCents } from "@/lib/money";
import { AFFORD_COPY } from "./afford-copy";
import { affordWindow, monthOf, type AffordChange } from "./afford";

// The "Can I afford this?" form lives in the URL (?kind=…&amount=…&date=…&month=…), so a
// result can be shared or bookmarked and nothing is saved (spec step 69).

export const AFFORD_KINDS = ["purchase", "more", "less"] as const;
export type AffordKind = (typeof AFFORD_KINDS)[number];

export type AffordForm = { kind: AffordKind; amount: string; date: string; month: string };

export type AffordQuery = {
  form: AffordForm;
  // Null until an amount is entered, or when something in the form isn't right.
  change: AffordChange | null;
  error: string | null;
};

type Params = Record<string, string | string[] | undefined>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const one = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value)?.trim() ?? "";

export function parseAffordQuery(params: Params, asOf: string): AffordQuery {
  const { months, until } = affordWindow(asOf);
  const kindParam = one(params.kind);
  const form: AffordForm = {
    kind: (AFFORD_KINDS as readonly string[]).includes(kindParam)
      ? (kindParam as AffordKind)
      : "purchase",
    amount: one(params.amount),
    date: one(params.date) || asOf,
    month: one(params.month) || monthOf(asOf),
  };
  const fail = (error: string): AffordQuery => ({ form, change: null, error });

  if (!form.amount) return { form, change: null, error: null };
  const cents = parseMoneyToCents(form.amount);
  if (cents === null || cents <= 0) return fail(AFFORD_COPY.errors.amount);
  if (cents > MAX_AFFORD_CENTS) return fail(AFFORD_COPY.errors.tooBig);

  if (form.kind === "purchase") {
    const valid = DATE.test(form.date) && !Number.isNaN(Date.parse(form.date));
    if (!valid || form.date < asOf || form.date > until) return fail(AFFORD_COPY.errors.date);
    return { form, change: { kind: "purchase", amountCents: cents, date: form.date }, error: null };
  }
  if (!MONTH.test(form.month) || !months.includes(form.month)) {
    return fail(AFFORD_COPY.errors.month);
  }
  return {
    form,
    change: {
      kind: "monthly",
      amountCents: form.kind === "more" ? cents : -cents,
      startMonth: form.month,
    },
    error: null,
  };
}
