import { describe, expect, it } from "vitest";
import { FAILED, readAnswer } from "./read-answer";

// Beta (11-12): whatever happens while Jane's answer streams, the box ends with words to show,
// never a spinner that stays.

const encode = (text: string) => new TextEncoder().encode(text);

function streamOf(chunks: string[], { thenFail = false } = {}): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encode(chunk));
      if (thenFail) controller.error(new TypeError("network error"));
      else controller.close();
    },
  });
}

describe("reading Jane's answer", () => {
  it("passes on each line, a line split across chunks too, and ends at done", async () => {
    const seen: unknown[] = [];
    const failed = await readAnswer(
      streamOf([
        '{"type":"status","text":"Looking…"}\n{"type":"te',
        'xt","text":"Netflix is $17.99 a month."}\n',
        '{"type":"done"}\n',
      ]),
      (line) => seen.push(line),
    );
    expect(failed).toBeNull();
    expect(seen).toEqual([
      { type: "status", text: "Looking…" },
      { type: "text", text: "Netflix is $17.99 a month." },
    ]);
  });

  it("shows the server's own words for an error", async () => {
    const failed = await readAnswer(
      streamOf([
        '{"type":"error","text":"That\'s a lot of messages. Try again in a little while."}\n',
      ]),
      () => {},
    );
    expect(failed).toBe("That's a lot of messages. Try again in a little while.");
  });

  it("fails plainly when the connection drops, the stream ends early or a line is broken", async () => {
    const dropped = streamOf(['{"type":"status","text":"Looking…"}\n'], { thenFail: true });
    expect(await readAnswer(dropped, () => {})).toBe(FAILED);
    expect(await readAnswer(streamOf(['{"type":"text","text":"Half"}\n']), () => {})).toBe(FAILED);
    expect(await readAnswer(streamOf(["not json\n"]), () => {})).toBe(FAILED);
    expect(await readAnswer(streamOf([]), () => {})).toBe(FAILED);
  });
});
