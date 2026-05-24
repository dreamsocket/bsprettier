import { Lexer } from "brighterscript/dist/lexer/Lexer.js";
import {
  emptyResult,
  type Diagnostic,
  type Edit,
  type RuleResult,
} from "../../edit/types.js";
import type { BscToken } from "../../parser/brighterscript-adapter.js";
import { absolutePath } from "../../project/context.js";
import { diag, scan } from "./scan.js";
import type { BrsRule, BrsRuleContext } from "../rule.js";

const RULE_ID = "audit/ui-node-prefix";

function isSceneScript(ctx: BrsRuleContext): boolean {
  return ctx.projectContext?.isSceneScript(ctx.filePath) ?? false;
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

function animationOrInterpolatorIds(ctx: BrsRuleContext): Set<string> {
  return ctx.projectContext?.animationOrInterpolatorIds(ctx.filePath) ?? new Set();
}

function literalFindNodeId(rawArg: string): string | null {
  const trimmed = rawArg.trim();
  if (!trimmed.startsWith("\"") || !trimmed.endsWith("\"")) return null;
  return trimmed.slice(1, -1);
}

/**
 * The component-local script scope for the current file: every sibling script in
 * the same directory as a component that links it, plus the file itself, keyed by
 * absolute path. Falls back to just the current file when no component references
 * it (a standalone script still owns its own `m`).
 */
function gatherScopeSources(ctx: BrsRuleContext): Map<string, string> {
  const scope = ctx.projectContext?.scopeSources(ctx.filePath) ?? new Map();
  scope.set(absolutePath(ctx.filePath), ctx.source);
  return scope.size > 0 ? scope : new Map([[ctx.filePath, ctx.source]]);
}

/** `tileGroup` → `_uiTileGroup`; `_sleEndScreen` → `_uiSleEndScreen`. */
function uiTarget(member: string): string {
  const core = member.replace(/^_+/, "");
  return `_ui${core.charAt(0).toUpperCase()}${core.slice(1)}`;
}

/** `fadeAnimation` → `_fadeAnimation` (Animation/Interpolator: private only). */
function privatePrefix(member: string): string {
  return member.startsWith("_") ? member : `_${member}`;
}

const FINDNODE_ASSIGN_RE =
  /\bm\.([A-Za-z_][\w]*)\s*=\s*([^\n']*?)\.findNode\s*\(\s*([^,\)\n']*)/g;

interface UiRenames {
  /** lowercased member → target name (safe to apply). */
  renames: Map<string, string>;
  /** lowercased member → intended target that collided (cannot apply). */
  collisions: Map<string, string>;
}

/**
 * Decide the UI-handle renames for a whole component scope. A `m.<name>` assigned
 * from a non-scene `findNode(...)` should be stored under `m._ui*` (ordinary UI
 * nodes) or `m._*` (Animation/Interpolator nodes). Scanning every scope script
 * means a handle assigned in one file is renamed at its read sites in the others.
 * A target that already names a different member is a collision: left unrenamed
 * and surfaced for a human.
 */
function computeUiRenames(
  scopeSources: Map<string, string>,
  animationIds: Set<string>,
): UiRenames {
  const memberNames = new Set<string>();
  for (const src of scopeSources.values()) {
    for (const m of scan(src, /\bm\.([A-Za-z_][\w]*)/g)) {
      memberNames.add((m.groups[0] ?? "").toLowerCase());
    }
  }

  const renames = new Map<string, string>();
  const collisions = new Map<string, string>();
  const targetsUsed = new Set<string>();

  for (const src of scopeSources.values()) {
    const sceneVars = sceneVariableNames(src);
    for (const m of scan(src, FINDNODE_ASSIGN_RE)) {
      const member = m.groups[0] ?? "";
      const receiver = m.groups[1] ?? "";
      if (isSceneFindNodeReceiver(receiver)) continue;
      if (sceneVars.has(receiver.replace(/\s+/g, "").toLowerCase())) continue;

      const id = literalFindNodeId(m.groups[2] ?? "");
      let target: string;
      if (id && animationIds.has(id)) {
        if (/^_/.test(member)) continue; // already private
        target = privatePrefix(member);
      } else {
        if (/^_ui/i.test(member)) continue; // already prefixed
        target = uiTarget(member);
      }

      const key = member.toLowerCase();
      const targetKey = target.toLowerCase();
      if (renames.has(key) || collisions.has(key)) continue;
      if ((memberNames.has(targetKey) && targetKey !== key) || targetsUsed.has(targetKey)) {
        collisions.set(key, target);
        continue;
      }
      renames.set(key, target);
      targetsUsed.add(targetKey);
    }
  }
  return { renames, collisions };
}

/**
 * Rewrite direct `m.<member>` references whose member is in `renames`. Token-based
 * so it never touches strings (e.g. the `findNode("id")` argument) or comments,
 * and only bare `m.<member>` — not `node.m.<member>` on some other object.
 */
function memberRenameEdits(
  ctx: BrsRuleContext,
  renames: Map<string, string>,
): Edit[] {
  const lex = Lexer.scan(ctx.source);
  if (lex.diagnostics.length > 0) return [];
  const sig = (lex.tokens as BscToken[]).filter(
    (t) => t.kind !== "Newline" && t.kind !== "Comment",
  );
  const edits: Edit[] = [];
  for (let i = 0; i < sig.length; i++) {
    const tok = sig[i]!;
    if (tok.kind !== "Identifier" || !tok.location) continue;
    const replacement = renames.get(tok.text.toLowerCase());
    if (!replacement) continue;
    if (sig[i - 1]?.kind !== "Dot") continue;
    const obj = sig[i - 2];
    if (!(obj?.kind === "Identifier" && obj.text.toLowerCase() === "m")) continue;
    if (sig[i - 3]?.kind === "Dot") continue; // foo.m.member → different `m`
    const span = ctx.parse.lineIndex.rangeToSpan(tok.location.range);
    edits.push({
      ruleId: RULE_ID,
      offset: span.offset,
      length: span.length,
      replacement,
    });
  }
  return edits;
}

/**
 * UI node references obtained via `findNode` should be stored on members named
 * `m._ui*`, except for scripts linked from components that extend `Scene` and
 * scene-level `findNode`
 * calls. Scene-level receivers include the literal scene object
 * (`scene`, `m.scene`, `m.top.getScene()`) and any local variable assigned from
 * `getScene()` (e.g. `_scene = m.top.getScene()` then `_scene.findNode(...)`).
 * Animation and Interpolator nodes are exempt from the `_ui` constraint but must
 * still use a private `_` prefix.
 *
 * The rule auto-fixes by renaming the member (`m.tileGroup` → `m._uiTileGroup`,
 * `m.fadeAnimation` → `m._fadeAnimation`) across the whole component scope, so a
 * handle assigned in one script and read in a sibling is renamed in both. When
 * the target name already belongs to a different member, the rename can't be
 * applied and a non-fixable warning is surfaced instead. Because the fix is the
 * report, successful renames are silent.
 */
export const uiNodePrefix: BrsRule = {
  id: RULE_ID,
  lang: "brs",
  phase: 4,
  run(ctx: BrsRuleContext): RuleResult {
    if (isSceneScript(ctx)) return emptyResult();

    const animationIds = animationOrInterpolatorIds(ctx);
    const scopeSources = gatherScopeSources(ctx);
    const { renames, collisions } = computeUiRenames(scopeSources, animationIds);

    const edits = renames.size > 0 ? memberRenameEdits(ctx, renames) : [];

    // Surface only collisions visible in this file (reported once, with a local
    // span). Successful renames are applied without a warning.
    const diagnostics: Diagnostic[] = [];
    if (collisions.size > 0) {
      const sceneVars = sceneVariableNames(ctx.source);
      for (const m of scan(ctx.source, FINDNODE_ASSIGN_RE)) {
        const member = m.groups[0] ?? "";
        const receiver = m.groups[1] ?? "";
        if (isSceneFindNodeReceiver(receiver)) continue;
        if (sceneVars.has(receiver.replace(/\s+/g, "").toLowerCase())) continue;
        const target = collisions.get(member.toLowerCase());
        if (!target) continue;
        diagnostics.push(
          diag(
            RULE_ID,
            ctx.severity,
            `UI node member "m.${member}" should be renamed to "m.${target}", ` +
              "but that member name already exists; resolve by hand.",
            m.offset,
            m.length,
          ),
        );
      }
    }

    if (edits.length === 0 && diagnostics.length === 0) return emptyResult();
    return { edits, diagnostics };
  },
};
