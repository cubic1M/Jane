import { formatCents } from "@/lib/money";
import Anthropic from "@anthropic-ai/sdk";
import {
  CHAT_CLAUDE_COOLDOWN_SECONDS,
  CHAT_CLAUDE_DEADLINE_MS,
  CHAT_CLAUDE_FIRST_WORDS_MS,
  CHAT_CLAUDE_RETRY_MS,
  CHAT_CLAUDE_HISTORY,
  CHAT_CLAUDE_TOTAL_MS,
  CHAT_CLAUDE_MAX_TOKENS,
  CHAT_PRIMER_BUDGET_MS,
  CHAT_CLAUDE_EFFORT,
  CHAT_CLAUDE_MAX_TURNS,
  CHAT_CLAUDE_REWRITES,
} from "@/config/agent-chat";
import { ASK_BLOCKED_REPLY } from "@/config/ask";
import type { PrismaClient } from "@/generated/prisma/client";
import { anthropic, chatModel } from "@/lib/anthropic";
import { addSpend, costInHundredthsOfCents, overDailyCap } from "./spend";
import type { Topic } from "./context";
import {
  checkGuardrails,
  guardrailMatches,
  dollarFigures,
  isAdvice,
  unsupportedFigures,
  type GuardrailIssue,
} from "@/lib/guardrails";
import type { PolicyKind } from "@/config/insurance";
import { quotesAnswer } from "./insurance/quotes";
import { DEBT_TOOL_STATUS } from "./debt-tools";
import { parseDecision } from "./decision-intents";
import { lookupsFor, sectorsFor, toolsFor } from "./tool-select";
import { CHAT_TOOLS, chatPrimer, proposeAction, runChatTool, type Proposal } from "./claude-tools";
import { CHANGE_PRACTICE_TOOL, proposePracticeChange } from "./practice-tools";
import { BLOCK_KINDS, buildBlock, type BlockKind } from "./block-data";
import { blockCents, drawBlock, type AnswerBlock } from "./blocks";
import { GuardedText } from "./guarded-text";
import { INVESTMENT_TOOL_STATUS } from "./investments/tools";
import type { Reply } from "./replies";
import { OPTION_ACTIONS } from "./actions/options";
import type { OfferedOptions } from "@/lib/option-card";

// Free questions in Jane's chat, with an Anthropic key (spec step 84): Claude, the
// person's recent typed messages and Jane's answers to them, and read-only tools over their
// own data, like Ask (src/lib/ask/answer.ts). Claude's text is only shown once it passes the
// guardrails, which allow only dollar figures from a tool, the question or an earlier
// answer. Claude can offer one button from the action registry (propose_action), never
// press it: the person taps.
//
// Quick by design: a faster model than the rest of the app (chatModel), little thinking,
// the person's main numbers sent with the question so most answers need no lookup, and
// the answer streamed as it's written (onEvent), a sentence at a time once each passes the
// guardrails (./guarded-text), with what Jane is looking up in between.

export const CHAT_PROMPT_VERSION = "chat-v30";

// The one rule that differs in demo advice mode (spec step 98).
const NO_ADVICE = `- Never give investment, tax or legal advice, and don't mention investments, taxes or legal matters at all. Don't suggest financial products beyond Jane's pick from finding_details.`;
const DEMO_ADVICE = `- This person is using the demo bank with sample data, so you may recommend what to do about investments, taxes, insurance and loans: say what you'd do and why, from their numbers. Never promise a result or a return, and never give legal advice. The app labels your answer as demo advice; don't add a label or disclaimer yourself.`;

const SYSTEM = `You are Jane, the money helper inside a personal finance app, answering in the app's chat. You know the person's own money: spending, bills, subscriptions, safe to spend, goals, budgets, and what the app has found or is doing for them.

Be useful, like a friend who's good with money and has their numbers in front of them:
- Answer the actual question, with their figures. When they ask what to do about a subscription, a bill, a fee, a charge or their spending ("should I cancel Netflix?"), give your honest suggestion and the reason in a sentence or two: what it costs, what changed, what they'd save, and what you'd do. For example: "Netflix went up from $A to $B a month, which is $C a year. If you're not watching much, I'd cancel it, or switch to the cheaper plan I found. Tap Yes and I'll take care of it." (with their real amounts in place of $A, $B and $C)
- "Should I buy / invest in / pay off ...?" (bitcoin, stocks, a house, a car, "pay off my card or invest") is a decision about their money, not a lookup of the thing: call decision first and answer from their debts and rates, their cash cushion and their goals, the order being high-rate debt, then the cushion, then the goal, then the thing. Crypto, investments or afford tools come only as a follow-up. A bare "should I buy?" is about the last thing you discussed: never answer it by describing a button or page from an earlier message. Never predict what the thing will do.
- Before suggesting what to do about something the app found, look at finding_details for it. Use subscriptions for what they pay on a schedule.
- For "am I OK?", "how am I doing" or "what should I do this month", use whole_picture: start with its headline, then the one to three things that matter most, with the first one's button.
- What they've told you is under "remembered" in their numbers. Respect it: never suggest anything they said not to suggest, or cutting something they said they need.
- Follow the conversation (spec step 193): "it", "that one", "the other one", "do it" and "and for my wife's car?" mean what was just said or what the last answer was about (given with their numbers). Don't ask again what they already told you.
- When they ask two things in one message, answer both, in order, each with its figure; the first sentence still gives the first answer. When you really can't tell what they mean, ask one short question that names the likely choices ("Do you mean your Netflix or your Hulu?"). Never a generic list of things you can do when one of your tools fits.
- Every message gets a written answer from you, whatever it is: a command ("cancel Netflix", "approve the plan", "undo", "help"), a short reply ("yes", "ok and?", "what do you mean", "why"), a greeting or a thing you can't do. Say in words what it is or what tapping a button would do, with their figures, and only then offer the button. A button or a card is never the whole reply.
- Say what the data says plainly: if a tool gives a name, a figure or a date, state it, never "probably" or "it looks like". Say you don't know only when no tool has it.
- If they push back ("you tell me"), give a straight answer from their numbers. Don't repeat yourself or hand it back to them.
- Every answer must stand on its own, in words first: what the answer is, with their figures, and why. A button is extra. Never begin with, or talk about, a button or what you "put" under the answer (the app adds that line itself), and never answer with only a button or "tap the button".
- Their numbers include what_matters_most (the top three things, with why and what each is worth, and how sure Jane is of a suggestion) and open_findings_summary. Answer "what should I do first", "why", "tell me more" and "what am I doing wrong" straight from those, with no tool call: the first item is the answer, its why is the reason.
- Call every tool you need in one step (several at once), not one after another, and use the fewest you can: you have only a few rounds, and the last one must be the answer.
- Never mention earlier messages that failed or went unanswered, or say what you "said you'd do" earlier. Answer only what they asked now.
- "Why?", "tell me more" and "explain" mean: give the reason for the last answer in one or two new sentences with their figures. Never repeat the last answer, and never reply with just a button.
- "Explain it like I'm 5" means plain words for a child: short sentences, no jargon, their real numbers.

Shape every answer the same way (spec step 89):
- The first sentence is the answer itself, with their figure: "Netflix is $17.99 a month." or "Yes: you'd still have $2,276.12 safe to spend until Oct 28 (in 10 days)." Never open with a lead-in ("Here's what I found:", "Sure!", "Great question") or restate the question.
- Then the reason, in a sentence or two, with their figures.
- Then, only when they asked what to do or one clear next step follows from the answer, that step (with its button, propose_action, only if they asked for something to be done). A short list only when they ask to compare, for bills or subscriptions, or for a list.
- Money as "$17.99 a month" or "$215.88 a year", never "/mo" or "per month". Dates as "Oct 28 (in 3 days)".
- Warm and brief: no filler, no apologies, no sign-off.

How to answer:
- Their main numbers right now come after these instructions. Answer from them when you can; use the tools for anything else. Never guess. If neither has it, say so plainly.
- When you want a number that no tool gives directly (a percent of a balance, a year of a monthly amount, the difference between two amounts, how long a payment takes to clear a balance), use the calculate tool with the amounts exactly as given: any sum, difference, total or percent, even of two amounts you can see. Never work out an amount yourself.
- Use only dollar amounts that appear in those numbers or in tool results, written exactly as they appear there (with the cents). Don't add, subtract, round or estimate amounts yourself.
- Keep it short: 3 sentences, about 400 characters, and never more than 550. Say the answer first and stop when it is said. A list only when they ask for one or for bills and subscriptions. Plain words, no jargon, no headings. Don't write anything before a lookup; just look it up.
- Answer the question that was asked. what_matters_most and the open findings are background, not an agenda: mention one only when it directly answers the question or is the one clear next step, never to change the subject ("my car broke down" is not a reason to bring up a subscription, "do I need Medigap" is not a reason to bring up a quote), and never open with "Tapping Yes".
- When someone is going through something hard (a divorce, a death, a job loss, a car that broke down): open with one kind, plain sentence; then their two or three key facts (cash, the next thing due); then one concrete first step; then offer to go through more. No platitudes, no pitch for a product or a finding. After a death, don't explain the legal process (probate, wills, who inherits): say an estate attorney and the banks' bereavement teams handle that, and keep to what you can see in the numbers (which accounts are linked, what is due soon).
- When they ask something Jane can't do or shouldn't (write a will or other legal papers, get around a login, move money): say so in the first sentence, plainly, point to who can (a lawyer, the bank), then what Jane can do with their figures.
- "Do I need…", "should I…" and "is it worth…" questions start with a plain yes, no or "it depends on" one named thing, then why, with their figures. A rule of thumb ("safe withdrawal rate") is stated together with the person's own balance from their numbers (the rule as a percent, their balance as given); never work out a new dollar amount yourself.
- "Change / switch / lower my car insurance" (or home, renters, life, pet) is a request Jane can act on: say what she found (the cheaper quote and how much less, from the tool), then propose_action insurance.reshop for that policy. Never tell the person to ask again in other words.
- If two figures for the same thing disagree (an estimate in your numbers and a tool's result), use the tool's and say nothing about the other: never "my earlier guess", "the tool shows" or "the brief said".
- Speak as Jane, about their money: never say "the app", "findings", "open findings", "the tool", "tools", "my earlier guess", "tool results", "propose_action" or "what_matters_most", and never name internal ids. Say "I found", "I can see", "in your accounts" instead.
- When a button's card goes under your answer (you called propose_action), your text is one or two sentences that don't repeat the card's figures: the card carries the details.
- If you were not given propose_action for this message, say nothing about buttons, an earlier button or an offer; just answer the question. "What are the other options from <insurer>" is a question: answer with that insurer's savings and quote options and their figures.
- If the money health result has no score (only words), say it in those words ("your money health is under strain right now") and the one thing that would raise it; never quote a number or the word "Building" for it.
- A money health score that is low is room to grow, said kindly ("Building" is on the way, never a verdict); say what would raise it first.
- Their numbers include about_them: the facts of this person's life (rents or owns, family, how they are paid, company stock, a 401(k) and the rest). Speak to THAT life. A renter has no mortgage, PMI or home insurance to talk about; someone with company stock has concentration, vesting and withholding to think about; a first job means the match and credit history matter most; someone paid unevenly needs a buffer and set-aside taxes. Never give advice that belongs to a different life (an employer match to a freelancer, required withdrawals to a young renter). When a fact is unknown, say the usual case in one sentence and what you'd need to know.
- about_them already says who they are: don't look their profile up again. When a lookup result already holds the finished figure or statement for what they asked (a withholding gap, a payoff time), say it as it is; don't call calculate or another tool to rework it.
- A long or rambling message: find the real worry and answer it first, in one sentence with their figure; then answer what else they asked, in the order they asked it, in two short paragraphs at most; end with the one thing to do first. Don't answer every detail, and don't ask them to rephrase.
- In a run of questions each answer builds on the last: it adds the next number or step. "And for X?" asks the same thing about X. "Do it" or "yes" acts on what you last offered. Never say you "covered it above" and never repeat the last figures unless the new answer needs them.
- Someone going through something hard ("I lost my job", "we're fighting about money", "I'm drowning"): one kind sentence that names it (no cheering, no "I'm sorry to hear"), then their own facts that matter right now (cash, the next thing due and when, what is owed), then one concrete first step, then an offer to go through the rest. Never a list of buttons, a pitch, or advice you can't back with their numbers.
- Affordability ("can we afford a car / childcare / a house"): give a comfortable amount and monthly budget to aim for, then the ceiling only as the ceiling; never present the most the maths allows as the target.
- A rule of thumb ("the 4% rule, often called a safe withdrawal rate") is something you name and explain; say it isn't a guarantee instead of promising an outcome, and don't use "definitely", "guaranteed" or "will" about the future.
- When you list options (savings, plans, offers), give the three that save the most, largest first, then say how many more there are; never all of them.
- Before you write ANY amount that is not literally in their numbers, the list of amounts you may state, or a tool result (a total, a difference, a share, a month of a yearly amount), call calculate first. Do not write it from your head.
- Follow-ups add the new thing asked. Never say you "covered it above" or point back to an earlier answer, and don't repeat figures you already gave unless the new answer needs them.
- You can't do anything yourself. A button is only for when the person asked Jane to DO something ("cancel Netflix", "yes, do it"), or when one clear next step follows from your answer. Then call propose_action once, and say what tapping it does. Never say it's done. For a question that only asks for information ("do I have any debts", "what are my options", "explain my budget"), answer in words and offer no button at all.
- Jane can only act on: something she found for them (an id in open_findings), approving the safe plan items, starting a goal, the rebalance she offers, or shopping a policy for a cheaper price (propose_action insurance.reshop with the policy kind (auto, home, renters, life or pet): she gets the quotes and offers the switch with her pick). Before you say she can change, switch or cancel something, check it is one of those. If it isn't (move money, file something with a company), say so plainly in one sentence first ("I can't switch your insurer myself."), then what she can do, with their figures, and offer no button.
- When they ask you to change, cancel or start something Jane CAN act on, treat it as a request to act: say plainly what you can do and what it takes (the best option with its real figures, then that the team makes the change once they say yes), then offer the button. A list of their current details is not the answer.
- "How can I pay less / save more / lower ..." gets two or three concrete moves with their own numbers (which to do first and what it saves, or when it's paid off), written out. Offer a button only for the one move that can be done for them. Never answer by pointing at a page.
- Write your answer first, then call propose_action or show_block at the very end of that same turn if a button or a picture helps: the answer you wrote is the answer.
- Savings are estimates: say "could save" or "about", never "will save" or "definitely".
${NO_ADVICE}
- To "hi" or "thanks", answer in a sentence and mention one useful thing from their numbers.
- If a question isn't about their money in this app, say briefly what you can help with.`;
const SYSTEM_DEMO_ADVICE = SYSTEM.replace(NO_ADVICE, DEMO_ADVICE);

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type ClaudeAnswer =
  | { kind: "answer"; reply: Reply }
  | { kind: "blocked"; reply: Reply; issues: GuardrailIssue[] }
  | { kind: "unavailable"; reply: Reply };

// What the person sees while Jane answers: what she's doing, the answer so far, or
// "reset" when text so far turned out to lead into a lookup.
export type ChatStreamEvent =
  { type: "status"; text: string } | { type: "text"; text: string } | { type: "reset" };

type Options = {
  client: PrismaClient;
  now: Date;
  claude?: () => Pick<Anthropic, "messages">;
  maxTurns?: number;
  onEvent?: (event: ChatStreamEvent) => void;
  // Demo advice mode (src/lib/advice-mode.ts, spec step 98): the demo guardrail profile,
  // and advice labelled. Off unless the caller checked adviceMode.
  advice?: boolean;
  // Spec step 193: what the last answer was about, so "it" and "the other one" mean something.
  topic?: Topic | null;
  // Spec step 188: how the person likes answers (src/lib/jane-agent/style.ts).
  style?: string | null;
  // Spec step 93: how long to wait for Claude to start, and to finish, in milliseconds.
  firstWordsMs?: number;
  deadlineMs?: number;
  // How long to wait for the person's main numbers before starting without them.
  primerMs?: number;
};

// Spec step 93: when Claude last failed, free questions get the rules' answer at once until
// this time (ms), instead of waiting on Claude again. Per server instance.
let claudeDownUntil = 0;
export function resetClaudeHealth(): void {
  claudeDownUntil = 0;
}

const STATUS: Record<string, string> = {
  // Loans and debt (spec Phase Y, ./debt-tools.ts).
  ...DEBT_TOOL_STATUS,
  search_transactions: "Searching your transactions…",
  spending_by_category: "Adding up your spending…",
  monthly_totals: "Looking at your months…",
  upcoming_bills: "Looking at upcoming bills…",
  list_actions: "Checking your actions…",
  safe_to_spend: "Checking safe to spend…",
  coming_up: "Looking at what's coming up…",
  open_findings: "Checking what I've found…",
  goals: "Looking at your goals…",
  budgets: "Checking your budgets…",
  net_worth: "Adding up your net worth…",
  finding_details: "Looking into it…",
  subscriptions: "Checking your subscriptions…",
  recent_changes: "Looking at what changed…",
  life_events: "Looking at your checklists…",
  plan_upkeep: "Looking at your week…",
  proven_savings: "Adding up what I saved you…",
  autopilot_settings: "Checking what I may do by myself…",
  nightly_log: "Looking at last night's checks…",
  priorities: "Working out what matters most…",
  whole_picture: "Looking across everything…",
  balance_forecast: "Looking at where your balance is heading…",
  alerts: "Checking your alerts…",
  household: "Checking who you share with…",
  money_moves: "Checking what money moved…",
  explain_figure: "Working out how I got that…",
  books_check: "Checking your numbers add up…",
  steady_pay: "Working out your steady paycheck…",
  price_rises: "Looking for prices about to go up…",
  money_for_two: "Looking at what you share…",
  goal_tradeoffs: "Weighing your goals against each other…",
  health_score: "Working out your money health score…",
  monthly_report: "Reading your monthly report…",
  what_if: "Running the what-if…",
  long_view: "Looking ahead…",
  my_profile: "Remembering what I know about you…",
  propose_action: "Getting a button ready…",
  show_block: "Drawing it…",
};
export const statusFor = (tool: string) =>
  STATUS[tool] ?? INVESTMENT_TOOL_STATUS[tool] ?? "Looking that up…";

// Shown when Claude can't answer (an error, a refusal, too many lookups).
// Spec step 89: no dead ends; the chat adds the closest things Jane can answer as buttons.
export const CHAT_UNAVAILABLE_TEXT =
  "I couldn't look into that just now. Tap one of these and I'll answer it right away.";

const unavailable = (): ClaudeAnswer => ({
  kind: "unavailable",
  reply: { body: CHAT_UNAVAILABLE_TEXT, actions: [], refs: {} },
});

// The API wants the first message from the person, and one turn per side.
function conversation(history: ChatTurn[], question: string): Anthropic.MessageParam[] {
  const turns: ChatTurn[] = [];
  for (const turn of [...history, { role: "user" as const, content: question }]) {
    const last = turns.at(-1);
    if (!last && turn.role === "assistant") continue;
    if (last && last.role === turn.role) last.content = `${last.content}\n\n${turn.content}`;
    else turns.push({ ...turn });
  }
  return turns.map((t) => ({ role: t.role, content: t.content }));
}

// What to fix, for one more try, in the words of the rules above.
function rewriteRequest(
  text: string,
  issues: GuardrailIssue[],
  allowedCents: readonly number[],
  advice: boolean,
): string {
  const reasons = issues.map((issue) => {
    switch (issue) {
      case "unsupported_dollar_figure":
        return `It has amounts that aren't in their numbers or the tool results: ${unsupportedFigures(text, allowedCents).join(", ")}. Use those amounts exactly as they appear there instead, or leave just that amount out. (A total or difference you worked out yourself can't be shown: say it without the amount, or leave it out.)`;
      case "investment_advice":
        return "It mentions investing or investments. Say you can't advise on that here and leave it out.";
      case "tax_or_legal_advice":
        return advice
          ? "It gives legal advice. Don't draft or advise on legal matters: say plainly you can't, and point to a lawyer in one sentence, then say what you can do with their numbers."
          : "It mentions taxes or legal matters. Leave that out.";
      case "guaranteed_outcome":
        return 'It promises a result. Say "could" or "about" instead of "will", "definitely" or "guaranteed".';
      default:
        return "It's missing required wording.";
    }
  });
  return `(From the app, not the person.) That answer can't be shown yet:\n- ${reasons.join("\n- ")}\nWrite the whole answer again for the person: fix only those parts and keep the rest, your suggestion and the other figures included. Don't mention this note.`;
}

// The chat shows plain text: Claude's markdown emphasis, headings and code marks are dropped
// ("**Card use:**" is "Card use:"), its bullets kept as dashes.
export function plainText(text: string): string {
  return (
    text
      .replace(/\*\*([\s\S]+?)\*\*/g, "$1")
      .replace(/__([\s\S]+?)__/g, "$1")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^\s*[*•]\s+/gm, "- ")
      .replace(/`([^`]+)`/g, "$1")
      // "The tool shows $2,448" is Jane saying what she can see.
      .replace(
        /\b(?:the|my) tools?\s+(?:shows?|says?|gives?|returned|reports?|found|has)\b/gi,
        "I can see",
      )
      .replace(/\baccording to (?:the|my) tools?\b/gi, "from your accounts")
  );
}

// What the answer says about its own button ("I've put a link under this answer"): the app
// adds the button's line itself, so Claude's sentences about it are dropped.
const BUTTON_TALK =
  /\b(?:(?:put|added|placed|attached|left)\s+(?:a |an |the |one )?(?:\w+\s+)?(?:button|link)s?\b|(?:button|link)s? (?:below|under (?:this|my|the) answer)|under this answer|with the button below|using the button|tap the (?:button|link) below|couldn(?:'|’)?t (?:set up|make|add|create|offer|put)[^.!?]{0,30}\b(?:button|link)s?\b|(?:the )?button for the (?:switch|change)\b|\b(?:put|set|lined|queued)\b[^.!?]{0,50}\bup for you\b|\bfor you to decide(?: on)?\b|\bdecide on (?:it|that|this|them)\b)/i;

// The amounts Claude may state without a lookup, as the guardrail will read them: said up front
// so it doesn't invent one and need a rewrite.
function figuresLine(cents: readonly number[]): string {
  const unique = [...new Set(cents.map((c) => Math.abs(c)))].slice(0, 60);
  if (unique.length === 0) return "";
  return `\n\nAmounts you may state, exactly as written (anything else comes from a tool result or the calculate tool): ${unique.map((c) => formatCents(c)).join(", ")}.`;
}

// (From the app, not the person.) What Claude is told when its answer was only about a button.
const BUTTON_REWRITE =
  "(From the app, not the person.) That wasn't an answer. Answer the person's question in words, using the results you already have: the options, amounts and rates in them. Don't mention buttons or links. Don't call any tool.";

// A question that asks Jane to do something, or whether to (a verb that acts): only then does
// a button belong under the answer. An informational question never gets one.
const ACTION_REQUEST =
  /\b(?:cancel|stop|switch|change|start|set ?up|approve|undo|remind|snooze|handle|apply|enrol\w*|sign me|open (?:a|an|my)|create|file|dispute|negotiate|lower|reduce|refinanc\w*|consolidate|rebalanc\w*|do it|go ahead|yes|please|never (?:use|watch|need|want)|(?:don(?:'|’)?t|do not|dont) (?:use|watch|need|want)|no longer|not using|get(?:ting)? rid|sick of|can you|could you|will you|let(?:'|’)?s|should i (?:cancel|switch|change|start|stop|keep|get|drop|close|pay)|want you to)\b/i;

// The answer is too long for a chat: over about 600 characters, or a list nobody asked for.
const LIST_ASKED =
  /\b(?:list|bills|subscriptions|each|every|all (?:my|of)|compare|options|steps|breakdown|itemi[sz]e|show me|what are)\b/i;
export function tooLong(answer: string, question: string, hasCard = false): boolean {
  // Under a card that already says the figures, the answer is a sentence or two.
  if (hasCard && answer.length > 320) return true;
  // A list the person asked for (options, bills) may run a little longer.
  if (answer.length > (LIST_ASKED.test(question) ? 700 : 600)) return true;
  const items = answer.split("\n").filter((l) => /^\s*(?:[-•*]|\d+[.)])\s+/.test(l)).length;
  return items >= 3 && !LIST_ASKED.test(question);
}
const SHAPE_REWRITE =
  "(From the app, not the person.) That answer is too long for a chat. Answer again in at most 3 short sentences, no list, keeping the key figures and the answer to what was asked. Don't call any tool.";

// Sentences telling the person to tap Yes, for an answer that has no button.
const TAP_YES =
  /^\s*(?:tap(?:ping)?|press(?:ing)?|click(?:ing)?|hit(?:ting)?)\s+(?:the\s+)?(?:yes|no)\b/i;
// "Change / switch / lower my car insurance": a request Jane shops for. Not a question about
// whether to ("should I switch…") or what it is.
const SHOP_REQUEST =
  /^(?!.*\b(?:should i|do i need|how much|why|what is|what(?:'|’)?s|is it worth)\b).*\b(?:change|switch|lower|reduce|cut|shop|cheaper|better (?:price|rate|deal)|save (?:money )?on)\b.*\b(?:insurance|policy|coverage)\b/i;
const SHOP_KINDS: [RegExp, PolicyKind][] = [
  [/\b(?:car|auto|vehicle)\b/i, "auto"],
  [/\b(?:home|house|homeowners?)\b/i, "home"],
  [/\brenters?\b/i, "renters"],
  [/\blife\b/i, "life"],
  [/\bpet\b/i, "pet"],
];
export function shopKindOf(question: string): PolicyKind | null | false {
  if (!SHOP_REQUEST.test(question)) return false;
  return SHOP_KINDS.find(([re]) => re.test(question))?.[1] ?? null;
}

export function withoutTapYes(text: string): string {
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !TAP_YES.test(sentence))
    .join(" ")
    .trim();
}

// The names of Jane's own machinery: nobody should read them in an answer.
const INTERNAL_NAMES =
  /\b(?:propose_action|open_findings?|what_matters_most|finding_details|show_block|tool results?|the findings the app has open|(?:my|an) earlier (?:guess|estimate) of|(?:the|my) (?:brief|primer|tools?) (?:said|says|showed|shows) (?:something|a different))\b/i;

export function withoutButtonTalk(text: string): string {
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !BUTTON_TALK.test(sentence) && !INTERNAL_NAMES.test(sentence))
    .join(" ")
    .trim();
}

// Where the time goes on a free question (one log line each, numbers only): the person's
// numbers, Claude's first stream event and first text, the rounds, and the tokens, so a slow
// deploy can be read from the logs. Times are milliseconds from the start of the call.
type ChatTiming = {
  startedAt: number;
  primerMs: number | null;
  firstEventMs: number | null;
  firstTextMs: number | null;
  turns: number;
  stopped: boolean;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  // Each tool Claude called and how long it took to run, in milliseconds.
  tools: { name: string; ms: number }[];
  // How many tool definitions the request carried (the question's sectors, not all of them).
  toolsSent: number;
  // Why the answer came from the rules instead (no text, numbers only).
  reason: string | null;
  // Each round: how it ended, the tools it asked for (the button and picture tools too), how
  // much text it wrote, and how long it took, so a hidden round can be seen.
  rounds: { stop: string; tools: string[]; textChars: number; ms: number }[];
  // Tries again after a 429 or a server error, and what the answer cost (hundredths of a cent).
  retries: number;
  costHundredths: number;
  // Answers written again (a button-only answer, or a guardrail problem).
  rewrites: number;
  // The guardrail rules that blocked an answer (codes only), so a block can be traced.
  guardrails: string[];
  // The pattern of each rule that matched (never the words), per blocked attempt.
  guardrailRules: string[];
  // Why each rewrite happened: "guardrail", "shape" or "button_only".
  rewriteReasons: string[];
};

// What the last answer was about, in words for Claude (spec step 193).
export function topicLine(topic: Topic): string {
  const what = [topic.target, topic.category, topic.month].filter(Boolean).join(", ");
  return `Your last answer was about ${what || topic.kind}${topic.verb ? ` (they were asking to ${topic.verb} it)` : ""}. If their message points back ("it", "that one", "the other one", "why", "tell me more", "ok and?", "what do you mean"), it is about that or what you just said; if it is a new question, ignore this.`;
}

export async function askClaudeInChat(
  userId: string,
  history: ChatTurn[],
  question: string,
  options: Options,
): Promise<ClaudeAnswer> {
  const timing: ChatTiming = {
    startedAt: Date.now(),
    primerMs: null,
    firstEventMs: null,
    firstTextMs: null,
    turns: 0,
    stopped: false,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    tools: [],
    toolsSent: 0,
    reason: null,
    rounds: [],
    retries: 0,
    costHundredths: 0,
    rewrites: 0,
    guardrails: [],
    guardrailRules: [],
    rewriteReasons: [],
  };
  let outcome = "error";
  try {
    const answer = await askClaude(userId, history, question, options, timing);
    outcome = answer.kind;
    return answer;
  } finally {
    const { startedAt, ...rest } = timing;
    console.info(
      "chat_timing",
      JSON.stringify({
        ...rest,
        outcome,
        totalMs: Date.now() - startedAt,
        // Time in none of the above: guardrail checks, the spend record, waiting between steps.
        costCents: Math.round(timing.costHundredths) / 100,
        otherMs:
          Date.now() -
          startedAt -
          (timing.primerMs ?? 0) -
          timing.rounds.reduce((n, r) => n + r.ms, 0) -
          timing.tools.reduce((n, t) => n + t.ms, 0),
        model: chatModel(),
        toolsSent: timing.toolsSent,
      }),
    );
  }
}

async function askClaude(
  userId: string,
  history: ChatTurn[],
  question: string,
  {
    client,
    now,
    claude = anthropic,
    maxTurns = CHAT_CLAUDE_MAX_TURNS,
    onEvent = () => {},
    advice = false,
    style = null,
    topic = null,
    firstWordsMs = CHAT_CLAUDE_FIRST_WORDS_MS,
    deadlineMs = CHAT_CLAUDE_DEADLINE_MS,
    primerMs = CHAT_PRIMER_BUDGET_MS,
  }: Options,
  timing: ChatTiming,
): Promise<ClaudeAnswer> {
  // Why Claude's answer isn't used goes in the timing line (a code, never text).
  const fail = (reason: string) => {
    timing.reason ??= reason;
    return unavailable();
  };
  // Spec step 93: Claude failed a moment ago: answer from the rules now, never a spinner.
  if (Date.now() < claudeDownUntil) return fail("cooldown");
  // Spec step 191: today's cost cap for this person.
  if (await overDailyCap(userId, { client, now })) return fail("daily_cap");
  const profile = advice ? "demo_advice" : "standard";
  onEvent({ type: "status", text: "Looking at your numbers…" });
  // The person's main numbers, for at most primerMs: a slow lookup finishes in the
  // background (and is kept for the next question) while Claude starts without it.
  const primerStarted = Date.now();
  // A sector question's lookups (the specific one it needs, or the sector's overview) start now,
  // together with the numbers, and are sent up front.
  const lookupNames = lookupsFor(
    question,
    sectorsFor(
      question,
      [...history].reverse().find((m) => m.role === "user")?.content ?? null,
      topic,
      now.toISOString().slice(0, 10),
    ),
  );
  const lookupsFetch =
    lookupNames.length === 0
      ? null
      : Promise.race([
          Promise.allSettled(
            lookupNames.map(async (name) => {
              const at = Date.now();
              const out = await runChatTool(userId, name, {}, { client, now });
              return { name, out, ms: Date.now() - at };
            }),
          ),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 3_000).unref?.()),
        ]);
  // A request to shop a policy: the quotes are fetched while the numbers load, so the card is
  // ready before Claude's first word and its answer is one round.
  const shopKind = shopKindOf(question);
  const shopFetch =
    shopKind === false
      ? null
      : quotesAnswer(
          userId,
          { kind: "insurance", ask: "quotes", policyKind: shopKind },
          { client, now },
        ).catch(() => null);
  const primer = await Promise.race([
    chatPrimer(userId, { client, now }),
    new Promise<{ text: string; cents: number[] }>((resolve) =>
      // A sector question waits for its lookups anyway, so its numbers get a little longer.
      setTimeout(
        () => resolve({ text: "", cents: [] }),
        lookupsFetch && primerMs === CHAT_PRIMER_BUDGET_MS ? primerMs + 1_000 : primerMs,
      ).unref?.(),
    ),
  ]);
  timing.primerMs = Date.now() - primerStarted;
  // Claude's clock starts now, after the lookup: it always gets its whole first-words window.
  const started = Date.now();
  // Figures the answer may use: any in the numbers sent up front or a tool's result (a
  // finding's title has some too: "Charged twice? $64.20 at Target"), the question, and
  // earlier answers.
  const allowedCents = [question, primer.text, ...history.map((m) => m.content)].flatMap((text) =>
    dollarFigures(text).map((f) => f.cents),
  );
  allowedCents.push(...primer.cents);
  let prepared: Awaited<ReturnType<typeof quotesAnswer>> | null = null;
  if (shopFetch) {
    const reply = await Promise.race([
      shopFetch,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3_000).unref?.()),
    ]);
    if (reply?.actions.some((a) => a.kind !== "link")) {
      prepared = reply;
      allowedCents.push(...dollarFigures(reply.body).map((f) => f.cents));
    }
  }
  let overviewBlock = "";
  if (lookupsFetch) {
    const results = await lookupsFetch;
    const lines: string[] = [];
    results?.forEach((result) => {
      if (result.status !== "fulfilled") return;
      const { name, out, ms } = result.value;
      lines.push(`${name}: ${out.content}`);
      allowedCents.push(...out.cents, ...dollarFigures(out.content).map((f) => f.cents));
      timing.tools.push({ name: `${name} (up front)`, ms });
    });
    if (lines.length > 0) {
      overviewBlock = `\n\nAlready looked up for this question (do not call these again):\n${lines.join("\n")}`;
    }
  }
  // The finding that was just talked about: its details go up front, so "tell me more" is one
  // round of writing, not a lookup first.
  let findingBlock = "";
  if (topic?.findingId) {
    const lookedUp = Date.now();
    try {
      const detail = await runChatTool(
        userId,
        "finding_details",
        { finding_id: topic.findingId },
        { client, now },
      );
      timing.tools.push({ name: "finding_details (up front)", ms: Date.now() - lookedUp });
      allowedCents.push(...detail.cents, ...dollarFigures(detail.content).map((f) => f.cents));
      findingBlock = `\n\nThe finding just discussed (finding_details, already looked up, id ${topic.findingId}):\n${detail.content}`;
    } catch {
      // Without it Claude can still look the finding up itself.
    }
  }
  let rewrites = 0;
  let decisionUsed = false;
  let retriesLeft = 1;
  let startRetries = 1;
  const partialAnswer = (): ClaudeAnswer | null => {
    const kept = withoutButtonTalk(draft.shownText()).trim();
    if (kept.length < 20) return null;
    return {
      kind: "answer",
      reply: {
        body: plainText(kept),
        actions: proposal?.actions ?? [],
        refs: { ...(proposal?.refs ?? {}), ...(advice ? { advice: true as const } : {}) },
      },
    };
  };
  // Only the last few turns: a long thread slows every follow-up. The topic of the last
  // answer is in the numbers sent with the question, so a short follow-up keeps its context.
  const messages = conversation(history.slice(-CHAT_CLAUDE_HISTORY), question);
  // Only the general tools and the sectors this question is about (./tool-select.ts).
  const actionRequest = ACTION_REQUEST.test(question);
  // A question that only asks for information isn't sent the button tool at all, so the answer
  // has to be written in words (it can still link with show_block's pictures).
  const tools = toolsFor(
    CHAT_TOOLS,
    question,
    [...history].reverse().find((m) => m.role === "user")?.content ?? null,
    topic,
    now.toISOString().slice(0, 10),
    // The button tool only for a request to act, and not when the card is already prepared.
    { buttons: actionRequest && !prepared },
  );
  timing.toolsSent = tools.length;
  let proposal: Extract<Proposal, { ok: true }> | null = prepared
    ? { ok: true, actions: prepared.actions, refs: prepared.refs, line: prepared.body }
    : null;
  let shown: AnswerBlock | null = null;
  // A pick-one card a tool found (insurance_needs, loan_fit): shown with the answer.
  let offered: OfferedOptions | null = null;
  const draft = new GuardedText(
    () => allowedCents,
    (text) => {
      if (!BUTTON_TALK.test(text)) onEvent({ type: "text", text: plainText(text) });
    },
    profile,
  );
  const system: Anthropic.TextBlockParam[] = [
    // The instructions and tools are the same for everyone in each mode, so they're cached.
    {
      type: "text",
      text: advice ? SYSTEM_DEMO_ADVICE : SYSTEM,
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text: `The person's numbers right now (today is ${now.toISOString().slice(0, 10)}):\n${primer.text || "None available."}${figuresLine(primer.cents)}${topic ? `\n\n${topicLine(topic)}` : ""}${findingBlock}${overviewBlock}${prepared ? `\n\nA card for this request is already prepared and will appear under your answer (never repeat its figures):\n${prepared.body}\nWrite one or two sentences saying what you found; do not call propose_action.` : ""}${style ? `\n\n${style}` : ""}`,
    },
  ];

  // The turns allowed: one more, once, when the last answer was only about a button and has to
  // be written again in words.
  let turnLimit = maxTurns;
  let buttonRewrites = 0;
  let shapeRewritten = false;
  for (let turn = 0; turn < turnLimit; turn += 1) {
    let response: Anthropic.Message;
    // Spec step 93: give up on a slow start, or a slow answer, for the rules' answer.
    let stopped = false;
    // Whether anything at all came back from Claude in this round.
    let heard = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // No time left for another round: the rules answer, and no stream is ever started.
      const turnStarted = Date.now();
      const totalLeft = CHAT_CLAUDE_TOTAL_MS - (Date.now() - started);
      if (Math.min(deadlineMs, totalLeft) <= 0) return fail("no_time");
      const stream = claude()
        .messages.stream({
          model: chatModel(),
          max_tokens: CHAT_CLAUDE_MAX_TOKENS,
          system,
          tools,
          // The last round answers from what it has: a lookup there would leave no answer.
          tool_choice: turn === turnLimit - 1 ? { type: "none" } : { type: "auto" },
          // Adaptive thinking at low effort (the request that worked). Turning thinking off
          // made the nightly's every chat request fail with a 400.
          thinking: { type: "adaptive" },
          output_config: { effort: CHAT_CLAUDE_EFFORT },
          messages,
        })
        .on("streamEvent", (event) => {
          heard = true;
          timing.firstEventMs ??= Date.now() - timing.startedAt;
          // It has started: now only the deadline applies.
          if (timer && turn === 0) {
            clearTimeout(timer);
            timer = setTimeout(
              stop,
              Math.max(
                0,
                Math.min(
                  deadlineMs - (Date.now() - turnStarted),
                  totalLeft - (Date.now() - turnStarted),
                ),
              ),
            );
          }
          if (event.type !== "content_block_start") return;
          if (event.content_block.type === "thinking") {
            onEvent({ type: "status", text: "Thinking…" });
          }
          if (event.content_block.type === "tool_use") {
            onEvent({ type: "status", text: statusFor(event.content_block.name) });
          }
        })
        // An aborted or failed stream also emits "error"; with no listener the SDK turns that
        // into an unhandled rejection that crashes the request. finalMessage() below is what
        // reports it.
        .on("error", () => {})
        .on("text", (delta) => {
          timing.firstTextMs ??= Date.now() - timing.startedAt;
          draft.push(delta);
        });
      function stop() {
        stopped = true;
        if (typeof stream.abort === "function") stream.abort();
      }
      // Each round has its own deadline (a slow lookup between rounds isn't Claude's time), within
      // a total for the whole question.
      const left = Math.min(deadlineMs, totalLeft);
      timer = setTimeout(stop, turn === 0 ? Math.min(firstWordsMs, left) : Math.max(0, left));
      timing.turns = turn + 1;
      response = await stream.finalMessage();
      timing.rounds.push({
        stop: String(response.stop_reason),
        tools: response.content.flatMap((b) => (b.type === "tool_use" ? [b.name] : [])),
        textChars: response.content.reduce(
          (n, b) => n + (b.type === "text" ? b.text.length : 0),
          0,
        ),
        ms: Date.now() - turnStarted,
      });
    } catch (error) {
      // Our own abort can surface as any error type: it is "too slow", never a crash.
      if (!stopped && !(error instanceof Anthropic.APIError)) throw error;
      if (stopped && !heard && turn === 0 && startRetries > 0) {
        // Claude never started (a cold start on a long prompt): once more, which usually finds
        // the prompt cached by the first try.
        startRetries -= 1;
        timing.retries += 1;
        turn -= 1;
        continue;
      }
      if (stopped) {
        timing.stopped = true;
        // Our own deadline: this answer comes from the rules, but Claude isn't marked down.
        console.warn("Jane's chat answer from Claude was too slow");
      } else {
        // The API's own reason (a type and a sentence about the request, never the person's
        // words), so a 400 can be read from the logs instead of guessed.
        console.error("Jane's chat request to Claude failed", {
          status: error instanceof Anthropic.APIError ? error.status : undefined,
          reason: String((error as Error).message).slice(0, 300),
        });
        // Only Claude itself failing (rate limit, overloaded, an error) is tried once more,
        // and only then pauses it.
        const status = (error instanceof Anthropic.APIError ? error.status : 0) ?? 0;
        if (status === 429 || status >= 500) {
          if (retriesLeft > 0 && draft.shownText().trim() === "") {
            retriesLeft -= 1;
            timing.retries += 1;
            await new Promise((resolve) => setTimeout(resolve, CHAT_CLAUDE_RETRY_MS));
            turn -= 1;
            continue;
          }
          claudeDownUntil = Date.now() + CHAT_CLAUDE_COOLDOWN_SECONDS * 1000;
        }
      }
      // Text already shown stays: it is what the person has read, so the answer is that, not a
      // retraction to "I couldn't look into that".
      const partial = partialAnswer();
      if (partial) {
        timing.reason ??= "partial";
        return partial;
      }
      return fail(stopped ? "too_slow" : "api_error");
    } finally {
      clearTimeout(timer);
    }

    timing.inputTokens += response.usage?.input_tokens ?? 0;
    timing.cachedInputTokens += response.usage?.cache_read_input_tokens ?? 0;
    timing.cacheWriteTokens += response.usage?.cache_creation_input_tokens ?? 0;
    timing.outputTokens += response.usage?.output_tokens ?? 0;
    const used = {
      model: chatModel(),
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      cacheReadTokens: response.usage?.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage?.cache_creation_input_tokens ?? 0,
    };
    timing.costHundredths += costInHundredthsOfCents(used);
    await addSpend(userId, used, { client, now });
    // The answer was written and only a button or a picture was asked for after it: that text
    // IS the answer, so there is no extra round just to be told "noted".
    const writtenText = response.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("\n")
      .trim();
    const decorationOnly =
      response.stop_reason === "tool_use" &&
      writtenText.length > 0 &&
      response.content.every(
        (b) => b.type !== "tool_use" || b.name === "propose_action" || b.name === "show_block",
      );
    if (response.stop_reason === "tool_use") {
      if (!decorationOnly) {
        // Any text so far led into the lookup; the answer comes after it.
        draft.reset();
        onEvent({ type: "reset" });
        messages.push({ role: "assistant", content: response.content });
      }
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        // Spec step 94: one block, built from the person's numbers, not Claude's.
        if (block.name === "show_block") {
          const args = (block.input ?? {}) as {
            kind?: string;
            month?: string;
            finding_id?: string;
          };
          const kind = (BLOCK_KINDS as readonly string[]).includes(args.kind ?? "")
            ? (args.kind as BlockKind)
            : null;
          const built: AnswerBlock | null =
            shown || !kind
              ? null
              : await buildBlock(userId, kind, {
                  client,
                  now,
                  month: args.month,
                  findingId: args.finding_id,
                });
          if (built) {
            shown = built;
            allowedCents.push(...blockCents(built));
          }
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: built
              ? `It will be shown under your answer: ${drawBlock(built).alt}`
              : "There's nothing to show for that.",
            ...(built ? {} : { is_error: true }),
          });
          continue;
        }
        // Phase AW: a practice-settings change, as a card the person confirms (./practice-tools.ts).
        if (block.name === CHANGE_PRACTICE_TOOL) {
          const result = proposal
            ? ({ ok: false, error: "You already offered a button for this answer." } as const)
            : await proposePracticeChange(userId, block.input, { client, now });
          if (result.ok) {
            proposal = { ok: true, actions: result.actions, refs: result.refs, line: result.line };
            allowedCents.push(...result.cents);
          }
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result.ok
              ? `The change is ready as a card under your answer, for them to confirm:\n${result.line}\nNow write one sentence saying what will change once they tap to confirm. Never say it's done, and don't repeat the card's figures.`
              : `${result.error}\n(Say this to the person in your own words; nothing was changed.)`,
            ...(result.ok ? {} : { is_error: true }),
          });
          continue;
        }
        if (block.name === "propose_action") {
          const result: Proposal = proposal
            ? { ok: false, error: "You already offered a button for this answer." }
            : await proposeAction(userId, block.input, { client, now });
          if (result.ok) {
            // Only a request to act gets an action button; the rest keeps its links.
            const acts: Extract<Proposal, { ok: true }>["actions"] = result.actions.filter(
              (a) => a.kind !== "link",
            );
            proposal =
              acts.length === 0 || ACTION_REQUEST.test(question)
                ? result
                : {
                    ...result,
                    actions: result.actions.filter((a) => a.kind === "link"),
                    refs: {},
                    line: null,
                  };
          }
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result.ok
              ? writtenText
                ? "Noted."
                : "The button is ready. Now write your answer in words, with the figures from the results, and don't mention the button."
              : `${result.error}\n(This is for you. Never tell the person a button could not be set up; answer their question in words.)`,
            ...(result.ok ? {} : { is_error: true }),
          });
          continue;
        }
        if (block.name === "decision") decisionUsed = true;
        const toolStarted = Date.now();
        const output = await runChatTool(userId, block.name, block.input, { client, now });
        timing.tools.push({ name: block.name, ms: Date.now() - toolStarted });
        allowedCents.push(...output.cents, ...dollarFigures(output.content).map((f) => f.cents));
        if (output.options) offered = output.options;
        results.push({ type: "tool_result", tool_use_id: block.id, content: output.content });
      }
      if (!decorationOnly) {
        messages.push({ role: "user", content: results });
        continue;
      }
    }

    if (response.stop_reason !== "end_turn" && !decorationOnly) {
      return fail(`stop_${response.stop_reason}`);
    }
    draft.finish();
    const text = response.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("\n")
      .trim();
    if (!text) return fail("empty");
    // Sentences about a button or link "under this answer" are dropped; an answer that was
    // only that (no figure, hardly a sentence) isn't an answer, so the rules answer instead.
    const hasButtons = proposal?.actions.some((a) => a.kind !== "link") ?? false;
    // "Tap Yes and the team does it" belongs only where there is a Yes to tap.
    const talkless = withoutButtonTalk(text);
    const spoken = hasButtons ? talkless : withoutTapYes(talkless);
    if (!spoken || (talkless !== text && talkless.length < 80 && !/\d/.test(talkless))) {
      // Not an answer, only a word about a button: once, Claude writes the answer from the
      // lookups it already has (text only: a button call here got no tool_result).
      if (buttonRewrites > 0) return fail("button_only");
      buttonRewrites += 1;
      turnLimit += 1;
      timing.rewrites += 1;
      timing.rewriteReasons.push("button_only");
      draft.reset();
      onEvent({ type: "reset" });
      messages.push({ role: "assistant", content: [{ type: "text", text: spoken || text }] });
      messages.push({ role: "user", content: BUTTON_REWRITE });
      continue;
    }
    const check = checkGuardrails(spoken, allowedCents, undefined, profile);
    if (!check.ok) {
      timing.guardrails.push(...check.issues);
      timing.guardrailRules.push(...guardrailMatches(spoken, allowedCents, profile).slice(0, 6));
    }
    if (!check.ok && rewrites < CHAT_CLAUDE_REWRITES) {
      // The rewrite gets a turn of its own even when the lookups used them all.
      if (turn + 1 >= turnLimit) turnLimit += 1;
      // Once, Claude is told what can't be shown and answers again.
      rewrites += 1;
      timing.rewrites += 1;
      timing.rewriteReasons.push(`guardrail:${check.issues.join("+")}`);
      draft.reset();
      onEvent({ type: "reset" });
      onEvent({ type: "status", text: "Checking my answer…" });
      // Text only: a button or picture call in this turn got no tool_result, and a tool_use
      // without one is a 400.
      messages.push({
        role: "assistant",
        content: response.content.filter((b) => b.type === "text"),
      });
      messages.push({
        role: "user",
        content: rewriteRequest(spoken, check.issues, allowedCents, advice),
      });
      continue;
    }
    if (check.ok && !shapeRewritten && tooLong(spoken, question, Boolean(proposal?.line))) {
      // Once: shorter, and no list the person didn't ask for.
      shapeRewritten = true;
      timing.rewrites += 1;
      timing.rewriteReasons.push(`shape:${spoken.length}chars`);
      if (turn + 1 >= turnLimit) turnLimit += 1;
      draft.reset();
      onEvent({ type: "reset" });
      messages.push({
        role: "assistant",
        content: response.content.filter((b) => b.type === "text"),
      });
      messages.push({
        role: "user",
        content: proposal?.line
          ? `${SHAPE_REWRITE} The card under your answer already shows the figures, so don't repeat them: one or two sentences.`
          : SHAPE_REWRITE,
      });
      continue;
    }
    if (!check.ok) {
      // The issues only, never the text: it's about the person's money.
      console.warn("Jane's chat answer was blocked by the guardrails", { issues: check.issues });
      // A safe fallback, with no buttons.
      return {
        kind: "blocked",
        reply: { body: ASK_BLOCKED_REPLY, actions: [], refs: {} },
        issues: check.issues,
      };
    }
    const refs: Reply["refs"] = { ...(proposal?.refs ?? {}) };
    // Spec step 193: a finding it offered a button for is what the next message is about.
    if (proposal?.refs.findingId) {
      refs.topic = { kind: "about", findingId: proposal.refs.findingId };
    }
    // A decision answered through the decision tool is what a following \"why?\" is about.
    if (decisionUsed && !refs.topic) {
      const asked = parseDecision(question.toLowerCase());
      refs.topic = {
        kind: "decision",
        category: asked?.item ?? "other",
        target: asked?.label ?? "that",
      };
    }
    // Its words pass the same guardrails as the answer, or it isn't shown.
    if (shown && checkGuardrails(drawBlock(shown).alt, allowedCents, undefined, profile).ok) {
      refs.block = shown;
    }
    // The options a tool found float over the chat as the pick-one card; its two buttons are
    // the card's (src/lib/jane-agent/actions/options.ts).
    if (offered) refs.options = offered;
    return {
      kind: "answer",
      reply: {
        body: proposal?.line ? `${plainText(spoken)}\n\n${proposal.line}` : plainText(spoken),
        actions: [...(proposal?.actions ?? []), ...(offered ? OPTION_ACTIONS : [])],
        // Demo advice is always labelled (the chat shows DEMO_ADVICE_LABEL under it). A pick
        // card is only ever offered in demo advice mode, so it is labelled too.
        refs: advice || offered ? { ...refs, advice: true } : refs,
      },
    };
  }
  // Too many rounds of lookups for one message.
  return fail("turn_cap");
}
