// Reading Jane's answer as it streams from /api/chat/send (src/app/chat/composer.tsx): one JSON
// object a line, "status", "text" and "reset" while it's written, then "done" or "error". Whatever
// happens on the way (the connection drops, the server is stopped at its time limit, a line comes
// broken), the box ends with words to show, never a spinner that stays.

type StreamLine =
  | { type: "status"; text: string }
  | { type: "text"; text: string }
  | { type: "reset" }
  | { type: "done" }
  | { type: "error"; text: string };

export const FAILED = "Something went wrong. Try again.";

// The longest the box waits for an answer: past the route's own 60 seconds (maxDuration), so the
// server's "error" comes first when there is one.
export const ANSWER_WAIT_MS = 75_000;

// Hands each line to `on` until "done" (null) or a failure (the words to show).
export async function readAnswer(
  body: ReadableStream<Uint8Array>,
  on: (line: Exclude<StreamLine, { type: "done" } | { type: "error" }>) => void,
): Promise<string | null> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return FAILED;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines.filter(Boolean)) {
        const event = JSON.parse(line) as StreamLine;
        if (event.type === "error") return event.text || FAILED;
        if (event.type === "done") return null;
        on(event);
      }
    }
  } catch {
    // A dropped connection, the wait running out (the fetch's signal) or a broken line.
    return FAILED;
  } finally {
    reader.cancel().catch(() => {});
  }
}
