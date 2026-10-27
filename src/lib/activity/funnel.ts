// The beta funnel on /admin/activity: signed up, then uploaded or linked, then saw findings, then
// acted on a card. Pure; src/lib/activity/admin.ts reads who reached each step.

export type FunnelInput = {
  users: string[];
  linked: Set<string>;
  sawFindings: Set<string>;
  acted: Set<string>;
};

export type FunnelStep = { name: string; people: number; ofPrevious: number | null };

export const FUNNEL_STEPS = [
  "Signed up",
  "Uploaded or linked",
  "Saw findings",
  "Acted on a card",
] as const;

const gates = ({ linked, sawFindings, acted }: FunnelInput) => [null, linked, sawFindings, acted];

// Each step counts the people who also reached every step before it.
export function computeFunnel(input: FunnelInput): FunnelStep[] {
  let reached = input.users;
  return gates(input).map((set, i) => {
    const before = reached.length;
    if (set) reached = reached.filter((id) => set.has(id));
    return {
      name: FUNNEL_STEPS[i],
      people: reached.length,
      ofPrevious: i === 0 || before === 0 ? null : reached.length / before,
    };
  });
}

// The last step one person reached, every step before it included.
export function furthestStep(id: string, input: FunnelInput): (typeof FUNNEL_STEPS)[number] {
  const passed = gates(input).findIndex((set) => set !== null && !set.has(id));
  return FUNNEL_STEPS[passed === -1 ? FUNNEL_STEPS.length - 1 : passed - 1];
}
