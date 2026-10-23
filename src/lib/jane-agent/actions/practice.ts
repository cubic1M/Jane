import { savePreferences } from "@/lib/practice/preferences";
import { describeChanges, type PreferencePatch } from "@/planning/practice-preferences";
import { ChatActionError, type ActionHandler } from "./handler";

// Phase AW: "Make the change" on a practice-settings card from the chat. It saves what the card
// showed through savePreferences: the same check as the settings page, and the audit log.
// Practice money only.

export const practicePrefsSave: ActionHandler = {
  id: "practice.prefs_save",
  on: "open",
  async run({ userId, message, action, client, now }) {
    const patch = message.refs.practicePrefs as PreferencePatch | undefined;
    if (!patch || Object.keys(patch).length === 0) {
      throw new ChatActionError("failed", "Something went wrong. Try again.");
    }
    const saved = await savePreferences(userId, patch, "chat", { client, now });
    if (!saved.ok) {
      throw new ChatActionError(
        "failed",
        `That can't be saved: ${Object.values(saved.errors).join(" ")}`,
      );
    }
    const lines = describeChanges(saved.before, saved.preferences, saved.changed);
    return {
      answeredWith: action.label,
      note:
        lines.length > 0
          ? `Done. ${lines.join("; ")}. Jane uses it from the next run.`
          : "Those settings were already set that way.",
    };
  },
};
