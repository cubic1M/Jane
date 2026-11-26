"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { localVoice, spokenText } from "./speech";

// "Read aloud" on Jane's messages (spec step 186): the browser's own speech, on request,
// one message at a time, with a voice on the device only. Nothing leaves the browser. No button where the browser can't
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
  // A tap that is waiting for the voices to load: dropped when the message leaves the page.
  const pending = useRef<(() => void) | null>(null);
  // Shown while the tap waits, so a second tap visibly cancels it.
  const [waiting, setWaiting] = useState(false);
  const clearPending = () => {
    setWaiting(false);
    if (pending.current)
      window.speechSynthesis?.removeEventListener?.("voiceschanged", pending.current);
    pending.current = null;
  };

  // Stop when the message leaves the page.
  useEffect(
    () => () => {
      clearPending();
      if (speaking) window.speechSynthesis.cancel();
    },
    [speaking],
  );

  if (!supported) return null;

  function toggle() {
    const synth = window.speechSynthesis;
    synth.cancel();
    // A tap that is still waiting for the voices is cancelled by the next tap, not read later.
    if (pending.current) {
      clearPending();
      return;
    }
    if (speaking) {
      setSpeaking(false);
      return;
    }
    const lang = navigator.language || "en-US";
    function start() {
      pending.current = null;
      setWaiting(false);
      // Only a voice on this device: a network voice would send the message to a speech service.
      const voice = localVoice(synth.getVoices(), lang);
      if (!voice) return;
      const utterance = new SpeechSynthesisUtterance(spokenText(...parts));
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      setSpeaking(true);
      synth.speak(utterance);
    }
    // Voices load late on some browsers: the first tap waits for them, once, instead of doing nothing.
    if (synth.getVoices().length === 0) {
      pending.current = start;
      setWaiting(true);
      synth.addEventListener?.("voiceschanged", start, { once: true });
      return;
    }
    start();
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={speaking || waiting}
      className="inline-flex min-h-11 items-center px-1 text-xs font-medium text-zinc-500 hover:underline"
    >
      {speaking || waiting ? "Stop reading" : "Read aloud"}
    </button>
  );
}
