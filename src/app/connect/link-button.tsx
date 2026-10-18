"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { sendEvent } from "@/lib/analytics-client";

// Opens Plaid Link. With an itemId it opens update mode, so the person can sign in to
// that bank again. Plaid's script is loaded the first time the button is pressed.

const LINK_SCRIPT = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

type LinkMetadata = { institution?: { name?: string } | null };
type PlaidLink = {
  create(config: {
    token: string;
    onSuccess: (publicToken: string, metadata: LinkMetadata) => void;
    onExit: (error: unknown) => void;
  }): { open(): void };
};

function loadPlaid(): Promise<PlaidLink> {
  const existing = (window as unknown as { Plaid?: PlaidLink }).Plaid;
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = LINK_SCRIPT;
    script.onload = () => resolve((window as unknown as { Plaid: PlaidLink }).Plaid);
    script.onerror = () => reject(new Error("Plaid Link didn't load"));
    document.head.appendChild(script);
  });
}

async function post(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    ok: response.ok,
    body: (await response.json().catch(() => ({}))) as Record<string, string>,
  };
}

export function LinkButton({
  itemId,
  label,
  className,
}: {
  itemId?: string;
  label: string;
  className: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setError(null);
    try {
      const token = await post("/api/plaid/link-token", itemId ? { itemId } : {});
      if (!token.ok) throw new Error(token.body.error ?? "Couldn't start linking.");
      const Plaid = await loadPlaid();
      Plaid.create({
        token: token.body.linkToken,
        onSuccess: async (publicToken, metadata) => {
          if (itemId) {
            // Update mode keeps the same item; Plaid's webhook triggers the next sync.
            router.refresh();
            setBusy(false);
            return;
          }
          const saved = await post("/api/plaid/exchange", {
            publicToken,
            institutionName: metadata.institution?.name ?? null,
          });
          if (!saved.ok) {
            setError(saved.body.error ?? "Linking didn't finish. Please try again.");
            setBusy(false);
            return;
          }
          router.push("/scanning");
        },
        onExit: (exitError) => {
          if (exitError) sendEvent("link_failed");
          setBusy(false);
        },
      }).open();
    } catch (e) {
      sendEvent("link_failed");
      setError(e instanceof Error ? e.message : "Couldn't start linking.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={open} disabled={busy} className={className}>
        {busy ? "Opening…" : label}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
