import type { PrismaClient } from "@/generated/prisma/client";
import { scopedFor } from "@/lib/db-scoped";
import { demoDocumentPartner } from "@/lib/tax-docs/demo";
import type { FetchedForm, TaxDocumentPartner } from "@/lib/tax-docs/types";
import type { DocumentBoxes } from "@/planning/tax-document-check";
import type { ExpectedForm } from "@/planning/tax-documents";
import { storeCredential, withCredential } from "../vault";
import { akoyaHttp, type AkoyaAccount, type AkoyaApi, type AkoyaStatement } from "./api";
import { formsFromStatements, type ReadForm } from "./normalize";

// Akoya as Jane's tax document partner (spec step 166): once a day in the season, the forms ready
// for the ones Jane expects. Each Akoya form is matched to an expected one by its account: Akoya's
// masked number against the last four of the person's own account whose name the expected form
// carries. With no such account (a 1099-R or 1099-G names a payer, not an account), a form is
// matched only when it's the one form of its kind and the one expected: Akoya's reference doesn't
// name the issuer's fields, so a payer's name is never guessed from them.

type Loaded = { accounts: AkoyaAccount[]; statements: AkoyaStatement[] };

const lastFour = (text: string | null | undefined) => (text ?? "").replace(/\D/g, "").slice(-4);

// The person's own accounts, by name and last four.
export type OwnAccount = { name: string; mask: string | null };

const ownAccounts = (userId: string, client: PrismaClient): Promise<OwnAccount[]> =>
  scopedFor(userId, client).accounts.findMany({ select: { name: true, mask: true } });

export function matchForms(
  year: number,
  expected: ExpectedForm[],
  loaded: Loaded,
  mine: readonly OwnAccount[],
): FetchedForm[] {
  const forms = formsFromStatements(loaded.statements, year);
  if (forms.length === 0) return [];
  const maskOf = new Map(
    loaded.accounts.map((a) => [a.accountId, lastFour(a.accountNumberDisplay)]),
  );
  const accountNameOf = (form: ReadForm) => {
    const four = form.accountId ? maskOf.get(form.accountId) : "";
    if (!four) return null;
    const same = mine.filter((a) => a.mask && lastFour(a.mask) === four);
    return same.length === 1 ? same[0]!.name : null;
  };
  const used = new Set<ReadForm>();
  const out: FetchedForm[] = [];
  for (const want of expected) {
    const kind = forms.filter((f) => f.formKey === want.formKey && !used.has(f));
    const byAccount = kind.find((f) => accountNameOf(f) === want.from);
    const onlyOne =
      kind.length === 1 && expected.filter((e) => e.formKey === want.formKey).length === 1
        ? kind[0]
        : undefined;
    const form = byAccount ?? onlyOne;
    if (!form) continue;
    used.add(form);
    out.push({ key: want.key, boxes: form.boxes });
  }
  return out;
}

// What Jane keeps in the vault for the person's Akoya link: the institution they shared from and
// the refresh token. JSON, encrypted by the vault like every credential.
export type AkoyaLink = { providerId: string; refreshToken: string };

const parseLink = (secret: string): AkoyaLink => {
  const link = JSON.parse(secret) as Partial<AkoyaLink>;
  if (typeof link.providerId !== "string" || typeof link.refreshToken !== "string") {
    throw new Error("Akoya link is incomplete");
  }
  return { providerId: link.providerId, refreshToken: link.refreshToken };
};

// The real partner: the person's link from the vault, a fresh id_token (a rotated refresh token is
// saved back), then every shared account's statements for the year.
export function akoyaPartner({
  api = akoyaHttp(),
  lastAccess,
}: {
  api?: AkoyaApi;
  lastAccess: Date;
}): TaxDocumentPartner {
  return {
    name: "akoya",
    async fetchForms(userId, year, expected, { client, today }) {
      const ready = expected.filter((f) => f.by <= today && !f.mayNotSend);
      if (ready.length === 0) return [];
      const loaded = await withCredential(
        userId,
        "akoya_tax",
        async (secret) => {
          const link = parseLink(secret);
          const tokens = await api.refresh(link.refreshToken);
          if (tokens.refreshToken && tokens.refreshToken !== link.refreshToken) {
            await storeCredential(
              userId,
              "akoya_tax",
              JSON.stringify({ ...link, refreshToken: tokens.refreshToken }),
              { client, linkRef: link.providerId },
            );
          }
          const accounts = await api.accounts(tokens.idToken, link.providerId, lastAccess);
          const statements = (
            await Promise.all(
              accounts.map((a) =>
                api.taxStatements(tokens.idToken, link.providerId, a.accountId, year, lastAccess),
              ),
            )
          ).flat();
          return { accounts, statements };
        },
        { client },
      );
      return matchForms(year, ready, loaded, await ownAccounts(userId, client));
    },
  };
}

// --- The sandbox twin -------------------------------------------------------------------------

// Akoya's reference gives the forms' fields but no example response, so the twin writes Akoya's
// shape from the demo partner's own figures (which agree with the sample accounts) and reads it
// back through the same mapping and matching as the real one. Only for sample data.

const dollars = (c: number | undefined) => (typeof c === "number" ? c / 100 : undefined);

function akoyaFormFor(formKey: string, boxes: DocumentBoxes, accountId: string) {
  const base = { accountId, corrected: false };
  switch (formKey) {
    case "int":
      return [
        {
          ...base,
          taxFormType: "Tax1099Int",
          tax1099Int: {
            interestIncome: dollars(boxes.interest),
            federalTaxWithheld: dollars(boxes.federalWithheld),
          },
        },
      ];
    case "brokerage": {
      const long = boxes.longTermGain ?? 0;
      return [
        {
          ...base,
          taxFormType: "Tax1099Div",
          tax1099Div: {
            ordinaryDividends: dollars(boxes.dividends),
            qualifiedDividends: dollars(boxes.qualifiedDividends),
          },
        },
        ...(boxes.proceeds
          ? [
              {
                ...base,
                taxFormType: "Tax1099B",
                tax1099B: {
                  securityDetails: [
                    { longOrShort: "LONG", salesPrice: dollars(long), costBasis: 0 },
                    {
                      longOrShort: "SHORT",
                      salesPrice: dollars(boxes.proceeds - long),
                      costBasis: dollars(boxes.costBasis ?? 0),
                      washSaleLossDisallowed: dollars(boxes.washDisallowed ?? 0),
                    },
                  ],
                },
              },
            ]
          : []),
      ];
    }
    case "r":
      return [
        {
          ...base,
          taxFormType: "Tax1099R",
          tax1099R: {
            grossDistribution: dollars(boxes.gross),
            taxableAmount: dollars(boxes.taxable),
          },
        },
      ];
    case "g":
      return [
        {
          ...base,
          taxFormType: "Tax1099G",
          tax1099G: { unemploymentCompensation: dollars(boxes.amount) },
        },
      ];
    case "nec":
      return [
        {
          ...base,
          taxFormType: "Tax1099Nec",
          tax1099Nec: { nonEmployeeCompensation: dollars(boxes.compensation) },
        },
      ];
    case "mortgage":
      return [
        {
          ...base,
          taxFormType: "Tax1098",
          tax1098: { mortgageInterest: dollars(boxes.interest), pointsPaid: dollars(boxes.points) },
        },
      ];
    case "student":
      return [
        {
          ...base,
          taxFormType: "Tax1098E",
          tax1098E: { studentLoanInterest: dollars(boxes.interest) },
        },
      ];
    default:
      return [];
  }
}

export const sandboxAkoyaPartner: TaxDocumentPartner = {
  name: "akoya (sandbox)",
  async fetchForms(userId, year, expected, options) {
    const demo = await demoDocumentPartner.fetchForms(userId, year, expected, options);
    const mine = await scopedFor(userId, options.client).accounts.findMany({
      select: { id: true, name: true, mask: true },
    });
    const accounts: AkoyaAccount[] = mine.map((a) => ({
      accountId: `sbx-${a.id}`,
      accountNumberDisplay: a.mask ? `...${a.mask}` : null,
    }));
    const statements: AkoyaStatement[] = demo.flatMap((form) => {
      const want = expected.find((e) => e.key === form.key);
      if (!want) return [];
      const account = mine.find((a) => a.name === want.from);
      const accountId = account ? `sbx-${account.id}` : `sbx-payer-${want.key}`;
      return [
        {
          taxYear: year,
          taxStatementId: `sbx-${want.key}`,
          forms: akoyaFormFor(want.formKey, form.boxes, accountId).map((f) => ({
            ...f,
            taxYear: year,
          })),
        },
      ];
    });
    return matchForms(year, expected, { accounts, statements }, mine);
  },
};
