"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { Route } from "next";
import type { CalcLine } from "@/lib/hub/view";
import { formatCents } from "@/lib/money";
import { placePopup, popupLine, type Box } from "./place-popup";
import { MarchingPath } from "@/components/marching-path";

// A tile's worked-out sum, in a pop-up beside the tile instead of another page (founder: "How
// it's worked out should also not teleport you to another page, but show a pop up page (linked
// by dashed animated line) right next to it showing the calculations"). It goes on the first
// side with room, never over the tile, the net worth chart or the chat (./place-popup.ts), and
// closes on Esc or a click outside. It arrives with the hub's motion (.nw-box-in, a marching
// <MarchingPath>; neither with reduced motion), and has the full page as a link inside.

const dollars = (cents: number) =>
  cents < 0
    ? `−${formatCents(-cents).replace(/\.\d\d$/, "")}`
    : formatCents(cents).replace(/\.\d\d$/, "");

const rectOf = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};

// What a pop-up must leave in view: the net worth chart (and its controls) and the chat, docked
// or as the phone's sheet (when it's up).
const AVOID = '[data-net-worth-chart], [data-side-chat], [data-sheet]:not([data-sheet="closed"])';

export function CalcLines({ lines, label }: { lines: CalcLine[]; label: string }) {
  return (
    <dl aria-label={label} data-calc-lines="" className="flex flex-col gap-1 text-sm tabular-nums">
      {lines.map((l, k) => (
        <div
          key={k}
          className={`flex justify-between gap-3 ${l.sign === "=" ? "border-t border-current pt-1 font-semibold" : ""}`}
        >
          <dt className="min-w-0 [overflow-wrap:anywhere]">
            <span aria-hidden="true" className="inline-block w-3">
              {l.sign}
            </span>
            {l.sign === "−" && <span className="sr-only">minus </span>}
            {l.sign === "+" && <span className="sr-only">plus </span>}
            {l.sign === "=" && <span className="sr-only">equals </span>}
            {l.label}
            {l.note && <span className="text-zinc-500"> · {l.note}</span>}
          </dt>
          <dd className="shrink-0">{dollars(l.cents)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CalcPopup({
  id,
  title,
  anchor,
  trigger,
  onClose,
  full,
  children,
}: {
  id: string;
  title: string;
  // The tile it belongs to, and the button that opened it (the line starts there).
  anchor: RefObject<HTMLElement | null>;
  trigger: RefObject<HTMLElement | null>;
  onClose: () => void;
  // The full page, for anyone who wants more.
  full: { href: Route; label: string };
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const path = useRef<SVGPathElement>(null);

  // Placed before it's painted, and again when the tile, the pop-up or the window changes size;
  // positions are the page's, so it scrolls with the tile.
  useLayoutEffect(() => {
    const place = () => {
      const el = box.current;
      const tile = anchor.current;
      const button = trigger.current;
      if (!el || !tile || !button) return null;
      const avoid = [...document.querySelectorAll(AVOID)]
        .filter((n) => !tile.contains(n) && !n.contains(tile))
        .map(rectOf);
      const viewport = { width: document.documentElement.clientWidth, height: window.innerHeight };
      const size = { width: el.offsetWidth, height: el.offsetHeight };
      const from = rectOf(button);
      const at = placePopup({
        anchor: rectOf(tile),
        near: from.top + from.height / 2,
        size,
        viewport,
        avoid,
      });
      const sx = window.scrollX;
      const sy = window.scrollY;
      el.style.left = `${at.left + sx}px`;
      el.style.top = `${at.top + sy}px`;
      el.dataset.side = at.side;
      el.style.visibility = "visible";
      const d = popupLine(
        { ...from, left: from.left + sx, top: from.top + sy },
        { left: at.left + sx, top: at.top + sy, ...size },
        at.side,
      );
      path.current?.setAttribute("d", d);
      if (svg.current) {
        svg.current.style.width = `${document.documentElement.scrollWidth}px`;
        svg.current.style.height = `${document.documentElement.scrollHeight}px`;
      }
      return at.side;
    };
    // In view once placed: the page scrolls to it if it runs past the screen.
    if (place()) box.current?.scrollIntoView({ block: "nearest" });
    // The tile still opening, or the window changing size, moves it along.
    const sized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => place());
    if (anchor.current) sized?.observe(anchor.current);
    if (box.current) sized?.observe(box.current);
    window.addEventListener("resize", place);
    return () => {
      sized?.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [anchor, trigger]);

  // Esc or a click anywhere else closes it; Esc gives the focus back to the button.
  useEffect(() => {
    box.current?.focus({ preventScroll: true });
    const button = trigger.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      onClose();
      button?.focus();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (box.current?.contains(t) || button?.contains(t)) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [onClose, trigger]);

  return createPortal(
    <>
      <svg
        ref={svg}
        aria-hidden="true"
        data-popup-line=""
        className="pointer-events-none absolute top-0 left-0 z-[35] overflow-visible text-zinc-900 dark:text-zinc-100"
      >
        <MarchingPath ref={path} />
      </svg>
      <div
        ref={box}
        id={id}
        role="dialog"
        aria-label={title}
        tabIndex={-1}
        data-calc-popup=""
        style={{ visibility: "hidden" }}
        className="nw-box-in absolute top-0 left-0 z-[35] flex w-80 max-w-[calc(100vw-16px)] flex-col gap-3 border border-zinc-900 bg-white p-4 shadow-lg outline-none dark:border-zinc-100 dark:bg-zinc-950"
      >
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-semibold">{title}</p>
          <button
            type="button"
            onClick={() => {
              onClose();
              trigger.current?.focus();
            }}
            className="text-xs font-semibold tracking-wider hover:underline"
          >
            [CLOSE]
          </button>
        </div>
        {children}
        <Link
          prefetch={false}
          href={full.href}
          className="self-start text-sm font-medium underline-offset-2 hover:underline"
        >
          {full.label} ›
        </Link>
      </div>
    </>,
    document.body,
  );
}
