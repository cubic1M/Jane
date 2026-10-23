// Jane's mark: a small square with "J_", the terminal look of the rest of the app.
export function JaneAvatar({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center bg-emerald-700 font-bold text-white ${
        size === "lg" ? "size-11 text-base" : "size-8 text-xs"
      }`}
    >
      J_
    </span>
  );
}
