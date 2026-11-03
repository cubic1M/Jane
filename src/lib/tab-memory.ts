// What a tab remembers for the session (the dock's last cards, what was asked) holds the person's
// money in plain text, and stays readable after signing out unless it's cleared. A shared computer's
// next person would see it.
export function forgetThisTab(): void {
  try {
    window.sessionStorage.clear();
  } catch {
    // Private window or storage blocked: nothing was kept.
  }
}

// A notification goes to the browser, not the session: left on, the next person here sees this
// person's chat messages. Its row goes the next time the push service says it's gone (src/lib/push.ts).
export async function stopPushHere(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    const subscription = await registration?.pushManager?.getSubscription();
    await subscription?.unsubscribe();
  } catch {
    // Nothing to stop, or the browser won't say: signing out goes on.
  }
}
