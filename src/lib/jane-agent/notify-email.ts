// Jane's email of what's waiting in the chat (spec step 85): one email for a batch of
// messages, each with its buttons as one-tap links and a link to it in the chat. Plain
// text first; the HTML keeps Jane's ASCII look (monospace, "jane>", [ buttons ]) where
// mail apps allow, with inline styles only.

export type EmailMessage = {
  kind: string;
  body: string;
  // One-tap links, each opening a confirm page.
  buttons: { label: string; url: string }[];
  // The message in the chat.
  chatUrl: string;
};

export type ChatEmailLinks = { chat: string; settings: string; unsubscribe: string };

const TAGS: Record<string, string> = {
  brief: "brief",
  decision: "to decide",
  done: "done",
  heads_up: "heads-up",
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function chatEmailSubject(count: number): string {
  return count === 1 ? "Jane: 1 thing for you" : `Jane: ${count} things for you`;
}

const RULE = "----------------------------------------";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Courier New',monospace";

export function renderChatEmail(messages: EmailMessage[], links: ChatEmailLinks) {
  const subject = chatEmailSubject(messages.length);

  const text = [
    "jane> Here's what's waiting for you.",
    "",
    ...messages.flatMap((m) => [
      RULE,
      `jane> ${TAGS[m.kind] ?? "jane"}`,
      m.body,
      "",
      ...m.buttons.map((b) => `[ ${b.label} ] ${b.url}`),
      `Open in the chat: ${m.chatUrl}`,
      "",
    ]),
    RULE,
    "Each button opens a page where you confirm it. Each works once.",
    `Your chat: ${links.chat}`,
    "",
    `Choose what Jane sends you: ${links.settings}`,
    `Stop these emails: ${links.unsubscribe}`,
  ].join("\n");

  const button = (b: { label: string; url: string }) =>
    `<a href="${escapeHtml(b.url)}" style="display:inline-block;margin:0 8px 8px 0;padding:8px 12px;border:1px solid #171717;color:#171717;text-decoration:none;font-weight:bold">[ ${escapeHtml(b.label)} ]</a>`;
  const block = (
    m: EmailMessage,
  ) => `<div style="border:1px solid #d4d4d4;padding:12px;margin:0 0 16px">
<p style="margin:0 0 8px;font-size:12px;color:#737373"><span style="color:#171717;font-weight:bold">jane&gt;</span> ${escapeHtml(TAGS[m.kind] ?? "jane")}</p>
<p style="margin:0 0 12px;white-space:pre-line">${escapeHtml(m.body)}</p>
<p style="margin:0">${m.buttons.map(button).join("")}<a href="${escapeHtml(m.chatUrl)}" style="display:inline-block;padding:8px 4px;color:#171717">Open in the chat &gt;</a></p>
</div>`;

  const html = `<div style="font-family:${MONO};max-width:560px;margin:0 auto;color:#171717;line-height:1.5;font-size:14px">
<p style="margin:0 0 16px"><span style="color:#171717;font-weight:bold">jane&gt;</span> Here's what's waiting for you.</p>
${messages.map(block).join("\n")}
<p style="font-size:12px;color:#737373">Each button opens a page where you confirm it. Each works once. <a href="${escapeHtml(links.chat)}" style="color:#171717">Your chat</a></p>
<p style="margin-top:24px;font-size:12px;color:#737373"><a href="${escapeHtml(links.settings)}" style="color:#737373">Choose what Jane sends you</a> · <a href="${escapeHtml(links.unsubscribe)}" style="color:#737373">Stop these emails</a></p>
</div>`;

  return { subject, text, html };
}
