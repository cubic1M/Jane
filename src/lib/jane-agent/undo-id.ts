// An Undo button's id: "undo.rule", "undo.snooze" ... and the plans' own ("multi.undo",
// "paycheck.undo", "tuneup.undo"). An answered message keeps its Undo, so every Undo is found here.
export const isUndoId = (id: string): boolean => id.startsWith("undo.") || id.endsWith(".undo");
