/**
 * Generic recursive walk over a BrighterScript AST. BSC nodes are plain objects
 * carrying a `kind` string and a `location`; children live in arbitrary
 * properties (and arrays of them). We avoid the `parent` back-reference to
 * prevent cycles.
 */
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
    for (const [key, value] of Object.entries(node)) {
      if (key === "parent" || key === "symbolTable") continue;
      if (value != null && typeof value === "object") {
        stack.push(value);
      }
    }
  }
}

export function findNodesOfKind(root: any, kind: string): any[] {
  const out: any[] = [];
  for (const node of walkNodes(root)) {
    if (node.kind === kind) out.push(node);
  }
  return out;
}
