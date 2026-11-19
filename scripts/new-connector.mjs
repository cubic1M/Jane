// The next connector, the same hour of work each time (connectors batch 2, section C7; the checklist
// is in docs/connectors.md, "Add a connector"). Creates its folder from a name, with a real
// registration and a sandbox twin, both off, and a test that says so; then prints the steps left.
//   node scripts/new-connector.mjs <id> "<Vendor name>"     e.g. new-connector.mjs acme_rates "Acme"
// Never overwrites a file.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const camel = (id) => id.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
const pascal = (id) => camel(id).replace(/^./, (c) => c.toUpperCase());

export function scaffold({ id, vendor, root = process.cwd() }) {
  if (!/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(id ?? ""))
    throw new Error("The id is lower_snake_case, like acme_rates");
  if (!vendor || vendor.length > 40) throw new Error("Give the vendor's name, in quotes");
  const dir = join(root, "src", "lib", "connectors", id.replace(/_/g, "-"));
  if (existsSync(dir)) throw new Error(`${dir} already exists`);
  const name = camel(id);
  const twin = `sandbox${pascal(id)}`;
  const files = {
    "api.ts": `// ${vendor}'s API, the part Jane uses. Cite the docs page and the date you read it here, and type
// only the fields Jane reads. The client never logs or returns a key, and refuses a live host.

export class ${pascal(id)}Error extends Error {
  constructor(readonly code: string) {
    super(\`${vendor} request failed: \${code}\`);
    this.name = "${pascal(id)}Error";
  }
}
`,
    "sample.ts": `// ${vendor}'s own documented example responses, cut to the fields Jane reads, for the sandbox twin
// and the tests. Copy them from the docs (cite the page and date); never invent numbers.
export const ${id.toUpperCase()}_DOCS_EXAMPLE = {} as const;
`,
    "connector.ts": `import type { Connector } from "../types";

// ${vendor} (docs: <url>, read <date>). Two registrations: the real one reaches nobody until
// REAL_CONNECTORS.${id}; the sandbox twin reads ${vendor}'s documented examples for sample people.

export const ${name}: Connector = {
  id: "${id}",
  name: "What it does for the person, through ${vendor}",
  category: "bank_data",
  capabilities: ["read"],
  scopes: ["read_accounts"],
  from: "Where the data comes from, through ${vendor}",
  sandbox: false,
  movesMoney: false,
};

export const ${twin}: Connector = {
  ...${name},
  id: "sandbox_${id}",
  name: "What it does for the person, through ${vendor} (sandbox)",
  from: "A sample from ${vendor}'s own example",
  sandbox: true,
};
`,
    [`${id.replace(/_/g, "-")}.test.ts`]: `import { describe, expect, it } from "vitest";
import { whyUnavailable } from "../registry";
import { ${name}, ${twin} } from "./connector";

// ${vendor}: off for real people and trials; the twin for sample people only.

describe("who ${vendor} reaches", () => {
  const on = { CONNECTORS: "1" };
  it("is off for real people and trials, and the twin is for sample data only", () => {
    expect(whyUnavailable(${name}, { userId: "u", sampleData: false }, {})).toBe("off");
    expect(whyUnavailable(${name}, { userId: "u", sampleData: false }, on)).toBe("switched_off");
    expect(whyUnavailable(${name}, { userId: "trial_x", sampleData: false }, on)).toBe("trial");
    expect(whyUnavailable(${twin}, { userId: "u", sampleData: true }, on)).toBeNull();
    expect(whyUnavailable(${twin}, { userId: "u", sampleData: false }, on)).toBe("sandbox_for_samples");
  });
});
`,
  };
  mkdirSync(dir, { recursive: true });
  for (const [file, text] of Object.entries(files))
    writeFileSync(join(dir, file), text, { flag: "wx" });
  // In the repo's own style; skipped where prettier isn't installed (a bare temp folder).
  try {
    execFileSync("npx", ["--no-install", "prettier", "--write", dir], {
      cwd: root,
      stdio: "ignore",
    });
  } catch {
    // Left as written.
  }
  return { dir, files: Object.keys(files), name, twin };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [id, vendor] = process.argv.slice(2);
  try {
    const made = scaffold({ id, vendor });
    console.log(`Made ${made.dir}: ${made.files.join(", ")}.`);
    console.log(`Next, from "Add a connector" in docs/connectors.md:
  1. Fill in api.ts and sample.ts from ${vendor}'s docs (cite the page and date).
  2. Give connector.ts its read (or prefill and act), category, scopes and from.
  3. Register ${made.name} and ${made.twin} in src/lib/connectors/registry.ts, and add "${id}" to the
     real list in sandbox/adapters.integration.test.ts.
  4. Config with URL and date in src/config; key names (empty) in .env.example, each followed by a
     comment line; the names in VENDOR_CHECKS (src/lib/connectors/env-check.ts) and VENDOR_OF (status.ts).
  5. A legal scope needs counsel's text as consentText; a reader needs forget or a reason it keeps nothing.
  6. Offer it with <ConnectTap> in the card that needs it, never in sign-up.
  7. Tests, then a section in docs/connectors.md and a line in connector-infra.md.`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
