// A federal filing date as the IRS observes it: the calendar day, moved to the next business day when
// it falls on a weekend or on the observed Emancipation Day (April 16, the Friday before when it falls
// on a Saturday and the Monday after when it falls on a Sunday: the April 2023 and 2022 deadlines were
// April 18). April's and October's dates meet no other federal holiday. Pure; ISO days in and out.
// (The estimated-payment dates have their own copy in src/detectors/taxes.ts, which also moves
// January's for Martin Luther King Jr. Day.)

const isEmancipationDay = (d: Date) => {
  if (d.getUTCMonth() !== 3) return false;
  const day = d.getUTCDate();
  const dow = d.getUTCDay();
  return (
    (day === 16 && dow >= 1 && dow <= 5) || (day === 15 && dow === 5) || (day === 17 && dow === 1)
  );
};

export function observedFilingDay(isoDay: string): string {
  const at = new Date(`${isoDay}T00:00:00Z`);
  while (at.getUTCDay() === 0 || at.getUTCDay() === 6 || isEmancipationDay(at)) {
    at.setUTCDate(at.getUTCDate() + 1);
  }
  return at.toISOString().slice(0, 10);
}
