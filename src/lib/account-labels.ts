// How a list of accounts names each one so no two read the same (area plan walk: /goals' "Track
// with" said "Demo Savings balance" twice for the family, whose savings comes in through two
// bank logins). The name with its last four digits, as the loan pages say it; when two still
// match, the one linked later says it came through another bank login. Jane can't prove they
// are the same account (books check), so neither is hidden.

export type LabelledAccount = { id: string; name: string; mask: string | null; createdAt: Date };

// `after` follows the name and digits, before the login note ("… ····2002 balance, through …").
export function accountLabels(
  accounts: readonly LabelledAccount[],
  after = "",
): Map<string, string> {
  const base = (a: LabelledAccount) => (a.mask ? `${a.name} ····${a.mask}` : a.name);
  const seen = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const a of [...accounts].sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())) {
    const name = base(a);
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    labels.set(a.id, `${name}${after}${count === 0 ? "" : ", through another bank login"}`);
  }
  return labels;
}
