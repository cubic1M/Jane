"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { spokenText } from "./speech";

// "Read aloud" on Jane's messages (spec step 186): the browser's own speech, on request,
// one message at a time. Nothing leaves the browser. No button where the browser can't
// speak.

const noSubscribe = () => () => {};

export function ReadAloud({ parts }: { parts: (string | null | undefined)[] }) {
  // Known only in the browser: none on the server.
  const supported = useSyncExternalStore(
    noSubscribe,
    () => typeof window.speechSynthesis?.speak === "function",
    () => false,
  );
  const [speaking, setSpeaking] = useState(false);

  // Stop when the message leaves the page.
  useEffect(
    () => () => {
      if (speaking) window.speechSynthesis.cancel();
    },
    [speaking],
  );

  if (!supported) return null;

  function toggle() {
    const synth = window.speechSynthesis;
    synth.cancel();
    if (speaking) {
      setSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(spokenText(...parts));
    utterance.lang = navigator.language || "en-US";
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    synth.speak(utterance);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={speaking}
      className="inline-flex min-h-11 items-center px-1 text-xs font-medium text-zinc-500 hover:underline"
    >
      {speaking ? "Stop reading" : "Read aloud"}
    </button>
  );
}
