// Where the time goes between "Try Jane" and a chat that takes a question (depth bar 4): one
// log line per stage with the milliseconds of each phase, like chat_timing. Counts and
// durations only, never anything about the person.

export type Phases = {
  mark: (name: string) => void;
  done: (extra?: Record<string, unknown>) => void;
};

export function phaseTimer(kind: string): Phases {
  const started = Date.now();
  let last = started;
  const phases: Record<string, number> = {};
  return {
    mark(name) {
      const now = Date.now();
      phases[name] = now - last;
      last = now;
    },
    done(extra = {}) {
      console.info(
        "trial_timing",
        JSON.stringify({ kind, ...phases, ...extra, totalMs: Date.now() - started }),
      );
    },
  };
}
