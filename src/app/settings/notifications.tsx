"use client";

import { useEffect, useState } from "react";

// Phone notifications for urgent alerts, on this device. Only shown when push is set up.

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4))
    .replaceAll("-", "+")
    .replaceAll("_", "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function registration() {
  return (
    (await navigator.serviceWorker.getRegistration()) ??
    (await navigator.serviceWorker.register("/sw.js"))
  );
}

export function NotificationsToggle({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<"loading" | "unsupported" | "off" | "on" | "blocked">(
    "loading",
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async (): Promise<typeof state> => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
      if (Notification.permission === "denied") return "blocked";
      try {
        return (await (await registration()).pushManager.getSubscription()) ? "on" : "off";
      } catch {
        return "unsupported";
      }
    };
    check().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function turnOn() {
    setBusy(true);
    try {
      if ((await Notification.requestPermission()) !== "granted") {
        setState("blocked");
        return;
      }
      const reg = await registration();
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(publicKey),
      });
      const response = await fetch("/api/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      setState(response.ok ? "on" : "off");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      const subscription = await (await registration()).pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setState("off");
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") return null;
  if (state === "unsupported") {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        This browser can&apos;t show notifications. On iPhone, add Jane to your home screen first.
      </p>
    );
  }
  if (state === "blocked") {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Notifications are blocked for this site in your browser settings.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="text-sm">
        {state === "on"
          ? "On for this device: urgent alerts arrive here instead of by email."
          : "Get urgent alerts on this device instead of by email."}
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={state === "on" ? turnOff : turnOn}
        className="inline-flex h-10 items-center rounded-full border border-zinc-300 px-4 text-sm font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        {state === "on" ? "Turn off" : "Turn on"}
      </button>
    </div>
  );
}
