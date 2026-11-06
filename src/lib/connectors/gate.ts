import { AsyncLocalStorage } from "node:async_hooks";
import { ACTING_METHODS, type Connector } from "./types";

// What makes the pipeline's checks impossible to skip (ported from the controller drafts' permission
// gate, #1190): a connector's acting methods work only inside a grant for that connector and that
// action, and only the pipeline (./pipeline.ts) hands one out. The registry wraps every connector
// with `gated`, so code holding a connector can't call `act` around the checks.

export type Grant = { connectorId: string; actionId: string; userId: string };

const grants = new AsyncLocalStorage<Grant>();

export class NoGrant extends Error {
  constructor(connectorId: string) {
    super(`${connectorId} tried to act outside the connector pipeline.`);
    this.name = "NoGrant";
  }
}

// Only ./pipeline.ts calls this (gate.test.ts holds it to that).
export const withGrant = <T>(grant: Grant, run: () => Promise<T>): Promise<T> =>
  grants.run(grant, run);

function requireGrant(connectorId: string, actionId: string, userId: string): void {
  const grant = grants.getStore();
  if (
    grant?.connectorId !== connectorId ||
    grant.actionId !== actionId ||
    grant.userId !== userId
  ) {
    throw new NoGrant(connectorId);
  }
}

// The connector with its acting methods checking for a grant that names it, the action and the
// person in the context they're given.
export function gated(connector: Connector): Connector {
  const wrapped: Connector = { ...connector };
  for (const method of ACTING_METHODS) {
    const original = connector[method];
    if (!original) continue;
    // Async, so a refusal is a rejected promise like any failure to act.
    const guarded = async (first: never, context: { actionId: string; userId: string }) => {
      requireGrant(connector.id, context.actionId, context.userId);
      return (original as unknown as (a: never, c: typeof context) => unknown)(first, context);
    };
    Object.assign(wrapped, { [method]: guarded });
  }
  return Object.freeze(wrapped);
}
