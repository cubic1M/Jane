// Jane's mark: a small square with "J_", the terminal look of the rest of the app. Only a mark:
// never a link or a button (the controls beside it are labelled).
export function JaneAvatar({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <span
      aria-hidden
      data-jane-logo=""
      className={`inline-flex shrink-0 cursor-default select-none items-center justify-center bg-emerald-700 font-bold text-white ${
        size === "lg" ? "size-11 text-base" : "size-8 text-xs"
      }`}
    >
      J_
    </span>
  );
}
