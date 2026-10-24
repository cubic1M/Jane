"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { heardError, transcriptOf, type HeardResults } from "./speech";

// The microphone in Jane's message box (spec step 186). The browser's own speech
// recognition turns speech into the box's text; the person checks it and sends it like
// anything typed. Nothing is recorded or stored here. Where the browser can't listen, there
// is no button. A keyboard works it like any button (Escape stops), and what's happening is
// said in a status line for screen readers.

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: HeardResults }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  const ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return typeof ctor === "function" ? ctor : null;
}

const noSubscribe = () => () => {};

export function MicButton({
  onText,
  onStatus,
  disabled,
}: {
  onText: (text: string, final: boolean) => void;
  onStatus: (status: string) => void;
  disabled?: boolean;
}) {
  // Known only in the browser: none on the server.
  const supported = useSyncExternalStore(
    noSubscribe,
    () => recognitionCtor() !== null,
    () => false,
  );
  const [listening, setListening] = useState(false);
  const recognition = useRef<Recognition | null>(null);

  useEffect(() => () => recognition.current?.abort(), []);

  if (!supported) return null;

  function start() {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = navigator.language || "en-US";
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    r.onresult = (event) => {
      const { text, final } = transcriptOf(event.results);
      onText(text, final);
      if (final) onStatus("Got it. Check the words, then send.");
    };
    r.onerror = (event) => onStatus(heardError(event.error));
    r.onend = () => {
      setListening(false);
      recognition.current = null;
    };
    recognition.current = r;
    setListening(true);
    onStatus(
      "Listening… Your browser turns what you say into text; only the text you send reaches Jane.",
    );
    try {
      r.start();
    } catch {
      setListening(false);
      onStatus(heardError("failed"));
    }
  }

  const stop = () => recognition.current?.stop();

  return (
    <button
      type="button"
      onClick={listening ? stop : start}
      onKeyDown={(event) => {
        if (event.key === "Escape" && listening) stop();
      }}
      disabled={disabled}
      aria-pressed={listening}
      aria-label={listening ? "Stop listening" : "Speak your message"}
      title={listening ? "Stop listening" : "Speak"}
      data-listening={listening || undefined}
      className="mic-button inline-flex min-h-11 shrink-0 items-center gap-1.5 px-1 text-sm font-semibold hover:underline disabled:opacity-60"
    >
      <MicGlyph />
      {listening && (
        <span aria-hidden="true" className="inline-flex items-center gap-1.5 text-xs">
          <span className="mic-meter tabular-nums">
            {LEVELS.map((bar, i) => (
              <span key={i} style={{ animationDelay: `${i * 90}ms` }}>
                {bar}
              </span>
            ))}
          </span>
          <span className="mic-rec tracking-wider">● REC</span>
        </span>
      )}
    </button>
  );
}

// The meter's bars, each cycling through the heights (src/app/globals.css, .mic-meter): a
// sign that Jane is listening, not a reading of the sound.
const LEVELS = ["▁", "▃", "▅", "▇", "▂"];

// A microphone drawn in square pixels, like the rest of the terminal look.
const MIC_PIXELS: [number, number, number, number][] = [
  [4, 0, 4, 1],
  [3, 1, 6, 7],
  [4, 8, 4, 1],
  [1, 5, 1, 4],
  [10, 5, 1, 4],
  [2, 9, 1, 1],
  [9, 9, 1, 1],
  [3, 10, 6, 1],
  [5, 11, 2, 2],
  [3, 13, 6, 1],
];

function MicGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 12 14"
      width="15"
      height="18"
      shapeRendering="crispEdges"
      className="mic-glyph fill-current"
    >
      {MIC_PIXELS.map(([x, y, w, h]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={w} height={h} />
      ))}
    </svg>
  );
}
