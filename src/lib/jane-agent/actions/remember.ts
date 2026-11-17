import { scopedFor } from "@/lib/db-scoped";
import { savePreference } from "../preferences";
import { findingNo } from "./finding";
import { UNDO_SUGGEST_NEVER } from "@/config/put-away";
import { ChatActionError, putAwayUndo, type ActionHandler } from "./handler";

// Spec step 91: Jane remembers, only on the person's tap.
// "Remember this" saves what they told it (refs.preference). "Don't suggest again" on a
// suggestion is a No to it (with its Undo, like No on its card) and a promise: the
// suggestion, or the same one found again later, never comes back. From a card it can be brought
// back for a while (undo.suggest_never, src/lib/jane-agent/actions/undo.ts).

const wrong = () => new ChatActionError("failed", "Something went wrong. Try again.");

export const prefSave: ActionHandler = {
  id: "pref.save",
  on: "open",
  async run({ userId, message, action, client }) {
    const draft = message.refs.preference;
    if (!draft) throw wrong();
    await savePreference(userId, draft, { client });
    return {
      answeredWith: action.label,
      note: "Saved. I'll use it from now on. You can see or delete it in Settings.",
    };
  },
};

export const suggestNever: ActionHandler = {
  id: "suggest.never",
  on: "open",
  async run(context) {
    const { userId, message, action, client, now } = context;
    const db = scopedFor(userId, client);
    const note = "OK. I won't suggest this again. You can change that in Settings.";
    // Whether the person had already said so, so bringing it back deletes only what this saved.
    const existed = async (key: string) =>
      (await db.janePreferences.count({ where: { kind: "never", key } })) > 0;
    const { findingId } = message.refs;
    if (findingId) {
      const finding = await db.findings.findFirst({
        where: { id: findingId },
        select: { key: true, title: true },
      });
      if (!finding) throw new ChatActionError("not_found", "That's not there anymore.");
      const key = `finding:${finding.key}`;
      const had = await existed(key);
      const no = await findingNo.run(context);
      await savePreference(
        userId,
        { kind: "never", key, value: {}, label: `Don't suggest: ${finding.title}` },
        { client },
      );
      return {
        ...no,
        answeredWith: action.label,
        note,
        ...putAwayUndo(message, UNDO_SUGGEST_NEVER, now, {
          ...(no.refs?.decisionId ? { decisionId: no.refs.decisionId } : {}),
          neverPreference: { key, existed: had },
        }),
      };
    }
    const row = await db.janeMessages.findFirst({
      where: { id: message.id },
      select: { dedupeKey: true },
    });
    if (!row) throw wrong();
    const key = `message:${row.dedupeKey}`;
    const had = await existed(key);
    await savePreference(
      userId,
      {
        kind: "never",
        key,
        value: {},
        label: `Don't suggest: ${message.body.split("\n")[0].slice(0, 120)}`,
      },
      { client },
    );
    return {
      status: "dismissed",
      answeredWith: action.label,
      note,
      ...putAwayUndo(message, UNDO_SUGGEST_NEVER, now, {
        neverPreference: { key, existed: had },
      }),
    };
  },
};
