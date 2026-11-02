// Wording changed in src/ that an end-to-end spec still expects. Three times a page's words changed
// and CI only said so 15 minutes later, in a spec nobody had searched ("W-2 from ACME CORP PAYROLL",
// "come in from Uber Driver"). The old words were often built from data, so they showed only in the
// unit tests' expectations: every string removed from src/ counts, tests included. Pure.

const WORDS_IN_A_RUN = 4;

// The quoted strings on a line; a template's ${…} parts split it.
export function stringsIn(line) {
  const found = [];
  for (const match of line.matchAll(
    /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g,
  )) {
    const text = match[1] ?? match[2] ?? match[3];
    found.push(...text.split(/\$\{[^}]*\}/));
  }
  // A regular expression's text is wording too: /I saw \$412 come in from Uber Driver/.
  for (const match of line.matchAll(/\/((?:[^/\\\n]|\\.){12,})\/[a-z]*/g)) found.push(match[1]);
  return found;
}

const wordsOf = (text) =>
  text
    .replace(/\\/g, "")
    .toLowerCase()
    .split(/[^a-z0-9$&.-]+/)
    .map((w) => w.replace(/^[.-]+|[.-]+$/g, ""))
    .filter(Boolean);

function runsOf(text) {
  const words = wordsOf(text);
  const runs = [];
  for (let i = 0; i + WORDS_IN_A_RUN <= words.length; i++) {
    runs.push(words.slice(i, i + WORDS_IN_A_RUN).join(" "));
  }
  return runs;
}

// From a unified diff of src/: the runs of words removed and not added back.
export function removedWording(diff) {
  const removed = new Set();
  const added = new Set();
  for (const line of diff.split("\n")) {
    if (line.startsWith("---") || line.startsWith("+++")) continue;
    const target = line.startsWith("-") ? removed : line.startsWith("+") ? added : null;
    if (!target) continue;
    for (const text of stringsIn(line.slice(1))) for (const run of runsOf(text)) target.add(run);
  }
  return [...removed].filter((run) => !added.has(run));
}

// Where those runs still appear: [{ file, line, wording }].
export function staleWording(diff, specs) {
  const runs = removedWording(diff);
  const hits = [];
  for (const { file, text } of specs) {
    text.split("\n").forEach((content, i) => {
      const spoken = ` ${wordsOf(content).join(" ")} `;
      for (const run of runs) {
        if (spoken.includes(` ${run} `)) hits.push({ file, line: i + 1, wording: run });
      }
    });
  }
  return hits;
}
