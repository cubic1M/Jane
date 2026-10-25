import type { RiskLevel } from "@/config/investing";
import { practiceProfileOf } from "@/lib/practice/preferences";
import { strategyBoard, type Board, type BoardInput } from "./strategy-board";
import { strategyTree } from "./strategy-tree";

// The strategy board's input for a person: their practice portfolio's level and what it runs.
export async function boardInputOf(userId: string): Promise<Omit<BoardInput, "level">> {
  const profile = await practiceProfileOf(userId);
  return {
    yourLevel: profile.level,
    choice: profile.strategyChoice,
    catalog: profile.catalog?.id ?? null,
    crypto: profile.crypto?.strategy ?? null,
    dayTrading: profile.dayTrade?.rule ?? null,
  };
}

export async function strategyBoardFor(userId: string, level: RiskLevel): Promise<Board> {
  return strategyBoard({ ...(await boardInputOf(userId)), level });
}

export async function strategyTreeFor(userId: string) {
  return strategyTree(await boardInputOf(userId));
}
