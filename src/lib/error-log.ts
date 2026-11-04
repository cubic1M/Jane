import type { PrismaClient } from "@/generated/prisma/client";
import { log, logText } from "@/lib/log";
import { scrub, scrubPath } from "@/lib/scrub";
import { reportToSentry } from "@/lib/sentry";
import { systemDb } from "@/lib/system-db";

// Error monitoring without a third-party service: server errors are scrubbed and stored
// in error_events (viewable at /admin/errors), and a scrubbed line goes to the logs.

const MAX_MESSAGE = 1000;
const MAX_STACK = 4000;

export type RequestErrorContext = {
  path?: string;
  method?: string;
  routeType?: string;
};

const stackFrames = (stack: string) =>
  stack
    .split("\n")
    .filter((line) => /^\s*at /.test(line))
    .join("\n");

export function describeError(error: unknown) {
  const err = error instanceof Error ? error : new Error(String(error));
  const digest =
    typeof error === "object" && error !== null && "digest" in error ? String(error.digest) : null;
  return {
    // As in the logs: an error can quote what it was given, a row of someone's statement, and these
    // rows have no owner, so deleting a person can't reach them. Code locations only from the stack,
    // whose first lines repeat the message.
    message: logText(`${err.name}: ${err.message}`).slice(0, MAX_MESSAGE),
    stack: err.stack ? scrub(stackFrames(err.stack)).slice(0, MAX_STACK) : null,
    digest,
  };
}

export async function recordError(
  error: unknown,
  context: RequestErrorContext,
  client: PrismaClient,
): Promise<void> {
  const described = describeError(error);
  const path = scrubPath(context.path);
  log.error("Request error", {
    message: described.message,
    path,
    routeType: context.routeType,
  });
  try {
    await systemDb(
      "The error log and its alerts are the system's own records",
      client,
    ).errorEvent.create({
      data: {
        ...described,
        path,
        method: context.method ?? null,
        routeType: context.routeType ?? null,
      },
    });
  } catch {
    // Never let error logging cause another error.
  }
  await reportToSentry({ ...described, path, routeType: context.routeType });
}
