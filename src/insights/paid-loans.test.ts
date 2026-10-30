import { describe, expect, it } from "vitest";
import { debtBook, type DebtAccountInput } from "./debts";
import { paidLoans, type PaidLoanPayment } from "./paid-loans";

const AS_OF = "2026-10-30";

const pay = (date: string, amountCents: number, description: string, pfcDetailed: string) =>
  ({ date, amountCents, description, merchantName: null, pfcDetailed }) satisfies PaidLoanPayment;

// Night QA 10-30: a person paying Nelnet $212.40 a month from checking read "No loans, cards or
// plans yet" on /loans.
const NELNET = ["2026-08-10", "2026-09-10", "2026-10-10"].map((d) =>
  pay(d, 21_240, "NELNET DES:STUDNTLOAN ID:XXXXX", "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT"),
);
const TOYOTA = ["2026-08-03", "2026-09-03", "2026-10-03"].map((d) =>
  pay(d, 38_900, "TOYOTA MOTOR CR DES:AUTO PMT ID:XXXXX", "LOAN_PAYMENTS_CAR_PAYMENT"),
);

describe("paidLoans", () => {
  it("finds a loan per lender from its payments, with the next one due", () => {
    expect(paidLoans([...NELNET, ...TOYOTA], AS_OF)).toEqual([
      expect.objectContaining({
        key: "auto:toyota motor cr",
        kind: "auto",
        paymentCents: 38_900,
        paymentsMade: 3,
        nextDate: "2026-11-03",
      }),
      expect.objectContaining({ key: "student:nelnet", kind: "student", nextDate: "2026-11-10" }),
    ]);
  });

  it("needs two payments, the last one recent", () => {
    expect(paidLoans(NELNET.slice(-1), AS_OF)).toEqual([]);
    expect(paidLoans(NELNET.slice(0, 2), "2027-01-30")).toEqual([]);
  });
});

describe("debtBook with loans seen in payments", () => {
  it("lists them with no balance until the person types one", () => {
    const book = debtBook(
      { accounts: [], plans: [], typed: [], paid: paidLoans(NELNET, AS_OF) },
      AS_OF,
    );
    expect(book.debts).toEqual([
      expect.objectContaining({
        key: "paid:student:nelnet",
        name: "Nelnet student loan",
        kind: "student",
        balanceCents: null,
        paymentCents: 21_240,
        paymentFrom: "payments",
        inNetWorth: false,
      }),
    ]);
    const typed = debtBook(
      {
        accounts: [],
        plans: [],
        typed: [
          {
            debtKey: "paid:student:nelnet",
            aprBps: 499,
            minimumPaymentCents: null,
            balanceCents: 1_840_000,
            payoffDate: null,
            updatedOn: "2026-10-30",
          },
        ],
        paid: paidLoans(NELNET, AS_OF),
      },
      AS_OF,
    );
    expect(typed.debts[0]).toMatchObject({ balanceCents: 1_840_000, balanceFrom: "typed" });
    expect(typed.totalOwedCents).toBe(1_840_000);
  });

  it("leaves one out once a loan account of its kind is on file", () => {
    const studentLoan: DebtAccountInput = {
      id: "nelnet",
      name: "Nelnet",
      mask: null,
      type: "loan",
      subtype: "student",
      currentBalanceCents: 1_840_000,
      liability: null,
    };
    const book = debtBook(
      { accounts: [studentLoan], plans: [], typed: [], paid: paidLoans(NELNET, AS_OF) },
      AS_OF,
    );
    expect(book.debts.map((d) => d.key)).toEqual(["account:nelnet"]);
  });
});
