// An Undo button's id: "undo.rule", "undo.snooze" ... and a plan's own "multi.undo", whose handler
// runs on the answered message. (paycheck.undo and tuneup.undo run on open messages only.)
export const isUndoId = (id: string): boolean => id.startsWith("undo.") || id === "multi.undo";
