// The raw database client skips row-level security (docs/security/rls.md): a query made through it
// runs as the app's own role and sees everyone. New code on a person's data goes through scopedFor
// (src/lib/db-scoped.ts). This rule counts each file's uses of the raw client against a list of what
// was there when the rule came in (src/config/raw-db-allowlist.json), so only a new use fails, and a
// file that uses it less must lower its number, so the list only shrinks. See
// docs/security/access-proof.md.

// A use is any reference to `db` from src/lib/db, or to a name it was given
// (`client = defaultClient`, `const raw = db`): passing it on counts, since that is how it escapes.
const DB_MODULE = /^(@\/lib\/db|(\.{1,2}\/)+(lib\/)?db)$/;
// What only the two files that build the client should touch.
const DRIVER_MODULE = /^(pg|@prisma\/adapter-pg)$/;

const meta = {
  type: "problem",
  docs: { description: "No new uses of the raw database client outside the allowlist" },
  schema: [
    {
      type: "object",
      properties: { allowed: { type: "object", additionalProperties: { type: "integer" } } },
      additionalProperties: false,
    },
  ],
  messages: {
    newUse:
      "New raw database client use ({{used}} here, {{allowed}} listed): it skips row-level security. Use scopedFor from src/lib/db-scoped.ts. docs/security/access-proof.md says what to do if this truly works across people.",
    lower:
      "This file now has {{used}} raw database client uses, {{allowed}} listed: lower its number in src/config/raw-db-allowlist.json so the list only shrinks.",
    driver:
      "Only src/lib/db.ts and src/lib/rls-pg.ts talk to the database driver: use scopedFor from src/lib/db-scoped.ts.",
  },
};

function create(context) {
  const allowed = context.options[0]?.allowed ?? {};
  const name = context.filename.replaceAll("\\", "/").replace(/^.*?(?=src\/)/, "");
  const limit = allowed[name] ?? 0;
  const { sourceCode } = context;
  const uses = [];
  const seenVariables = new Set();

  // Every reference to a variable, and through any name it is given.
  function follow(variable) {
    if (!variable || seenVariables.has(variable)) return;
    seenVariables.add(variable);
    for (const reference of variable.references) {
      if (!reference.isRead()) continue;
      const node = reference.identifier;
      uses.push(node);
      const parent = node.parent;
      if (parent?.type === "VariableDeclarator" && parent.init === node) {
        for (const alias of sourceCode.getDeclaredVariables(parent)) follow(alias);
      } else if (parent?.type === "AssignmentPattern" && parent.right === node) {
        if (parent.left.type === "Identifier") {
          let scope = sourceCode.getScope(parent);
          while (scope && !scope.set.has(parent.left.name)) scope = scope.upper;
          follow(scope?.set.get(parent.left.name));
        }
      }
    }
  }

  return {
    ImportDeclaration(node) {
      const source = String(node.source.value);
      if (node.importKind === "type") return;
      const values = node.specifiers.filter((s) => s.importKind !== "type");
      if (DRIVER_MODULE.test(source) && values.length > 0) {
        context.report({ node, messageId: "driver" });
        return;
      }
      if (!DB_MODULE.test(source)) return;
      for (const specifier of values) {
        for (const variable of sourceCode.getDeclaredVariables(specifier)) follow(variable);
      }
    },
    ExportNamedDeclaration(node) {
      if (node.source && DB_MODULE.test(String(node.source.value))) uses.push(node);
    },
    ExportAllDeclaration(node) {
      if (DB_MODULE.test(String(node.source.value))) uses.push(node);
    },
    ImportExpression(node) {
      if (node.source.type !== "Literal") return;
      if (DB_MODULE.test(String(node.source.value))) uses.push(node);
      else if (DRIVER_MODULE.test(String(node.source.value))) {
        context.report({ node, messageId: "driver" });
      }
    },
    NewExpression(node) {
      const callee = node.callee.type === "MemberExpression" ? node.callee.property : node.callee;
      if (callee.type !== "Identifier" || callee.name !== "PrismaClient") return;
      context.report({ node, messageId: "driver" });
    },
    "Program:exit"(program) {
      const data = { used: uses.length, allowed: limit };
      if (uses.length > limit) {
        // The first one past the limit: usually, though not always, the new one.
        const ordered = uses.toSorted((a, b) => a.range[0] - b.range[0]);
        context.report({ node: ordered[limit], messageId: "newUse", data });
      } else if (uses.length < limit) {
        context.report({ node: program, messageId: "lower", data });
      }
    },
  };
}

export const noRawDb = { meta, create };
const plugin = { rules: { "no-raw-db": noRawDb } };
export default plugin;
