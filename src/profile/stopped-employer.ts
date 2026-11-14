import { SALARY_DEPOSITS_MIN } from "@/config/profile";
import { employerName } from "./employer-name";
import { latestByPayer, payKeyOf, stoppedPayers } from "./stopped-payers";

// The employer whose paychecks stopped, going by where the data ends: an old statement isn't a lost
// job. Null with pay still coming, or too few paychecks to call it a job. Pure.
export function stoppedEmployer(data: {
  transactions: readonly {
    date: string;
    amountCents: number;
    description: string;
    pfc?: string | null;
  }[];
}): {
  name: string;
  lastDay: string;
  paychecks: number;
} | null {
  const salary = data.transactions.filter((t) => t.amountCents < 0 && t.pfc === "INCOME_SALARY");
  if (salary.length === 0) return null;
  const dataEnds = data.transactions.reduce((m, t) => (t.date > m ? t.date : m), "");
  // The same answer the profile and the tax estimate give (./stopped-payers.ts).
  const stopped = stoppedPayers(salary, dataEnds);
  const [key, last] = [...latestByPayer(salary)].sort((a, b) =>
    b[1].date.localeCompare(a[1].date),
  )[0];
  const paychecks = salary.filter((t) => payKeyOf(t.description) === key).length;
  return !stopped.has(key) || paychecks < SALARY_DEPOSITS_MIN
    ? null
    : { name: employerName(last.description), lastDay: last.date, paychecks };
}
