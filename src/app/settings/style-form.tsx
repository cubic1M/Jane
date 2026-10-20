import {
  LENGTH_LABELS,
  VOICE_LABELS,
  type Length,
  type Style,
  type Voice,
} from "@/lib/jane-agent/style";
import type { Posting } from "@/lib/jane-agent/preferences";
import { saveStyle } from "./memory-actions";

// How Jane talks (spec step 188): answer length, numbers first or plain words first, and how
// often she posts. Saved on Save, the same as saying it in the chat and tapping Remember.
const LABEL = "flex flex-col gap-1 text-sm font-medium";
const SELECT =
  "min-h-11 rounded-none border border-zinc-400 bg-transparent px-2 text-base dark:border-zinc-600";

export function StyleForm({ style, posting }: { style: Style; posting: Posting }) {
  return (
    <form action={saveStyle} className="flex flex-col gap-3">
      <label className={LABEL}>
        Answer length
        <select name="length" defaultValue={style.length} className={SELECT}>
          {(Object.keys(LENGTH_LABELS) as Length[]).map((k) => (
            <option key={k} value={k}>
              {LENGTH_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
      <label className={LABEL}>
        How answers read
        <select name="voice" defaultValue={style.voice} className={SELECT}>
          {(Object.keys(VOICE_LABELS) as Voice[]).map((k) => (
            <option key={k} value={k}>
              {VOICE_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
      <label className={LABEL}>
        How often Jane posts
        <select name="posting" defaultValue={posting} className={SELECT}>
          <option value="daily">One message each morning, then only what&apos;s urgent</option>
          <option value="as_they_come">Things as they come</option>
        </select>
      </label>
      <button
        type="submit"
        className="inline-flex min-h-11 w-fit items-center border border-emerald-700 px-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950"
      >
        Save how Jane talks
      </button>
    </form>
  );
}
