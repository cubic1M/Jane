import {
  ALL_PARTY_RECORDING_STATES,
  CALLABLE_LINES,
  CALL_HOURS,
  NO_AI_CALL_STATES,
} from "@/config/voice-calls";

// The check every real AI call must pass before it's placed (connectors roadmap round 19,
// voice_call_gate): a business line, neither the number's state nor the person's on the no-AI-call
// list, inside 9am-8pm where the company is, and an opener that says it's an AI assistant acting for
// the named account holder with their written permission, and that the call is recorded. Pure.

export type CallCheck = {
  lineType: string;
  calleeState: string | null;
  personState: string | null;
  calleeTimeZone: string;
  now: Date;
  personName: string;
  opener: string;
};

export type CallVerdict =
  { allowed: true; recordingNoticeRequired: boolean } | { allowed: false; reasons: string[] };

function localHour(now: Date, timeZone: string): number | null {
  try {
    const hour = new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone })
      .formatToParts(now)
      .find((p) => p.type === "hour")?.value;
    return hour === undefined ? null : Number(hour);
  } catch {
    return null;
  }
}

export function checkCall(call: CallCheck): CallVerdict {
  const reasons: string[] = [];
  if (!CALLABLE_LINES.includes(call.lineType)) reasons.push("not a business line");
  const states = [call.calleeState, call.personState].map((s) => (s ?? "").toUpperCase());
  if (!call.calleeState) reasons.push("the number's state is unknown");
  if (states.some((s) => NO_AI_CALL_STATES.includes(s))) reasons.push("a state that bars AI calls");
  const hour = localHour(call.now, call.calleeTimeZone);
  if (hour === null) reasons.push("the company's time zone is unknown");
  else if (hour < CALL_HOURS.from || hour >= CALL_HOURS.until)
    reasons.push("outside 9am-8pm where the company is");
  const opener = call.opener.toLowerCase();
  if (!/\b(?:ai|artificial intelligence)\b/.test(opener) || !opener.includes("assistant")) {
    reasons.push("the opener doesn't say it's an AI assistant");
  }
  if (!call.personName.trim() || !opener.includes(call.personName.trim().toLowerCase())) {
    reasons.push("the opener doesn't name the account holder");
  }
  if (!opener.includes("written permission"))
    reasons.push("the opener doesn't mention written permission");
  if (!/\brecorded\b/.test(opener)) reasons.push("the opener doesn't say the call is recorded");
  if (reasons.length > 0) return { allowed: false, reasons };
  return {
    allowed: true,
    recordingNoticeRequired: states.some((s) => ALL_PARTY_RECORDING_STATES.includes(s)),
  };
}
