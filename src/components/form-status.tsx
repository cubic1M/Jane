// What a form's server action said, read out to screen readers: green when it worked, red
// when it didn't, and hidden until there's something to say.
export function FormStatus({ state }: { state: { ok: boolean; message: string } | null }) {
  return (
    <p
      role="status"
      className={
        state ? (state.ok ? "text-sm text-emerald-800" : "text-sm text-red-700") : "sr-only"
      }
    >
      {state?.message ?? ""}
    </p>
  );
}
