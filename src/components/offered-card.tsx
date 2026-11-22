import type { offeredCard } from "@/lib/offered-card";

// The card that opened this page, its figure and how it was worked out (src/lib/offered-card.ts),
// loaded by the page.
export function OfferedCard({ card }: { card: Awaited<ReturnType<typeof offeredCard>> }) {
  if (!card) return null;
  return (
    <section
      id="card"
      aria-labelledby="card-title"
      className="flex flex-col gap-1 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <h2 id="card-title" className="font-semibold">
        {card.headline}
      </h2>
      <p className="text-sm">{card.why}</p>
    </section>
  );
}
