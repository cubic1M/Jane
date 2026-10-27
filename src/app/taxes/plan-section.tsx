import { DemoAdviceLabel } from "@/components/demo-advice-label";
import type { PlanMoveView } from "@/lib/tax-plan";
import { PlanButtons } from "./plan-buttons";
import { dayLabel } from "@/lib/day-label";

// One move's state and its button, for the move's detail on the Taxes tree.
export function PlanMoveActions({ move: m, today }: { move: PlanMoveView; today: string }) {
  return (
    <>
      <p className="text-sm">
        {m.handled === "added"
          ? "On your deadlines."
          : m.handled === "no"
            ? "You said it's not for you."
            : m.opensOn > today
              ? `Jane brings it up on ${dayLabel(m.opensOn, { year: true })}.`
              : "Open now."}
      </p>
      {m.handled === null && m.opensOn <= today && <PlanButtons moveId={m.id} label={m.title} />}
      {m.advice && <DemoAdviceLabel />}
    </>
  );
}
