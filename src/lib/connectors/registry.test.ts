import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REAL_CONNECTORS, connectorsKilledByEnv, connectorsOn } from "@/config/connectors";
import { KILL_SWITCH_VARS, mayChange, rememberStoredSwitches } from "@/config/kill-switches";
import { REAL_MONEY_MOVEMENT } from "@/config/money-movement";
import { fakeConnector, fakeSandbox } from "./__fixtures__/connectors";
import { NoGrant, withGrant } from "./gate";
import {
  allConnectors,
  buildRegistry,
  connectorById,
  definitionProblems,
  mayMoveRealMoney,
  useConnectorsForTests,
  whyUnavailable,
} from "./registry";
import type { ActContext } from "./types";

const ON = { CONNECTORS: "1" };
const real = { userId: "user_real", sampleData: false };
const sample = { userId: "user_demo", sampleData: true };

beforeEach(() => {
  for (const name of KILL_SWITCH_VARS) vi.stubEnv(name, "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  rememberStoredSwitches([]);
  useConnectorsForTests(null);
});

describe("the flags", () => {
  it("are off unless CONNECTORS is exactly 1", () => {
    expect(connectorsOn({})).toBe(false);
    for (const value of ["0", "true", "yes", "11", ""]) {
      expect(connectorsOn({ CONNECTORS: value }), value).toBe(false);
    }
    expect(connectorsOn({ CONNECTORS: " 1 " })).toBe(true);
  });

  it("turns on no real connector and no real money movement in code", () => {
    expect(Object.values(REAL_CONNECTORS).filter(Boolean)).toEqual([]);
    expect(REAL_MONEY_MOVEMENT).toBe(false);
  });

  it("never reads a real connector's switch from the environment", () => {
    const source = readFileSync("src/config/connectors.ts", "utf8");
    const definition = source.slice(source.indexOf("export const REAL_CONNECTORS"));
    expect(definition.slice(0, definition.indexOf(";"))).not.toContain("process.env");
  });

  it("reads CONNECTORS_KILLED as a list of ids", () => {
    expect([...connectorsKilledByEnv({ CONNECTORS_KILLED: " bill_pay, ,quote " })]).toEqual([
      "bill_pay",
      "quote",
    ]);
    expect(connectorsKilledByEnv({}).size).toBe(0);
  });
});

describe("whyUnavailable", () => {
  const { connector } = fakeConnector();
  const { connector: sandbox } = fakeSandbox();

  it("refuses everything, sandbox included, while CONNECTORS is off", () => {
    expect(whyUnavailable(connector, real, {})).toBe("off");
    expect(whyUnavailable(sandbox, sample, {})).toBe("off");
  });

  it("gives sandbox adapters to sample data only", () => {
    expect(whyUnavailable(sandbox, sample, ON)).toBeNull();
    expect(whyUnavailable(sandbox, real, ON)).toBe("sandbox_for_samples");
  });

  it("keeps a real connector off until it is switched on in code", () => {
    expect(whyUnavailable(connector, real, ON)).toBe("switched_off");
  });

  it("never gives a trial person or sample data a real connector", () => {
    expect(whyUnavailable(connector, { userId: "trial_abc", sampleData: false }, ON)).toBe("trial");
    expect(whyUnavailable(connector, { userId: "trial_abc", sampleData: true }, ON)).toBe("trial");
    expect(whyUnavailable(connector, sample, ON)).toBe("real_for_real");
  });

  it("stops at KILL_CONNECTORS, the stored switch, or the id in CONNECTORS_KILLED", () => {
    vi.stubEnv("KILL_CONNECTORS", "1");
    expect(whyUnavailable(sandbox, sample, ON)).toBe("killed");
    vi.stubEnv("KILL_CONNECTORS", "");
    rememberStoredSwitches(["connectors"]);
    expect(whyUnavailable(sandbox, sample, ON)).toBe("killed");
    rememberStoredSwitches([]);
    expect(whyUnavailable(sandbox, sample, { ...ON, CONNECTORS_KILLED: "fake_sandbox" })).toBe(
      "killed",
    );
    expect(whyUnavailable(sandbox, sample, { ...ON, CONNECTORS_KILLED: "other" })).toBeNull();
  });

  it("lets a reducing secret turn the connectors switch on, never off", () => {
    expect(mayChange("reduce", "connectors", true)).toBe(true);
    expect(mayChange("reduce", "connectors", false)).toBe(false);
  });
});

describe("mayMoveRealMoney", () => {
  it("is false for everything while REAL_MONEY_MOVEMENT is false", () => {
    expect(mayMoveRealMoney({ sandbox: false, movesMoney: true })).toBe(false);
    expect(mayMoveRealMoney({ sandbox: true, movesMoney: true })).toBe(false);
  });
});

describe("the registry", () => {
  it("refuses a connector whose definition doesn't hold together", () => {
    expect(definitionProblems(fakeConnector().connector)).toEqual([]);
    expect(definitionProblems(fakeConnector({ id: "Bad-Id" }).connector)).toContain(
      "id must be snake_case",
    );
    expect(definitionProblems(fakeConnector({ capabilities: ["prefill"] }).connector)).toContain(
      "act and the act capability go together",
    );
    expect(definitionProblems(fakeConnector({ prefill: undefined }).connector)).toContain(
      "prefill and the prefill capability go together",
    );
    expect(definitionProblems(fakeConnector({ scopes: [] }).connector)).toContain(
      "needs at least one consent scope",
    );
    const twice = [fakeConnector().connector, fakeConnector().connector];
    expect(() => buildRegistry(twice)).toThrow("registered twice");
  });

  it("holds every registered connector to its definition", () => {
    for (const connector of allConnectors()) expect(definitionProblems(connector)).toEqual([]);
  });

  it("finds connectors by id", () => {
    useConnectorsForTests([fakeConnector().connector]);
    expect(connectorById("fake_bills")?.name).toBe("Fake Bills");
    expect(connectorById("nope")).toBeNull();
  });
});

describe("the gate", () => {
  const context = (actionId = "act_1", userId = "user_real"): ActContext => ({
    userId,
    actionId,
    idempotencyKey: "key",
    now: new Date(),
    withSecret: () => Promise.reject(new Error("no secret here")),
  });

  it("refuses an acting method called outside the pipeline's grant", async () => {
    const { connector: raw, calls } = fakeConnector();
    useConnectorsForTests([raw]);
    const connector = connectorById("fake_bills")!;
    const draft = connector.prefill!({ payee: "Con Ed", amountCents: 8412 });
    await expect(connector.act!(draft, context())).rejects.toThrow(NoGrant);
    await expect(connector.cancel!("ext_1", context())).rejects.toThrow(NoGrant);
    expect(calls.act).toHaveLength(0);
    expect(calls.cancel).toHaveLength(0);
  });

  it("needs the grant to name the same connector, action and person", async () => {
    const { connector: raw, calls } = fakeConnector();
    useConnectorsForTests([raw]);
    const connector = connectorById("fake_bills")!;
    const draft = connector.prefill!({ payee: "Con Ed", amountCents: 8412 });
    const grant = { connectorId: "fake_bills", actionId: "act_1", userId: "user_real" };
    await expect(
      withGrant({ ...grant, connectorId: "other" }, () => connector.act!(draft, context())),
    ).rejects.toThrow(NoGrant);
    await expect(withGrant(grant, () => connector.act!(draft, context("act_2")))).rejects.toThrow(
      NoGrant,
    );
    await expect(
      withGrant(grant, () => connector.act!(draft, context("act_1", "someone_else"))),
    ).rejects.toThrow(NoGrant);
    await expect(withGrant(grant, () => connector.act!(draft, context()))).resolves.toMatchObject({
      externalRef: "ext_act_1",
    });
    expect(calls.act).toHaveLength(1);
  });

  it("is handed out only by the pipeline", () => {
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? files(path) : [path];
      });
    const users = files("src")
      .filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path))
      .filter((path) => /\bwithGrant\b/.test(readFileSync(path, "utf8")));
    expect(users.sort()).toEqual(
      ["src/lib/connectors/gate.ts", "src/lib/connectors/pipeline.ts"].filter((path) =>
        users.includes(path),
      ),
    );
    expect(users).toContain("src/lib/connectors/gate.ts");
  });
});
