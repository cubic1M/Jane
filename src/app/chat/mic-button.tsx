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
      className="inline-flex min-h-11 shrink-0 items-center px-1 text-sm font-semibold text-emerald-700 hover:underline disabled:opacity-60"
    >
      <span aria-hidden="true">[</span>
      {listening ? "Stop" : "Speak"}
      <span aria-hidden="true">]</span>
    </button>
  );
}
