import type { Reply } from "../replies";
import { loadSnapshotFast } from "../snapshot-store";
import { autopilotOf } from "@/lib/autopilot";
import { lastControllerRun } from "@/lib/controller-log";
import { autopilotFor, sectorAutopilots } from "@/lib/sector-autopilot";
import { listLifeEvents } from "@/lib/life-events";
import { homeSummary } from "@/lib/home";
import { whatJaneDid } from "@/lib/what-jane-did";
import { flowReply } from "../flows/chat";
import { timezoneOf } from "../open";
import { searchChat } from "../search";
import { searchReply } from "../search-reply";
import { learnReply } from "../learn";
import {
  actReply,
  rememberReply,
  approveAllReply,
  greetingReply,
  pauseReply,
  undoReply,
  whatDidReply,
} from "../replies";
import { overviewReply, sectorChangeReply } from "../replies-autopilot";
import { checkedReply } from "../replies-checked";
import { rankedFor } from "../priorities";
import { prioritiesReply } from "../replies-priorities";
import { wholePictureReply } from "../whole-picture";
import { planReply } from "../multi";
import { loadTimeline } from "@/lib/timeline";
import { timelineReply } from "../replies-timeline";
import { healthFor } from "@/lib/health-score";
import { healthReply } from "../replies-health";
import { loadSteady } from "@/lib/steady-pay";
import { steadyReply } from "../replies-steady";
import { whatIf } from "@/lib/what-if";
import { loadLongView } from "@/lib/long-view";
import { loadProfile } from "@/lib/profile";
import { profileReply } from "../replies-profile";
import { longViewReply } from "../replies-longview";
import { whatIfReply } from "../replies-whatif";
import { groupedHelpReply } from "../replies-help";
import { lifeEventReply } from "../replies-life";
import { loadSnapshot } from "../snapshot";
import { type CapabilityContext } from "./shared";
import { ackReply } from "../ack-reply";
import { whyFindingReply } from "../explain-finding";

// Jane herself: the whole picture, what she did, autopilot, memory, help and plans (spec step 190): the rules' answers for these kinds of question, one registered
// capability each in ./index.ts. Moved out of ../answer.ts unchanged.

async function answer(ctx: CapabilityContext): Promise<Reply | null> {
  const { intent } = ctx;
  const { userId, client, now, asOf, ask } = ctx;

  switch (intent.kind) {
    // A typed "yes" or "no": Jane only acts on a tap, so it points at the button.
    case "ack":
    case "remind":
      return ackReply(userId, intent, { client });
    case "follow_up":
    case "explain":
      return null;
    case "why_finding":
      return whyFindingReply(userId, intent.findingId, { client });
    case "unknown":
      return null;
    case "help":
      return groupedHelpReply();
    case "greeting": {
      if (intent.thanks) return greetingReply(true, null);
      const home = await homeSummary(userId, { client, now });
      return greetingReply(false, home?.safeToSpend ?? null, asOf);
    }
    case "remember":
      return rememberReply(intent.draft);
    // Spec step 96.
    case "search": {
      const timezone = await timezoneOf(userId, { client });
      return searchReply(
        intent.query,
        await searchChat(userId, intent.query, { client, now, timezone }),
        timezone,
      );
    }
    // Spec step 95.
    case "flow":
      return flowReply(intent.flow, { userId, client, now });
    // Spec step 183.
    case "whole_picture": {
      const snapshot = await loadSnapshotFast(userId, { client, now });
      return wholePictureReply(snapshot, snapshot ? rankedFor(snapshot) : [], intent.focus);
    }
    case "priorities": {
      const snapshot = await loadSnapshotFast(userId, { client, now });
      return prioritiesReply(snapshot ? rankedFor(snapshot) : [], intent.explain, intent.one);
    }
    // Spec step 203.
    case "what_if":
      return whatIfReply(
        await whatIf(
          userId,
          intent.scenario,
          { months: intent.months ?? undefined },
          { client, now },
        ),
      );
    // Spec step 209.
    case "long_view":
      return longViewReply(await loadLongView(userId, {}, { client, now }));
    // Spec step 253.
    case "profile":
      return profileReply(await loadProfile(userId, { client, now }));
    // Spec step 240.
    case "steady_pay":
      return steadyReply(await loadSteady(userId, { client, now }));
    case "health":
      return healthReply(await healthFor(userId, { client, now }));
    case "checked":
      return checkedReply(await lastControllerRun(userId, { client, now }));
    // Spec step 187.
    case "timeline":
      return timelineReply(await loadTimeline(userId, { client, limit: 20 }), intent.why, asOf);
    case "what_did":
      return whatDidReply(await whatJaneDid(userId, { client, now }));
    case "act":
      return actReply(intent, await loadSnapshot(userId, { client, now }));
    case "approve_all":
      return approveAllReply(await loadSnapshot(userId, { client, now }));
    case "undo":
      return undoReply(await loadSnapshot(userId, { client, now }), now);
    case "pause_autopilot":
      return pauseReply(await autopilotOf(userId, { client }));
    case "autopilot_overview":
      return overviewReply(
        await sectorAutopilots(userId, { client, now }),
        await autopilotOf(userId, { client }),
      );
    case "autopilot_sector":
      return sectorChangeReply(
        intent,
        await autopilotFor(userId, intent.sector, { client, now }),
        await autopilotOf(userId, { client }),
      );
    case "life_event": {
      const open = await listLifeEvents(userId, { client });
      const going = open.some((e) => e.kind === intent.event && e.completedAt === null);
      return lifeEventReply(intent.event, going);
    }
    case "learn":
      return learnReply(intent.slug);
    case "multi":
      return planReply(userId, intent.parts, {
        client,
        now,
        answer: (part) => ask(part),
      });
    // Spec step 185: one plan for several actions, or money into a goal.
    case "move_to_goal":
      return planReply(userId, [intent], {
        client,
        now,
        answer: (part) => ask(part),
      });
    default:
      return null;
  }
}

export const janeAnswer = answer;
