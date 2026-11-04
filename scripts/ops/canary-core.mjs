// Reads what a canary run printed. Only numbers and two short names leave this, so nothing a model
// wrote can reach the public ops-numbers branch.
const NAME = /^[\w.@/-]{1,60}$/;
const safeName = (value) => (typeof value === "string" && NAME.test(value) ? value : "unknown");

export function canaryRecord({ output, solved, seconds, version, model, at }) {
  let result = {};
  try {
    result = JSON.parse(output);
  } catch {
    // An answer it can't read still counts: solved or not is the score's call, not this one's.
  }
  const number = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  return {
    at,
    // A run that never reached the model says nothing about the model: not the same as unsolved.
    ran: result.is_error !== true && typeof result.num_turns === "number",
    solved: solved === true,
    turns: number(result.num_turns),
    minutes: Math.round((seconds / 60) * 10) / 10,
    costUsd: number(result.total_cost_usd),
    model: safeName(model),
    version: safeName(version),
  };
}
