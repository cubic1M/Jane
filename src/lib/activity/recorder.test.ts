import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rageClickFields, startRecorder } from "./recorder";

// Just enough of an element: the recorder only reads these.
const element = (tagName: string, innerText: string) =>
  ({
    tagName,
    innerText,
    closest: () => null,
    querySelector: () => null,
    getAttribute: () => null,
  }) as unknown as Element;

describe("a rage click", () => {
  vi.stubGlobal("HTMLInputElement", class {});

  // A triple click selects text, so a chat bubble's words went on the activity log, up to 80
  // characters kept 180 days, though /privacy says "not what you typed".
  it("keeps no words from plain text", () => {
    const words = element("P", "something the person wrote");
    expect(rageClickFields(null, words).label).toBeUndefined();
  });

  it("names something meant to be clicked", () => {
    const button = element("BUTTON", "Save");
    expect(rageClickFields(button, button)).toEqual({ role: "button", label: "Save" });
  });
});

// A page's document, just enough for the recorder's listeners: no DOM in these tests.
class FakeElement extends EventTarget {
  tagName = "BUTTON";
  innerText = "Send";
  visibilityState = "visible";
  closest() {
    return this;
  }
  getAttribute() {
    return null;
  }
  querySelector() {
    return null;
  }
}

// The chat panel is /chat?embed=1 in a frame, loaded on every page once it's idle, before anyone
// opens it (night QA 11-03): /admin/activity said everyone "opened Chat" on every visit.
describe("startRecorder in the chat panel's frame", () => {
  const sent = () =>
    vi
      .mocked(fetch)
      .mock.calls.flatMap(
        ([, init]) => (JSON.parse(String(init?.body)) as { events: { kind: string }[] }).events,
      );
  let recorder: ReturnType<typeof startRecorder>;
  let doc: FakeElement;
  let win: EventTarget;

  beforeEach(() => {
    vi.useFakeTimers();
    doc = new FakeElement();
    win = new EventTarget();
    vi.stubGlobal("Element", FakeElement);
    vi.stubGlobal("HTMLInputElement", class {});
    vi.stubGlobal("document", doc);
    vi.stubGlobal("window", win);
    vi.stubGlobal("sessionStorage", { getItem: () => "visit", setItem: () => {} });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ recording: true }))),
    );
  });
  afterEach(() => {
    recorder.stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("records nothing while it only sits loaded", async () => {
    recorder = startRecorder({ framed: true });
    recorder.page("/chat");
    await vi.advanceTimersByTimeAsync(60_000);
    win.dispatchEvent(new Event("pagehide"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent()).toEqual([]);
  });

  it("counts as a page view once the person does something in it", async () => {
    recorder = startRecorder({ framed: true });
    recorder.page("/chat");
    doc.dispatchEvent(new Event("click"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent().map((e) => e.kind)).toEqual(["page_view", "click"]);
  });

  it("is a page view straight away outside a frame", async () => {
    recorder = startRecorder();
    recorder.page("/settings");
    await vi.advanceTimersByTimeAsync(0);
    expect(sent().map((e) => e.kind)).toEqual(["page_view"]);
  });
});
