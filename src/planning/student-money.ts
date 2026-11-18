import {
  CAMPUS_HOUSING,
  SCHOOL_PAYER,
  SCHOOL_PAYROLL_WORDS,
  SCHOOL_REFUND_WORDS,
  STIPEND_MIN_CENTS,
  STIPEND_WORDS,
  TUITION_MIN_CENTS,
  TUITION_WORDS,
} from "@/config/student-taxes";
import { normalizeDescription } from "@/data-sources/merchant";
import type { ProfileInput, ProfileTx } from "@/profile/build";

// A student's money as their bank shows it (suggest-taxes, 11-18): what a school paid them that
// isn't pay for work (a fellowship's stipend, or a refund from the student account), pay from a
// school's payroll, tuition they paid, student-loan payments, rent and whether it went to campus
// housing. Only the tax year's rows (the calendar year of `today`). Pure.

export type StudentMoney = {
  year: number;
  // Deposits from a school that aren't payroll, at least STIPEND_MIN_CENTS each.
  schoolDeposits: ProfileTx[];
  // Whether any says what it is ("STIPEND", "FELLOWSHIP"); otherwise they only say "REFUND".
  stipendNamed: boolean;
  // Pay from a school's payroll (wages, withheld, on a W-2), and all wages.
  schoolPay: ProfileTx[];
  wages: ProfileTx[];
  tuition: ProfileTx[];
  loanPayments: ProfileTx[];
  rent: ProfileTx[];
  campusRent: ProfileTx[];
};

const lineOf = (t: ProfileTx) => normalizeDescription(t.description).replace(/ DES:/g, " ");
const isWage = (t: ProfileTx) => t.pfc === "INCOME_SALARY" || t.pfc === "INCOME_WAGES";

export function studentMoney(data: Pick<ProfileInput, "transactions" | "today">): StudentMoney {
  const year = Number(data.today.slice(0, 4));
  const rows = data.transactions.filter(
    (t) => t.date.startsWith(`${year}-`) && t.date <= data.today,
  );
  const fromSchool = rows.filter((t) => t.amountCents < 0 && SCHOOL_PAYER.test(lineOf(t)));
  const schoolPay = fromSchool.filter((t) => SCHOOL_PAYROLL_WORDS.test(lineOf(t)) || isWage(t));
  const schoolDeposits = fromSchool.filter(
    (t) =>
      !schoolPay.includes(t) &&
      -t.amountCents >= STIPEND_MIN_CENTS &&
      (STIPEND_WORDS.test(lineOf(t)) || SCHOOL_REFUND_WORDS.test(lineOf(t))) &&
      // Money back from a store or a card isn't from the school's student account.
      !(t.pfc ?? "").startsWith("TRANSFER_IN"),
  );
  const toSchool = rows.filter((t) => t.amountCents > 0 && SCHOOL_PAYER.test(lineOf(t)));
  const rent = rows.filter(
    (t) =>
      t.amountCents > 0 && (t.pfc === "RENT_AND_UTILITIES_RENT" || CAMPUS_HOUSING.test(lineOf(t))),
  );
  return {
    year,
    schoolDeposits,
    stipendNamed: schoolDeposits.some((t) => STIPEND_WORDS.test(lineOf(t))),
    schoolPay,
    wages: rows.filter((t) => t.amountCents < 0 && (isWage(t) || schoolPay.includes(t))),
    tuition: toSchool.filter(
      (t) =>
        t.amountCents >= TUITION_MIN_CENTS &&
        !CAMPUS_HOUSING.test(lineOf(t)) &&
        (TUITION_WORDS.test(lineOf(t)) || t.pfc === "GENERAL_SERVICES_EDUCATION"),
    ),
    loanPayments: rows.filter(
      (t) => t.amountCents > 0 && t.pfc === "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT",
    ),
    rent,
    campusRent: rent.filter((t) => CAMPUS_HOUSING.test(lineOf(t))),
  };
}

export const sumCents = (list: readonly ProfileTx[]) =>
  list.reduce((s, t) => s + Math.abs(t.amountCents), 0);
