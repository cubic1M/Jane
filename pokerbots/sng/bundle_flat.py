"""Bundle our bot into ONE flat Python file with no exec/compile and stdlib-whitelist imports.

sng/bundle.py embeds module sources and exec()s them (needs exec, compile, sys, types,
base64, zlib): kits whose checker bans those (practice_kit2: allowed imports are
__future__ math random itertools functools collections heapq bisect json time statistics
typing dataclasses enum operator array copy numpy; banned names exec eval compile open
globals vars setattr ...; at most 100,000 bytes) need this flat bundler instead:

  * every bundled module's top-level code goes into one namespace (AST, via ast.unparse:
    comments and docstrings are dropped);
  * imports of our packages are removed: `from X import a as b` becomes `b = a`, module
    aliases (`from sng.ours import features as F`) are rewritten (`F.evaluate` ->
    `evaluate`); imports inside functions become `pass`;
  * other imports must be on the allowed list (others are dropped, and so is any
    top-level code that needs them, by the tree shake);
  * only the top-level definitions the adapter reaches are kept (tree shake);
  * no `from __future__ import annotations` (the kit loader does not register the module in
    sys.modules, and @dataclass with string annotations then fails); function annotations
    are stripped instead;
  * sng.ours.strength is replaced by a stub (icm_any never uses it), engine.game by the
    action stub of sng/bundle.py; the any-variant table is embedded as a literal.

    python3 -m sng.bundle_flat --adapter practice_kit2/adapter_kit2.py \\
        --any-table cache/sng/any_<sig>.json --out practice_kit2/submission_planA.py
"""
from __future__ import annotations

import argparse
import ast
import builtins
import json
from pathlib import Path

from sng.bundle import GAME_STUB

ROOT = Path(__file__).resolve().parents[1]

ALLOWED = frozenset({"__future__", "math", "random", "itertools", "functools", "collections", "heapq",
                     "bisect", "json", "time", "statistics", "typing", "dataclasses", "enum", "operator",
                     "array", "copy", "numpy"})
OURS = ("engine", "sng")

STRENGTH_STUB = '''
class strength:
    """sng.ours.strength stub: icm_any uses its own any-variant strength."""

    @staticmethod
    def preload(spec):
        return None

    @staticmethod
    def equity(hole, board, k, spec):
        return 1.0 / (max(1, k) + 1)
'''

LOADER = '''
def _expand(g):
    return {f"{k}|{i + 1}": v for k, vs in g.items() for i, v in enumerate(vs) if v is not None}


def load_bundled_any(spec):
    """Install the embedded any-variant table for icm_any (True if there is one)."""
    if not _ANY_TABLE:
        return False
    _STRENGTH[card_signature(spec)] = AnyStrength(spec, table=dict(pre=_expand(_ANY_TABLE["pre"]),
                                                               post=_expand(_ANY_TABLE["post"])))
    return True


def load_bundled_table(spec):
    return False
'''

# replacements for top-level functions whose real body needs the file system
OVERRIDES = {
    "sng.ours.anyvar": {
        "table_path": "class _NoFile:\n    def exists(self):\n        return False\n\n\n"
                      "def table_path(spec):\n    return _NoFile()\n",
    },
}

# (module name, source file or stub text)
MODULES = [
    ("engine.cards", "engine/cards.py"),
    ("engine.spec", "engine/spec.py"),
    ("engine.game", GAME_STUB),
    ("sng.ours.features", "sng/ours/features.py"),
    ("sng.ours.strength", STRENGTH_STUB),
    ("sng.ours.icm_exact", "sng/ours/icm_exact.py"),
    ("sng.ours.icm_tag", "sng/ours/icm_tag.py"),
    ("sng.ours.anyvar", "sng/ours/anyvar.py"),
]
STUBS = {"sng.ours.strength"}          # referenced by their alias name (a class of that name)
KNOWN = {m for m, _ in MODULES}


def _is_ours(mod: str) -> bool:
    return mod.split(".")[0] in OURS


def _resolve(node: ast.ImportFrom, modname: str) -> str:
    if not node.level:
        return node.module or ""
    base = modname.split(".")[:-node.level]
    return ".".join(base + ([node.module] if node.module else []))


class _Flatten(ast.NodeTransformer):
    """Remove our imports (keeping `b = a` aliases), rewrite module-alias attributes."""

    def __init__(self, modname, aliases, header, dropped):
        self.modname, self.aliases, self.header, self.dropped = modname, aliases, header, dropped
        self.depth = 0

    def _scope(self, node):
        self.depth += 1
        self.generic_visit(node)
        self.depth -= 1
        return node

    visit_FunctionDef = visit_AsyncFunctionDef = visit_ClassDef = _scope

    def _replace(self, stmts):
        if stmts:
            return stmts
        return [] if self.depth == 0 else ast.Pass()

    def visit_Import(self, node):
        keep, out = [], []
        for a in node.names:
            if _is_ours(a.name):
                continue                       # `import engine.x as y`: not used by our modules
            if a.name.split(".")[0] in ALLOWED:
                keep.append(a)
            else:
                self.dropped.add(a.asname or a.name.split(".")[0])
        if keep:
            node.names = keep
            if self.depth == 0:
                self.header.append(ast.unparse(node))
                return self._replace([])
            return node
        return self._replace(out)

    def visit_ImportFrom(self, node):
        mod = _resolve(node, self.modname)
        if not _is_ours(mod):
            if mod.split(".")[0] not in ALLOWED:
                self.dropped.update(a.asname or a.name for a in node.names)
                return self._replace([])
            if self.depth == 0:
                self.header.append(ast.unparse(node))
                return self._replace([])
            return node
        out = []
        for a in node.names:
            full = f"{mod}.{a.name}"
            name = a.asname or a.name
            if full in KNOWN:                  # a module object
                if full in STUBS:
                    if name != a.name:
                        out.append(ast.parse(f"{name} = {a.name}").body[0])
                continue
            if name != a.name:
                out.append(ast.parse(f"{name} = {a.name}").body[0])
        return self._replace(out)

    def visit_Attribute(self, node):
        self.generic_visit(node)
        if isinstance(node.value, ast.Name) and node.value.id in self.aliases:
            return ast.copy_location(ast.Name(id=node.attr, ctx=node.ctx), node)
        return node


def _module_aliases(tree, modname):
    """Names bound to INLINED module objects in this module (anywhere in it)."""
    out = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.ImportFrom):
            mod = _resolve(n, modname)
            for a in n.names:
                full = f"{mod}.{a.name}"
                if full in KNOWN and full not in STUBS:
                    out.add(a.asname or a.name)
    return out


def _strip_docstrings(tree):
    """Also drop function annotations: without `from __future__ import annotations` (see
    build) they would be evaluated at definition time."""
    for n in ast.walk(tree):
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
            n.returns = None
            for a in n.args.args + n.args.posonlyargs + n.args.kwonlyargs + [n.args.vararg, n.args.kwarg]:
                if a is not None:
                    a.annotation = None
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Module)):
            b = n.body
            if b and isinstance(b[0], ast.Expr) and isinstance(b[0].value, ast.Constant) \
                    and isinstance(b[0].value.value, str):
                n.body = b[1:] or [ast.Pass()]


def _is_main_guard(n):
    return isinstance(n, ast.If) and "__name__" in ast.unparse(n.test)


def _defs_refs(stmt):
    """Top-level names a statement binds (or mutates) and the names it reads."""
    if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        defs = {stmt.name}
    else:
        defs = set()
        for n in ast.walk(stmt):
            if isinstance(n, ast.Name) and isinstance(n.ctx, (ast.Store, ast.Del)):
                defs.add(n.id)
            elif isinstance(n, (ast.Subscript, ast.Attribute)) and isinstance(n.ctx, ast.Store):
                base = n.value
                while isinstance(base, (ast.Subscript, ast.Attribute)):
                    base = base.value
                if isinstance(base, ast.Name):
                    defs.add(base.id)
    refs = {n.id for n in ast.walk(stmt) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load)}
    return defs, refs


def _compact_any(path: Path) -> dict:
    """{'pre': {'key|k': v}} -> {'pre': {'key': [v for k = 1..7]}} rounded to 3 decimals."""
    t = json.loads(path.read_text())
    out = {}
    for part in ("pre", "post"):
        g = {}
        for k, v in t[part].items():
            key, kk = k.rsplit("|", 1)
            g.setdefault(key, [None] * 7)[int(kk) - 1] = round(v, 3)
        out[part] = g
    return out


def build(adapter: Path, out: Path, any_table: Path | None = None) -> Path:
    header, dropped, stmts = [], set(), []      # stmts: (origin, ast stmt, keep_always)
    sources = [(m, (ROOT / s).read_text() if s.endswith(".py") else s) for m, s in MODULES]
    sources.append(("_loader", LOADER))
    sources.append(("_adapter", adapter.read_text()))
    for modname, src in sources:
        tree = ast.parse(src)
        aliases = _module_aliases(tree, modname)
        tree = _Flatten(modname, aliases, header, dropped).visit(tree)
        _strip_docstrings(tree)
        over = OVERRIDES.get(modname, {})
        body = []
        for n in tree.body:
            if _is_main_guard(n) or (isinstance(n, ast.Expr) and isinstance(n.value, ast.Constant)):
                continue
            if isinstance(n, (ast.FunctionDef, ast.ClassDef)) and n.name in over:
                body += ast.parse(over.pop(n.name)).body
                continue
            body.append(n)
        stmts += [(modname, n, modname == "_adapter") for n in body]
    info = [_defs_refs(n) for _, n, _ in stmts]
    # tree shake: keep the adapter and everything it (transitively) reads
    need, keep = set(), [False] * len(stmts)
    changed = True
    while changed:
        changed = False
        for i, (_, n, always) in enumerate(stmts):
            if keep[i]:
                continue
            defs, refs = info[i]
            if always or defs & need:
                keep[i] = True
                need |= refs
                changed = True
    kept = [n for (_, n, _), k in zip(stmts, keep) if k]
    defined = set().union(*(info[i][0] for i in range(len(stmts)) if keep[i]))
    hdr_names = set()
    for h in header:
        for a in ast.parse(h).body[0].names:
            hdr_names.add((a.asname or a.name).split(".")[0])
    bound = set()          # locals, arguments, comprehension and except names, local imports
    for n in kept:
        for x in ast.walk(n):
            if isinstance(x, ast.Name) and isinstance(x.ctx, ast.Store):
                bound.add(x.id)
            elif isinstance(x, ast.arg):
                bound.add(x.arg)
            elif isinstance(x, (ast.Import, ast.ImportFrom)):
                bound.update((a.asname or a.name).split(".")[0] for a in x.names)
            elif isinstance(x, ast.ExceptHandler) and x.name:
                bound.add(x.name)
    missing = sorted(need - defined - hdr_names - bound - set(dir(builtins)) - {"_ANY_TABLE", "__file__"})
    bad = sorted(set(missing) & dropped)
    if bad:
        raise SystemExit(f"kept code needs dropped (disallowed) imports: {bad}")
    # NO `from __future__ import annotations`: kit loaders that import the file without
    # registering it in sys.modules (practice_kit2's importlib loader) break @dataclass with
    # string annotations (dataclasses reads sys.modules[cls.__module__].__dict__)
    future = []
    others = [h for h in dict.fromkeys(header) if not h.startswith("from __future__")]
    table = _compact_any(any_table) if any_table else None
    parts = ["# Generated by sng/bundle_flat.py: one flat file, no exec, kit-allowed imports only.",
             *future, *others,
             f"_ANY_TABLE = {json.dumps(table, separators=(',', ':')).replace('null', 'None')}",
             *(ast.unparse(n) for n in kept)]
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(parts) + "\n")
    if missing:
        print(f"note: names read but defined nowhere in the bundle (only safe in never-run "
              f"branches): {missing}")
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--adapter", required=True)
    ap.add_argument("--any-table", default=None, help="cache/sng/any_<sig>.json for icm_any")
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    p = build(Path(a.adapter), Path(a.out), Path(a.any_table) if a.any_table else None)
    print(f"wrote {p} ({p.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
