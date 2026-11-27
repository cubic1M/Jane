export const LATE: unique symbol = Symbol("late");

// Waits for work only so long. The work isn't stopped: it carries on until it ends or the function
// does, so this is only for work that is safe to leave half done (as a function over its limit is).
export async function within<T>(ms: number, work: Promise<T>): Promise<T | typeof LATE> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<typeof LATE>((resolve) => {
    timer = setTimeout(() => resolve(LATE), ms);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}
