// Splits a whole-suite run into shards by how long each file took last time, so the shards finish
// together. Vitest's own --shard goes by file name: they ranged from 1,116 to 2,131 seconds. Pure.

// A file with no timing yet counts as the middle file.
function median(values) {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 1;
}

// Longest first, each into the emptiest shard. Same input, same answer.
export function shardPlan(files, timings, shards) {
  const known = files.map((file) => timings[file]).filter((ms) => typeof ms === "number");
  const fallback = median(known);
  const plan = Array.from({ length: shards }, () => ({ ms: 0, files: [] }));
  const ordered = files
    .map((file) => ({ file, ms: timings[file] ?? fallback }))
    .toSorted((a, b) => b.ms - a.ms || a.file.localeCompare(b.file));
  for (const { file, ms } of ordered) {
    const emptiest = plan.reduce((best, shard) => (shard.ms < best.ms ? shard : best));
    emptiest.files.push(file);
    emptiest.ms += ms;
  }
  return plan;
}
