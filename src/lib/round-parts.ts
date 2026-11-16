// A sum shown in whole dollars whose lines still add up (gate B, "one number, one source"): each
// line rounded on its own can miss the rounded total by a dollar or two ($1,120.40 − $305.60 =
// $814.80 read "$1,120 − $306 = $815"). When the lines add up to the total in cents, each part is
// rounded so the parts add up to the total rounded as the tile rounds it, the dollar left over going
// to the part nearest the next dollar (largest remainder; on a tie the later part, so the balance a
// sum starts from keeps its own rounding). Otherwise each line is rounded on its own. Pure.

export type SignedLine = { sign: "" | "−" | "+" | "="; cents: number; unknown?: true };

const signOf = (sign: SignedLine["sign"]) => (sign === "−" ? -1 : 1);
// Whole dollars as the tile rounds them: the amount's size, so −$123.50 reads −$124 as $123.50
// reads $124 (formatWholeDollars on the size, the sign beside it).
const wholeDollars = (cents: number) => Math.sign(cents) * Math.round(Math.abs(cents) / 100);

// The cents each line shows, in whole dollars (a multiple of 100), in the lines' order.
export function wholeDollarParts(lines: readonly SignedLine[]): number[] {
  const each = lines.map((l) => wholeDollars(l.cents) * 100);
  const total = lines.findIndex((l) => l.sign === "=");
  if (total !== lines.length - 1 || lines.some((l) => l.unknown)) return each;
  const parts = lines.slice(0, total);
  const signed = parts.map((l) => signOf(l.sign) * l.cents);
  if (signed.reduce((s, c) => s + c, 0) !== lines[total]!.cents) return each;
  const target = wholeDollars(lines[total]!.cents);
  const floors = signed.map((c) => Math.floor(c / 100));
  let left = target - floors.reduce((s, d) => s + d, 0);
  const order = signed
    .map((c, i) => ({ i, remainder: c - floors[i]! * 100 }))
    .sort((a, b) => b.remainder - a.remainder || b.i - a.i);
  const dollars = [...floors];
  for (const { i } of order) {
    if (left <= 0) break;
    dollars[i]! += 1;
    left -= 1;
  }
  return [...dollars.map((d, i) => signOf(parts[i]!.sign) * d * 100), target * 100];
}
