// The place a key rotation reached, for the key it was moving values to: the last value dealt with
// in a store, or none yet (src/lib/key-rotation.ts).
export type Checkpoint = { target: string; store: string; after: string | null };

// A checkpoint as the admin page carries it from one press to the next. Anything else is none.
export const checkpointText = ({ target, store, after }: Checkpoint) =>
  JSON.stringify([target, store, after]);

export function checkpointFrom(text: unknown): Checkpoint | undefined {
  if (typeof text !== "string") return undefined;
  try {
    const [target, store, after] = JSON.parse(text) as unknown[];
    if (typeof target !== "string" || typeof store !== "string") return undefined;
    if (after !== null && typeof after !== "string") return undefined;
    return { target, store, after };
  } catch {
    return undefined;
  }
}

// A run that couldn't be put on record, so nothing was moved.
export class RotationNotRecordedError extends Error {}
