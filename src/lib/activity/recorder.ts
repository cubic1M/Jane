import { ACTIVITY, type ActivityKind } from "@/config/activity";
import { cleanName, isPrivateField, normalizePath, redactText } from "./redact";

// The browser half of the beta's activity log: one set of listeners on the document records
// page views, clicks, form submits, field focus and blur, rage clicks, errors and time on page,
// and posts them in batches to /api/activity. Never a typed value: a field gives its name,
// whether something was typed and how long it is (not even that if it's private).
//
// Until the server says this person is recorded, only page views leave the browser; if it says
// they aren't (signed out, an admin, a trial or demo-bank person), nothing else ever does.

type Recorded = {
  kind: ActivityKind;
  path: string;
  at: number;
  role?: string;
  label?: string;
  data?: Record<string, unknown>;
};

const CLICKABLE =
  "a,button,summary,select,label,input[type=checkbox],input[type=radio],input[type=submit]," +
  "input[type=button],[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox]," +
  "[role=radio],[role=switch],[role=option],[data-track]";
const FIELD = "input,textarea,select,[contenteditable=true]";
const SKIPPED_INPUTS = new Set(["hidden", "submit", "button", "reset", "image"]);
const TAG_ROLES: Record<string, string> = {
  A: "link",
  BUTTON: "button",
  SUMMARY: "disclosure",
  SELECT: "select",
  LABEL: "label",
  TEXTAREA: "textbox",
};

const isPrivate = (el: Element) => !!el.closest("[data-private]");

function roleOf(el: Element): string {
  if (el.getAttribute("role")) return el.getAttribute("role")!;
  if (el instanceof HTMLInputElement) return el.type === "text" ? "textbox" : el.type;
  return TAG_ROLES[el.tagName] ?? "element";
}

// A click's label: the data-track name, else the visible text (redacted), never inside a
// data-private element.
function labelOf(el: Element): string {
  const tracked = el.closest("[data-track]")?.getAttribute("data-track");
  if (tracked) return cleanName(tracked);
  if (isPrivate(el)) return "private";
  const input = el as HTMLInputElement;
  const text =
    el.getAttribute("aria-label") ||
    (input.labels?.[0] && visibleText(input.labels[0])) ||
    visibleText(el) ||
    el.getAttribute("title") ||
    "";
  return redactText(text);
}

// The element's text without any data-private part inside it (an account name in a button).
function visibleText(el: Element): string {
  if (!el.querySelector("[data-private]")) return (el as HTMLElement).innerText ?? "";
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll("[data-private]").forEach((n) => n.remove());
  return copy.textContent ?? "";
}

function fieldName(el: Element): string {
  const input = el as HTMLInputElement;
  return cleanName(
    el.getAttribute("data-track") ||
      input.name ||
      el.id ||
      el.getAttribute("aria-label") ||
      input.labels?.[0]?.innerText ||
      roleOf(el),
  );
}

function fieldIsPrivate(el: Element): boolean {
  return isPrivateField({
    type: el.getAttribute("type"),
    inputMode: el.getAttribute("inputmode"),
    autocomplete: el.getAttribute("autocomplete"),
    name: el.getAttribute("name") || el.id,
    markedPrivate: isPrivate(el),
  });
}

function filled(el: Element): boolean {
  if (el instanceof HTMLInputElement) {
    if (SKIPPED_INPUTS.has(el.type)) return false;
    return el.type === "checkbox" || el.type === "radio" ? el.checked : el.value !== "";
  }
  return "value" in el && (el as HTMLTextAreaElement).value !== "";
}

function newVisitId(): string {
  return (crypto.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^a-z0-9]/gi, "");
}

function visitId(): string {
  try {
    const id = sessionStorage.getItem("jane_visit") || newVisitId();
    sessionStorage.setItem("jane_visit", id);
    return id;
  } catch {
    return newVisitId();
  }
}

export function startRecorder(): { page(pathname: string): void; stop(): void } {
  const visit = visitId();
  const queue: Recorded[] = [];
  let mode: "unknown" | "full" | "views" = "unknown";
  let asking = false;
  let path = "";
  let pageStart = Date.now();
  let errors = 0;
  let hidden = false;
  let clicks: { x: number; y: number; at: number }[] = [];
  const typed = new WeakMap<Element, boolean>();
  const formStart = new WeakMap<Element, number>();

  const push = (kind: ActivityKind, extra: Partial<Recorded> = {}) => {
    if (mode === "views" && kind !== "page_view") return;
    queue.push({ kind, path, at: Date.now(), ...extra });
    if (queue.length >= ACTIVITY.maxBatch && mode === "full") flush();
  };

  const send = (events: Recorded[], leaving: boolean) => {
    const body = JSON.stringify({ visitId: visit, events });
    if (
      leaving &&
      navigator.sendBeacon?.("/api/activity", new Blob([body], { type: "application/json" }))
    ) {
      return;
    }
    asking = mode === "unknown";
    fetch("/api/activity", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((answer: { recording?: boolean } | null) => {
        if (!answer) return;
        mode = answer.recording ? "full" : "views";
        if (mode === "views")
          queue.splice(0, queue.length, ...queue.filter((e) => e.kind === "page_view"));
      })
      .catch(() => {})
      .finally(() => (asking = false));
  };

  // Page views go at once; the rest waits until the server says this person is recorded.
  const flush = (leaving = false) => {
    if (mode === "full") {
      if (queue.length) send(queue.splice(0, ACTIVITY.maxBatch), leaving);
      return;
    }
    // Not known yet: one request at a time, and only one that can read the answer.
    if (mode === "unknown" && (asking || leaving)) return;
    const views = queue.filter((e) => e.kind === "page_view");
    if (mode === "views" && views.length === 0) return;
    queue.splice(0, queue.length, ...queue.filter((e) => e.kind !== "page_view"));
    send(views, leaving);
  };

  const endStretch = () => {
    if (path) push("page_time", { data: { ms: Date.now() - pageStart } });
  };

  const onClick = (e: MouseEvent) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;
    const el = target.closest(CLICKABLE);
    if (el) push("click", { role: roleOf(el), label: labelOf(el) });
    const now = Date.now();
    clicks = clicks.filter(
      (c) =>
        now - c.at < ACTIVITY.rageWindowMs &&
        Math.hypot(c.x - e.clientX, c.y - e.clientY) < ACTIVITY.rageRadiusPx,
    );
    clicks.push({ x: e.clientX, y: e.clientY, at: now });
    if (clicks.length === ACTIVITY.rageClicks) {
      const what = el ?? target;
      push("rage_click", {
        role: roleOf(what),
        label: labelOf(what),
        data: { count: clicks.length },
      });
    }
  };

  const onFocus = (e: FocusEvent) => {
    const el = e.target instanceof Element ? e.target.closest(FIELD) : null;
    if (!el) return;
    typed.set(el, false);
    const form = el.closest("form");
    if (form && !formStart.has(form)) formStart.set(form, Date.now());
    push("focus", { role: roleOf(el), label: fieldName(el) });
  };

  const onInput = (e: Event) => {
    const el = e.target instanceof Element ? e.target.closest(FIELD) : null;
    if (el) typed.set(el, true);
  };

  const onBlur = (e: FocusEvent) => {
    const el = e.target instanceof Element ? e.target.closest(FIELD) : null;
    if (!el || !typed.has(el)) return;
    const priv = fieldIsPrivate(el);
    const value = "value" in el ? String((el as HTMLInputElement).value) : (el.textContent ?? "");
    push("blur", {
      role: roleOf(el),
      label: fieldName(el),
      data: { typed: typed.get(el), private: priv, ...(priv ? {} : { length: value.length }) },
    });
    typed.delete(el);
  };

  const onSubmit = (e: SubmitEvent) => {
    const form = e.target as HTMLFormElement;
    const name =
      form.getAttribute("data-track") ||
      form.getAttribute("name") ||
      form.id ||
      form.getAttribute("aria-label") ||
      "form";
    const fields = Array.from(form.elements)
      .filter((el) => el.matches(FIELD) && filled(el))
      .map(fieldName);
    push("submit", {
      label: cleanName(name),
      data: { fields, ms: Date.now() - (formStart.get(form) ?? pageStart) },
    });
    flush();
  };

  const onError = (message: string) => {
    if (++errors > ACTIVITY.maxErrorsPerPage) return;
    push("error", { label: redactText(message, ACTIVITY.maxError) });
  };
  // Only script errors: a picture that fails to load fires a plain Event here too.
  const onWindowError = (e: Event) => {
    if (e instanceof ErrorEvent) onError(e.message || "Error");
  };
  const onRejection = (e: PromiseRejectionEvent) =>
    onError(e.reason instanceof Error ? e.reason.message : String(e.reason));

  const onHide = () => {
    if (hidden) return;
    hidden = true;
    endStretch();
    flush(true);
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") return onHide();
    hidden = false;
    pageStart = Date.now();
  };

  const listeners: [EventTarget, string, EventListener][] = [
    [document, "click", onClick as EventListener],
    [document, "focusin", onFocus as EventListener],
    [document, "focusout", onBlur as EventListener],
    [document, "input", onInput],
    [document, "change", onInput],
    [document, "submit", onSubmit as EventListener],
    [document, "visibilitychange", onVisibility],
    [window, "pagehide", onHide],
    [window, "error", onWindowError],
    [window, "unhandledrejection", onRejection as EventListener],
  ];
  for (const [target, type, fn] of listeners) target.addEventListener(type, fn, true);
  const timer = setInterval(() => flush(), ACTIVITY.flushEveryMs);

  return {
    page(pathname) {
      const next = normalizePath(pathname);
      if (next === path) return;
      endStretch();
      path = next;
      pageStart = Date.now();
      errors = 0;
      push("page_view");
      if (mode !== "full") flush();
    },
    stop() {
      for (const [target, type, fn] of listeners) target.removeEventListener(type, fn, true);
      clearInterval(timer);
    },
  };
}
