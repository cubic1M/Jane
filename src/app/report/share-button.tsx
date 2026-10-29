"use client";

import { useState } from "react";
import { cardHeadline, cardImagePath, type ShareCard } from "@/lib/share-card";
import { prepareShare, shareSent } from "./share-actions";
import { sendLink, usesShareSheet } from "./share-send";

// The report's Share button: a tap shows the card exactly as friends will see it, with what
// goes out (the card and an invite link, nothing else), while the link is made in the
// background. Then the phone's share sheet, or on a computer the link copied. No spinner: the
// card is drawn from what the page already knows.

const BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-full px-5 text-sm font-semibold disabled:opacity-60";
const PRIMARY = `${BUTTON} bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200`;
const SECONDARY = `${BUTTON} border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900`;

export function ShareButton({ card: initial }: { card: ShareCard }) {
  const [open, setOpen] = useState(false);
  const [card, setCard] = useState(initial);
  const [link, setLink] = useState<string | null>(null);
  const [phone, setPhone] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  function preview() {
    setOpen(true);
    setNote(null);
    setPhone(usesShareSheet(navigator, window.matchMedia("(pointer: coarse)").matches));
    if (link) return;
    prepareShare()
      .then((prepared) => {
        if ("error" in prepared) {
          setFailed(true);
          setNote(prepared.error);
          return;
        }
        setCard(prepared.card);
        setLink(`${window.location.origin}${prepared.path}`);
      })
      .catch(() => {
        setFailed(true);
        setNote("Couldn't make your link. Try again in a moment.");
      });
  }

  async function send() {
    if (!link) return;
    const result = await sendLink(navigator, { url: link, text: cardHeadline(card), sheet: phone });
    setNote(result.note);
    if (result.sent) void shareSent(result.sent);
  }

  if (!open) {
    return (
      <div data-share="">
        <button type="button" onClick={preview} className={SECONDARY}>
          Share
        </button>
      </div>
    );
  }

  return (
    <section
      data-share="open"
      aria-labelledby="share-title"
      className="flex flex-col gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800"
    >
      <h2 id="share-title" className="text-xl font-semibold">
        Share your result
      </h2>
      {/* eslint-disable-next-line @next/next/no-img-element -- the card is our own image route */}
      <img
        src={cardImagePath(card)}
        alt={cardHeadline(card)}
        width={1200}
        height={630}
        className="aspect-[1200/630] h-auto w-full rounded-xl border border-zinc-200 bg-zinc-950 dark:border-zinc-800"
      />
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Friends see only this card and an invite to the beta. No accounts, merchants, balances or
        names.
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={send}
          disabled={!link || failed}
          className={PRIMARY}
          data-share-link={link ?? undefined}
        >
          {phone ? "Share" : "Copy link"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={SECONDARY}>
          Cancel
        </button>
      </div>
      {note && (
        <p role="status" className="text-sm [overflow-wrap:anywhere]">
          {note}
        </p>
      )}
    </section>
  );
}
