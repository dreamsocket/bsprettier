/**
 * Generic recursive walk over a BrighterScript AST. BSC nodes are plain objects
 * carrying a `kind` string and a `location`; children live in arbitrary
 * properties (and arrays of them). We avoid the `parent` back-reference to
 * prevent cycles.
 */

/**
 * Keys that never hold nested AST nodes. Skipping them keeps the walk out of the
 * enormous token/position substructure (every token carries a location whose
 * range carries start/end positions) that otherwise dwarfs the actual statement
 * and expression nodes — that traversal was the bulk of the cost. `parent`/
 * `symbolTable` are back-references (cycle sources); `location`/`range` hold only
 * positions; `tokens`/`leadingTrivia`/`trailingTrivia` hold lexer tokens, which
 * have a numeric `kind` (never yielded) and contain no nested AST nodes.
 */
const SKIP_KEYS = new Set<string>([
  "parent",
  "symbolTable",
  "location",
  "range",
  "tokens",
  "leadingTrivia",
  "trailingTrivia",
]);

export function* walkNodes(root: any): Generator<any> {
  if (root == null || typeof root !== "object") return;
  const seen = new Set<any>();
  const stack: any[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node == null || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }
    if (typeof node.kind === "string") {
      yield node;
    }
    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) continue;
      const value = node[key];
      if (value != null && typeof value === "object") {
        stack.push(value);
      }
    }
  }
}

/**
 * Per-root index of nodes bucketed by `kind`, built with a single walk and
 * cached against the root object. The two `if`-rules both query `parse.ast`, and
 * any rule that asks for multiple kinds reuses the same walk. The cache is keyed
 * by object identity, so a fresh parse (new ast after a reparse) gets a fresh
 * index automatically and is collected with the parse it belongs to.
 */
const kindIndexCache = new WeakMap<object, Map<string, any[]>>();

function kindIndex(root: any): Map<string, any[]> {
  let index = kindIndexCache.get(root);
  if (!index) {
    index = new Map();
    for (const node of walkNodes(root)) {
      const arr = index.get(node.kind);
      if (arr) arr.push(node);
      else index.set(node.kind, [node]);
    }
    kindIndexCache.set(root, index);
  }
  return index;
}

const EMPTY: readonly any[] = [];

/**
 * All nodes of `kind` under `root`. Returns the cached array directly (callers
 * iterate read-only — do not mutate the result).
 */
export function findNodesOfKind(root: any, kind: string): any[] {
  if (root == null || typeof root !== "object") return EMPTY as any[];
  return kindIndex(root).get(kind) ?? (EMPTY as any[]);
}
