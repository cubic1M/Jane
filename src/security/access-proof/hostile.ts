import ts from "typescript";

// What an attacker sends. Every row Alice owns has the same id (world.ts), so one string names her
// account, her finding and her document at once, whatever a route or action calls its parameter.

export type Target = { rowId: string; userId: string };

const YEAR = String(new Date().getUTCFullYear());

// A plausible value for a field the attacker doesn't know the rules of, from its name: an id is
// always the victim's, and the rest only has to get past validation to reach the database.
export function valueForField(name: string, target: Target, literals: Map<string, string[]>) {
  const known = literals.get(name)?.[0];
  if (known !== undefined) return known;
  if (/^(user|owner|member|partner|person|target)_?id$/i.test(name)) return target.userId;
  // Past a format check, to the query behind it.
  if (/hash/i.test(name)) return "0".repeat(64);
  if (/(^|_)id$|Id$|Ids$|token|Key$|(^|_)key$|slug/.test(name)) return target.rowId;
  if (/^category$/i.test(name)) return "FOOD_AND_DRINK";
  if (/email/i.test(name)) return "attacker-chosen@example.com";
  if (/year/i.test(name)) return YEAR;
  if (/date|day$|(^|_)on$|At$|deadline|due|until|since|from$|to$/.test(name))
    return `${YEAR}-06-01`;
  if (
    /amount|cents|balance|dollars|apr|rate|limit|price|cost|value|minimum|payment|income|salary|percent|share|units|quantity|age|count|months|days|number|years|premium|deductible|total/i.test(
      name,
    )
  )
    return "100";
  if (/confirm|agree|accept|yes|enabled|on$/i.test(name)) return "on";
  if (/url|link|href/i.test(name)) return "/home";
  return target.rowId;
}

// A form that answers every field it is asked for, so no action needs a form written for it.
export class HostileForm extends FormData {
  readonly asked = new Set<string>();

  constructor(
    private readonly target: Target,
    private readonly literals: Map<string, string[]>,
  ) {
    super();
  }

  override has(_name: string) {
    return true;
  }

  override get(name: string) {
    this.asked.add(name);
    if (/file|csv|upload|document$|attachment|photo|image/i.test(name)) {
      return new File(["date,description,amount\n2026-06-01,x,1\n"], "x.csv", { type: "text/csv" });
    }
    return valueForField(name, this.target, this.literals);
  }

  override getAll(name: string) {
    return [this.get(name)];
  }
}

// An object argument of a type this parser can't see into: any property read gets a value.
function hostileObject(target: Target, literals: Map<string, string[]>): object {
  return new Proxy(
    {},
    {
      get(_, key) {
        if (typeof key !== "string" || key === "then" || key === "toJSON") return undefined;
        return valueForField(key, target, literals);
      },
      has: () => true,
    },
  );
}

export type Parameter = { name: string; type: string; optional: boolean };

// Each exported function's parameters, read from the source: at run time a function has no names.
export function exportedParameters(source: string, fileName = "x.ts"): Map<string, Parameter[]> {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const result = new Map<string, Parameter[]>();
  const parameters = (fn: ts.SignatureDeclaration) =>
    fn.parameters.map((p) => ({
      name: p.name.getText(file),
      type: p.type?.getText(file) ?? "",
      optional: Boolean(p.questionToken || p.initializer),
    }));
  for (const statement of file.statements) {
    const exported = ts.canHaveModifiers(statement)
      ? ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      : false;
    if (!exported) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      result.set(statement.name.text, parameters(statement));
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer;
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          result.set(declaration.name.getText(file), parameters(init));
        }
      }
    }
  }
  return result;
}

const TYPE_NAMES = new Set(["string", "number", "boolean", "object", "undefined", "function"]);

// The values a source compares its fields against, so `form.get("choice") === "yes"` gets "yes"
// and the attack reaches what's behind the check.
export function fieldLiterals(source: string): Map<string, string[]> {
  const literals = new Map<string, string[]>();
  const add = (field: string, value: string) => {
    literals.set(field, [...(literals.get(field) ?? []), value]);
  };
  const compared =
    /(?:get\(\s*"(\w+)"\s*\)[^;\n]{0,40}?|\b(\w+)\s*)(?:===|!==)\s*"([^"\n]{1,40})"/g;
  for (const match of source.matchAll(compared)) {
    // `typeof amount !== "number"` says nothing about the value it wants.
    if (!TYPE_NAMES.has(match[3])) add(match[1] ?? match[2], match[3]);
  }
  return literals;
}

// The fields a route reads from its JSON body and query: every name a destructure or a property
// read could want. Too many is harmless.
export function bodyFields(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(
    /\bconst\s*\{([^}]+)\}\s*=\s*(?:body|await|payload|json|data)/g,
  )) {
    for (const part of match[1].split(",")) {
      const name = part.split(":")[0].split("=")[0].trim();
      if (/^\w+$/.test(name)) names.add(name);
    }
  }
  for (const match of source.matchAll(/\b(?:body|payload|json|input|data)\??\.(\w+)/g))
    names.add(match[1]);
  for (const match of source.matchAll(/searchParams\.get\(\s*"(\w+)"\s*\)/g)) names.add(match[1]);
  return [...names];
}

export function queryFields(source: string): string[] {
  return [...source.matchAll(/searchParams\.get\(\s*"(\w+)"\s*\)/g)].map((m) => m[1]);
}

const STRING_UNION = /^\s*\|?\s*"([^"]+)"/;

// One argument for one parameter, from its name and type.
function argumentFor(
  p: Parameter,
  beforeForm: boolean,
  target: Target,
  literals: Map<string, string[]>,
): unknown {
  const type = p.type.trim();
  if (/FormData/.test(type)) return new HostileForm(target, literals);
  const field = p.name.replace(/^_+/, "");
  // useActionState's first argument: what the form said last time.
  if (beforeForm || /State\b/.test(type)) return null;
  const union = STRING_UNION.exec(type);
  if (union) return union[1];
  if (/\[\]$|^Array</.test(type)) return [target.rowId];
  if (/^string\b/.test(type)) return valueForField(field, target, literals);
  if (/^number\b/.test(type)) return 100;
  if (/^boolean\b/.test(type)) return true;
  if (type === "" && !p.name.startsWith("{")) return new HostileForm(target, literals);
  return hostileObject(target, literals);
}

export function hostileArguments(
  parameters: Parameter[] | undefined,
  target: Target,
  literals: Map<string, string[]>,
): unknown[] {
  if (!parameters) return [new HostileForm(target, literals)];
  return parameters.map((p, i) =>
    argumentFor(p, /FormData/.test(parameters[i + 1]?.type ?? ""), target, literals),
  );
}

// Route segments and search params, whatever they're called.
export function hostileParams(target: Target): Record<string, unknown> {
  return new Proxy(
    {},
    {
      get(_, key) {
        if (typeof key !== "string" || key === "then" || key === "toJSON") return undefined;
        return valueForField(key, target, new Map());
      },
      has: () => true,
      ownKeys: () => [],
    },
  );
}
