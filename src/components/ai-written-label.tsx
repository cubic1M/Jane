import { AI_WRITTEN_LABEL } from "@/config/advice";

// Under a chat answer Claude wrote about investing or taxes, so the person knows AI was
// involved (Anthropic's Usage Policy from Nov 12, 2026; src/config/advice.ts).
export function AiWrittenLabel({ className = "" }: { className?: string }) {
  return (
    <p
      role="note"
      data-ai-written=""
      className={`text-xs text-zinc-600 dark:text-zinc-400 ${className}`}
    >
      {AI_WRITTEN_LABEL}
    </p>
  );
}
