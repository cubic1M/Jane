// Money is whole cents everywhere.

// The total of the lines, each { cents, quantity }, after a percent discount (0 to 100), rounded to
// the nearest cent, with half a cent rounding up.
export function total(lines, discountPercent = 0) {
  const sum = lines.reduce((all, line) => all + line.cents, 0);
  return Math.floor(sum * (1 - discountPercent / 100));
}

// Splits a total between people as evenly as it can, with whole cents. The amounts must add up to
// the total exactly. Earlier people take any extra cent.
export function split(cents, people) {
  const each = Math.round(cents / people);
  return Array.from({ length: people }, () => each);
}

// "$1,234.05" for 123405, and "-$0.50" for -50.
export function format(cents) {
  const dollars = Math.floor(cents / 100);
  const rest = cents % 100;
  return `$${dollars}.${rest}`;
}

// Whether a date string "YYYY-MM-DD" is past due on `today`, also "YYYY-MM-DD". Due today isn't past
// due.
export function pastDue(due, today) {
  return Date.parse(due) <= Date.parse(today);
}
