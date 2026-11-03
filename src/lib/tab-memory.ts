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
