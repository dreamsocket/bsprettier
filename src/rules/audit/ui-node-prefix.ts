import { basename, dirname, isAbsolute, resolve } from "node:path";
import { emptyResult, type RuleResult } from "../../edit/types.js";
import { parseXml, walkElements } from "../../parser/xml.js";
import { attrValue, tagNameEquals } from "../../parser/xml-helpers.js";
import { diag, scan } from "./scan.js";
import type { BrsRule, BrsRuleContext } from "../rule.js";

const RULE_ID = "audit/ui-node-prefix";

function baseNameNoExt(filePath: string): string {
  const file = basename(filePath);
  const dot = file.lastIndexOf(".");
  return dot > 0 ? file.slice(0, dot) : file;
}

function absolutePath(filePath: string): string {
  return isAbsolute(filePath) ? filePath : resolve(filePath);
}

function packageRootFor(filePath: string): string | null {
  const normalized = filePath.replaceAll("\\", "/");
  for (const segment of ["/components/", "/source/"]) {
    const idx = normalized.lastIndexOf(segment);
    if (idx >= 0) return filePath.slice(0, idx);
  }
  return null;
}

function resolveUri(xmlPath: string, uri: string): string | null {
  if (
    /^[a-z][a-z0-9+.-]*:/i.test(uri) &&
    !uri.toLowerCase().startsWith("pkg:/")
  ) {
    return null;
  }
  if (uri.toLowerCase().startsWith("pkg:/")) {
    const root = packageRootFor(xmlPath);
    if (!root) return null;
    return resolve(root, uri.slice("pkg:/".length));
  }
  return resolve(dirname(xmlPath), uri);
}

function mainSceneReferencesFile(
  xmlPath: string,
  xmlSource: string,
  brsPath: string,
): boolean {
  const parse = parseXml(xmlSource);
  if (parse.fatal || !parse.root) return false;
  if (attrValue(parse.root, "name")?.toLowerCase() !== "mainscene") {
    return false;
  }

  let hasScript = false;
  for (const el of walkElements(parse.root)) {
    if (!tagNameEquals(el, "script")) continue;
    hasScript = true;
    const uri = attrValue(el, "uri");
    if (!uri) continue;
    const target = resolveUri(xmlPath, uri);
    if (!target || !/\.(brs|bs)$/i.test(target)) continue;
    if (absolutePath(target) === brsPath) return true;
  }

  if (hasScript) return false;
  const sibling = resolve(dirname(xmlPath), `${baseNameNoExt(xmlPath)}.brs`);
  return absolutePath(sibling) === brsPath;
}

function componentReferencesFile(
  xmlPath: string,
  xmlSource: string,
  brsPath: string,
): boolean {
  const parse = parseXml(xmlSource);
  if (parse.fatal || !parse.root) return false;

  let hasScript = false;
  for (const el of walkElements(parse.root)) {
    if (!tagNameEquals(el, "script")) continue;
    hasScript = true;
    const uri = attrValue(el, "uri");
    if (!uri) continue;
    const target = resolveUri(xmlPath, uri);
    if (!target || !/\.(brs|bs)$/i.test(target)) continue;
    if (absolutePath(target) === brsPath) return true;
  }

  if (hasScript) return false;
  const sibling = resolve(dirname(xmlPath), `${baseNameNoExt(xmlPath)}.brs`);
  return absolutePath(sibling) === brsPath;
}

function isMainSceneScript(ctx: BrsRuleContext): boolean {
  if (baseNameNoExt(ctx.filePath).toLowerCase() === "mainscene") return true;
  const sources = ctx.projectSources;
  if (!sources) return false;

  const brsPath = absolutePath(ctx.filePath);
  for (const [filePath, source] of sources) {
    if (!/\.xml$/i.test(filePath)) continue;
    if (mainSceneReferencesFile(absolutePath(filePath), source, brsPath)) {
      return true;
    }
  }
  return false;
}

function isSceneFindNodeReceiver(receiver: string): boolean {
  const normalized = receiver.replace(/\s+/g, "").toLowerCase();
  return (
    normalized === "scene" ||
    normalized === "m.scene" ||
    normalized === "m._scene" ||
    normalized === "getscene()" ||
    normalized.endsWith(".scene") ||
    normalized.endsWith("._scene") ||
    normalized.endsWith(".getscene()")
  );
}

/**
 * Collect local variable names assigned from a `getScene()` call, e.g.
 * `_scene = m.top.getScene()`. `findNode` calls on these hold scene-level nodes,
 * which are exempt from the `m._ui*` constraint just like a direct
 * `m.top.getScene().findNode(...)` chain.
 */
function sceneVariableNames(source: string): Set<string> {
  const names = new Set<string>();
  const re = /\b([A-Za-z_][\w]*)\s*=\s*[^\n']*?\.getScene\s*\(\s*\)/g;
  for (const m of scan(source, re)) {
    const name = (m.groups[0] ?? "").toLowerCase();
    if (name) names.add(name);
  }
  return names;
}

function isAnimationOrInterpolatorTag(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith("animation") || lower.endsWith("interpolator");
}

function animationOrInterpolatorIds(ctx: BrsRuleContext): Set<string> {
  const sources = ctx.projectSources;
  if (!sources) return new Set();

  const ids = new Set<string>();
  const brsPath = absolutePath(ctx.filePath);
  for (const [filePath, source] of sources) {
    if (!/\.xml$/i.test(filePath)) continue;
    const xmlPath = absolutePath(filePath);
    if (!componentReferencesFile(xmlPath, source, brsPath)) continue;

    const parse = parseXml(source);
    if (parse.fatal || !parse.root) continue;
    for (const el of walkElements(parse.root)) {
      if (!isAnimationOrInterpolatorTag(el.name)) continue;
      const id = attrValue(el, "id");
      if (id) ids.add(id);
    }
  }
  return ids;
}

function literalFindNodeId(rawArg: string): string | null {
  const trimmed = rawArg.trim();
  if (!trimmed.startsWith("\"") || !trimmed.endsWith("\"")) return null;
  return trimmed.slice(1, -1);
}

/**
 * UI node references obtained via `findNode` should be stored on members named
 * `m._ui*`, except for MainScene-level references and scene-level `findNode`
 * calls. Scene-level receivers include the literal scene object
 * (`scene`, `m.scene`, `m.top.getScene()`) and any local variable assigned from
 * `getScene()` (e.g. `_scene = m.top.getScene()` then `_scene.findNode(...)`).
 * Animation and Interpolator nodes are exempt from the `_ui` constraint
 * but must still use a private `_` prefix. Flags `m.<name> = ... findNode(...)`
 * where the member name does not satisfy the applicable prefix rule.
 */
export const uiNodePrefix: BrsRule = {
  id: RULE_ID,
  lang: "brs",
  phase: 4,
  run(ctx: BrsRuleContext): RuleResult {
    if (isMainSceneScript(ctx)) return emptyResult();

    const animationIds = animationOrInterpolatorIds(ctx);
    const sceneVars = sceneVariableNames(ctx.source);
    const re =
      /\bm\.([A-Za-z_][\w]*)\s*=\s*([^\n']*?)\.findNode\s*\(\s*([^,\)\n']*)/g;
    const diagnostics = scan(ctx.source, re)
      .filter((m) => {
        const receiver = m.groups[1] ?? "";
        return (
          !isSceneFindNodeReceiver(receiver) &&
          !sceneVars.has(receiver.replace(/\s+/g, "").toLowerCase())
        );
      })
      .flatMap((m) => {
        const member = m.groups[0] ?? "";
        const id = literalFindNodeId(m.groups[2] ?? "");
        // Animation/Interpolator nodes only need a private `_` prefix, never
        // the `_ui` prefix required for ordinary UI handles.
        if (id && animationIds.has(id)) {
          if (/^_/.test(member)) return [];
          return [
            diag(
              RULE_ID,
              ctx.severity,
              `Animation/Interpolator node member "m.${member}" should use the m._* prefix.`,
              m.offset,
              m.length,
            ),
          ];
        }
        if (/^_ui/i.test(member)) return [];
        return [
          diag(
            RULE_ID,
            ctx.severity,
            `UI node member "m.${member}" should use the m._ui* prefix.`,
            m.offset,
            m.length,
          ),
        ];
      });
    if (diagnostics.length === 0) return emptyResult();
    return { edits: [], diagnostics };
  },
};
