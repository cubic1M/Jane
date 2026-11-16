// A card put away (Not now, the ✕, or "Don't suggest this again") can be brought back from the
// line left in its place (founder, 11-16: "there should be an option to go back to the suggestion
// that they just clicked close"). The line goes when the person answers another card or leaves the
// page; the server takes it back for this long after the answer, then says it's too late.
export const PUT_AWAY_UNDO_MINUTES = 60;

// The buttons left on a message put away: they bring it back as it was.
export const UNDO_SNOOZE = "undo.snooze";
export const UNDO_NEVER = "undo.never";

// What the line says, and its button.
export const PUT_AWAY_WORDS = "Put away.";
export const BRING_BACK_LABEL = "Bring it back";
