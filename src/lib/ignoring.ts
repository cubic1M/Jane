// Runs `fn` and lets an error of one kind go: the thing was already done, gone or not allowed,
// and the page shows it as it is. Any other error still throws.
export async function ignoring(
  kind: abstract new (...args: never[]) => Error,
  fn: () => Promise<unknown>,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (!(error instanceof kind)) throw error;
  }
}
