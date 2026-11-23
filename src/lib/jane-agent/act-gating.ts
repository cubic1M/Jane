import { globSync, readFileSync } from "node:fs";
import ts from "typescript";
import { ADVICE_TOPICS } from "@/config/suggestions";
import { tellsThemToAct } from "@/lib/real-account-text";

// Every string the backup chat or a card can say that tells the person to act (tellsThemToAct, the
// rule src/lib/suggestions.ts's forRealAccount drops cards by), and why it can't reach a person with
// a real account, read from the code around it (manager 11-23). Used by act-gating.test.ts.

export type Gate =
  // In a card whose topic is advice-only (ADVICE_TOPICS): a real account never gets it.
  | "advice_topic"
  // In a card's title, headline, short or why: forRealAccount drops the card for a real account.
  | "real_account_filter"
  // On the advice side of a check on advice mode, or after a "not in advice mode" return or throw.
  | "advice_branch"
  // In a reply labelled demo advice (refs.advice), which only advice mode shows.
  | "refs_advice"
  // In a helper whose every use is gated one of these ways.
  | "callers_gated";

export type Flagged = { file: string; line: number; text: string; gate: Gate | null };

const NOT_REPLIES =
  /(?:\.test\.ts$|__fixtures__|\/checks\/|claude\.ts$|tools\.ts$|tool-select\.ts$|act-gating\.ts$)/;
const ADVICE = new Set<string>(ADVICE_TOPICS as readonly string[]);
const CARD_TEXT = new Set(["title", "headline", "short", "why"]);
const ON_ADVICE = /\b(?:advice|adviceMode|\w+\.advice|isAdvice)\b/;
const NOT_ADVICE = /!\s*\(?\s*(?:await\s+)?(?:advice\b|adviceMode\(|\w+\.advice\b|isAdvice\b)/;

type Src = { file: string; src: ts.SourceFile };

const textOf = (node: ts.Node): string | null =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : ts.isTemplateExpression(node)
      ? [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join("X")
      : null;

// The name a node reaches the rest of the code by: the const it's assigned to (a local one too: its
// uses decide), or its function's.
// scope: the function a local const lives in, whose own uses are the only ones; null for a name the
// module declares, used anywhere.
function owner(node: ts.Node): { name: string; scope: ts.Node | null } | null {
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
    if (ts.isFunctionDeclaration(p) && p.name) return { name: p.name.text, scope: null };
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) {
      let scope: ts.Node | undefined = p.parent;
      while (scope && !ts.isFunctionLike(scope) && !ts.isSourceFile(scope)) scope = scope.parent;
      return { name: p.name.text, scope: scope && ts.isFunctionLike(scope) ? scope : null };
    }
  }
  return null;
}

// Functions that stop outside advice mode ("demoAdviceOnly": throws unless adviceMode): code after
// a call to one runs only in advice mode.
const guards = new Set<string>();
function noteGuards(src: ts.SourceFile) {
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      const first = node.body.statements[0];
      if (
        first &&
        ts.isIfStatement(first) &&
        NOT_ADVICE.test(first.expression.getText(src)) &&
        /\b(?:return|throw)\b/.test(first.thenStatement.getText(src))
      )
        guards.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
}
const isGuardCall = (s: ts.Statement, src: ts.SourceFile) =>
  ts.isExpressionStatement(s) &&
  [...guards].some((g) => new RegExp(`^(?:await\\s+)?${g}\\(`).test(s.expression.getText(src)));

// Every return of the function holds a reply labelled demo advice.
function returnsOnlyAdvice(fn: ts.Node, src: ts.SourceFile): boolean {
  const returns: ts.ReturnStatement[] = [];
  const visit = (node: ts.Node) => {
    if (node !== fn && ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node)) returns.push(node);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(fn, visit);
  return (
    returns.length > 0 &&
    returns.every((r) => /\brefs:\s*\{[^}]*\badvice:\s*true/.test(r.getText(src)))
  );
}

function directGate(node: ts.Node, src: ts.SourceFile): Gate | null {
  let field: string | null = null;
  for (
    let p: ts.Node | undefined = node.parent, child: ts.Node = node;
    p;
    child = p, p = p.parent
  ) {
    if (!field && ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) field = p.name.text;
    if (ts.isCallExpression(p) && p.expression.getText(src) === "suggestion") {
      const topic = p.arguments[1];
      if (topic && ts.isStringLiteral(topic) && ADVICE.has(topic.text)) return "advice_topic";
      if (field && CARD_TEXT.has(field)) return "real_account_filter";
    }
    if (ts.isConditionalExpression(p) || ts.isIfStatement(p)) {
      const cond = (ts.isConditionalExpression(p) ? p.condition : p.expression).getText(src);
      const yes = ts.isConditionalExpression(p) ? p.whenTrue : p.thenStatement;
      const no = ts.isConditionalExpression(p) ? p.whenFalse : p.elseStatement;
      if (child === yes && ON_ADVICE.test(cond) && !NOT_ADVICE.test(cond)) return "advice_branch";
      if (child === no && NOT_ADVICE.test(cond)) return "advice_branch";
    }
    if (
      ts.isBinaryExpression(p) &&
      p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      if (
        child === p.right &&
        ON_ADVICE.test(p.left.getText(src)) &&
        !NOT_ADVICE.test(p.left.getText(src))
      )
        return "advice_branch";
    }
    if (ts.isBlock(p) || ts.isCaseClause(p)) {
      const statements = ts.isBlock(p) ? p.statements : p.statements;
      const earlier = statements.filter((s) => s.end <= child.pos);
      if (
        earlier.some(
          (s) =>
            (ts.isIfStatement(s) &&
              NOT_ADVICE.test(s.expression.getText(src)) &&
              /\b(?:return|throw)\b/.test(s.thenStatement.getText(src))) ||
            isGuardCall(s, src),
        )
      )
        return "advice_branch";
    }
    if (ts.isObjectLiteralExpression(p) && /\brefs:\s*\{[^}]*\badvice:\s*true/.test(p.getText(src)))
      return "refs_advice";
    if (ts.isFunctionLike(p) && returnsOnlyAdvice(p, src)) return "refs_advice";
  }
  return null;
}

export function flaggedStrings(): Flagged[] {
  const files = [
    ...globSync("src/lib/jane-agent/**/*.ts"),
    "src/lib/savings-text.ts",
    ...globSync("src/detectors/*.ts"),
  ].filter((f) => !NOT_REPLIES.test(f));
  const all: Src[] = [...globSync("src/**/*.{ts,tsx}")]
    .filter((f) => !/\.test\.tsx?$|__fixtures__|\/generated\//.test(f))
    .map((file) => ({
      file,
      src: ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true),
    }));
  const byFile = new Map(all.map((s) => [s.file, s]));
  for (const { src } of all) noteGuards(src);
  // Where each name is used, outside its own declaration.
  const uses = new Map<string, { node: ts.Node; src: ts.SourceFile }[]>();
  for (const { src } of all) {
    const visit = (node: ts.Node) => {
      if (ts.isIdentifier(node)) {
        const parent = node.parent;
        const declares =
          (ts.isFunctionDeclaration(parent) || ts.isVariableDeclaration(parent)) &&
          parent.name === node;
        const imports = ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent);
        if (!declares && !imports) {
          const list = uses.get(node.text) ?? [];
          list.push({ node, src });
          uses.set(node.text, list);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(src);
  }
  // A use that's only tested ("if (inv.advice && iraTap && …)"), never shown.
  const onlyTested = (node: ts.Node): boolean => {
    for (let p: ts.Node | undefined = node, child = node; p; child = p, p = p.parent) {
      if (ts.isIfStatement(p)) return child === p.expression;
      if (ts.isConditionalExpression(p)) return child === p.condition;
      if (ts.isStatement(p)) return false;
    }
    return false;
  };
  const gateOf = (node: ts.Node, src: ts.SourceFile, depth: number): Gate | null => {
    const direct = directGate(node, src);
    if (direct) return direct;
    if (depth >= 3) return null;
    const own = owner(node);
    const sites = (own ? (uses.get(own.name) ?? []) : []).filter(
      (s) =>
        !onlyTested(s.node) &&
        (own!.scope === null ||
          (s.src === src && s.node.pos >= own!.scope.pos && s.node.end <= own!.scope.end)),
    );
    return sites.length > 0 && sites.every((s) => gateOf(s.node, s.src, depth + 1) !== null)
      ? "callers_gated"
      : null;
  };
  const out: Flagged[] = [];
  for (const file of files) {
    const { src } = byFile.get(file)!;
    const visit = (node: ts.Node) => {
      const text = textOf(node);
      if (text && /^[A-Z][a-z]/.test(text) && /\s/.test(text) && tellsThemToAct(text)) {
        out.push({
          file,
          line: src.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          text,
          gate: gateOf(node, src, 0),
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(src);
  }
  return out;
}
