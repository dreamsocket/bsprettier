import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BsprettierConfig } from "../config.js";
import { attrValue, baseNameNoExt } from "../parser/xml-helpers.js";
import type { XmlElement } from "../parser/xml.js";

export type FieldClass = "event" | "property" | "ambiguous";

export interface FieldClassificationInput {
  filePath: string;
  componentName: string;
  fieldId: string;
  fieldElement: XmlElement;
  config: BsprettierConfig;
  /** In-memory sources from the current formatting pass, when available. */
  projectSources?: ReadonlyMap<string, string>;
}

function normPath(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Resolve the component's linked script sources for usage analysis. Every
 * `.brs`/`.bs` file that lives in the **same directory** as the component XML is
 * treated as linked to it (see the plan: same-directory scripts are part of the
 * component, e.g. `LIVEPlayer.brs`, `LIVEPlayercallbacks.brs`,
 * `LIVEPlayertracking.brs`). Their combined text is scanned so a field set in
 * any one of them counts as written by the component.
 *
 * Prefers the in-memory project sources (CLI/project mode) and falls back to
 * reading sibling files from disk for single-file/stdin runs. Returns the
 * concatenated sources, or `null` when no linked script exists at all.
 */
function resolveLinkedBrs(
  filePath: string,
  componentName: string,
  projectSources?: ReadonlyMap<string, string>,
): string | null {
  void componentName;
  const dir = normPath(dirname(filePath));
  const parts: string[] = [];

  if (projectSources) {
    for (const [key, value] of projectSources) {
      const nk = normPath(key);
      if (!/\.(brs|bs)$/i.test(nk)) continue;
      if (normPath(dirname(nk)) === dir) parts.push(value);
    }
    if (parts.length > 0) return parts.join("\n");
  }

  try {
    const entries = readdirSync(dirname(filePath));
    for (const entry of entries) {
      if (!/\.(brs|bs)$/i.test(entry)) continue;
      try {
        parts.push(readFileSync(join(dirname(filePath), entry), "utf8"));
      } catch {
        // skip unreadable sibling
      }
    }
  } catch {
    // directory not readable (e.g. stdin with a synthetic path)
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

function configOverride(
  config: BsprettierConfig,
  filePath: string,
  fieldId: string,
): FieldClass | undefined {
  const overrides = config.xml.fieldClassificationOverrides;
  for (const [key, fields] of Object.entries(overrides)) {
    const norm = normPath(key);
    if (normPath(filePath).endsWith(norm)) {
      const v = fields[fieldId];
      if (v === "event" || v === "property") return v;
    }
  }
  return undefined;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Split a field id into its constituent words (camelCase + snake/kebab). */
function splitWords(fieldId: string): string[] {
  return fieldId
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Past-tense / progressive words that read as completed adjectival STATE rather
 * than an action. When one of these is the entire field name it is dual-natured
 * (e.g. `enabled`, `selected`) and the usage signal decides. As the last word of
 * a compound (`itemSelected`, `pageFocused`) it reads as an event instead.
 */
const STATE_PARTICIPLES = new Set([
  "enabled",
  "disabled",
  "selected",
  "focused",
  "unfocused",
  "expanded",
  "collapsed",
  "checked",
  "unchecked",
  "highlighted",
  "hidden",
  "pinned",
  "locked",
  "unlocked",
]);

/**
 * State participles that read as a configured-state PROPERTY even when the
 * component both reads and writes them. These are conventionally inbound state
 * the component is configured with (e.g. `enabled`, `selected`, `focused`), so
 * instead of going `ambiguous` on read+write they resolve to `property`. A
 * write-only use is still an outbound event.
 */
const PROPERTY_PARTICIPLES = new Set([
  "enabled",
  "disabled",
  "selected",
  "focused",
  "unfocused",
]);

/** Non-tensed words that classify as events despite lacking an -ed/-ing suffix. */
const EVENT_KEYWORDS = new Set(["complete", "ready", "done"]);

/** Words ending in -ed/-ing that are nouns, not verbs (so: not a tense signal). */
const NON_VERB_SUFFIX = new Set([
  // -ed nouns
  "speed",
  "feed",
  "seed",
  "need",
  "deed",
  "weed",
  "breed",
  "embed",
  "shed",
  "bed",
  "red",
  "bred",
  // -ing nouns
  "spacing",
  "padding",
  "string",
  "rating",
  "listing",
  "heading",
  "landing",
  "building",
  "meaning",
  "setting",
  "settings",
  "ceiling",
]);

/** True when a word carries a verb tense suffix (past `-ed` or progressive `-ing`). */
function hasTenseSuffix(word: string): boolean {
  if (NON_VERB_SUFFIX.has(word)) return false;
  if (EVENT_KEYWORDS.has(word)) return true;
  if (word.endsWith("ing") && word.length > 4) return true;
  if (word.endsWith("ed") && word.length > 3) return true;
  return false;
}

interface Usage {
  read: boolean;
  write: boolean;
}

/**
 * Classify how the component's own scripts use `m.top.<fieldId>`. A field the
 * component reads is inbound (consumed); one it writes (assigns) is outbound
 * (produced/notified).
 *
 * Write detection only counts an **assignment statement**: `m.top.field = ...`
 * (or a compound `+=` etc.) appearing at the **start of a statement** — i.e.
 * only whitespace precedes it on its line. BrightScript spells equality with a
 * single `=`, so `if(m.top.field = "x")` and `key: m.top.field` are comparisons
 * / reads, not writes; counting those as writes is what previously mislabelled
 * read-only fields (`playbackType`) and config fields as events.
 */
function classifyUsage(brs: string, fieldId: string): Usage {
  const id = escapeRegExp(fieldId);
  const usage: Usage = { read: false, write: false };

  const re = new RegExp(`m\\.top\\.${id}\\b`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(brs)) !== null) {
    // Only whitespace before the reference on its line → assignment statement.
    const lineStart = brs.lastIndexOf("\n", m.index - 1) + 1;
    const before = brs.slice(lineStart, m.index);
    const atStatementStart = /^[ \t]*$/.test(before);
    const rest = brs.slice(m.index + m[0].length).replace(/^[ \t]*/, "");

    if (atStatementStart && /^=(?!=)/.test(rest)) {
      usage.write = true;
    } else if (atStatementStart && /^[-+*/]=/.test(rest)) {
      usage.write = true;
      usage.read = true;
    } else {
      usage.read = true;
    }
  }

  // Observing one's own field consumes it → read/inbound.
  const observeRe = new RegExp(`observeField(?:Scoped)?\\s*\\(\\s*["']${id}["']`, "i");
  if (observeRe.test(brs)) usage.read = true;

  return usage;
}

/**
 * Classify a single `<field>` as an Event (outbound) or Property (inbound).
 *
 * Two conditions must BOTH hold for an event:
 *
 * 1. **Event-like name** — a tense suffix on the last word (`loaded`, `loading`,
 *    `itemSelected`) or an event keyword (`complete`/`ready`/`done`). Plain
 *    nouns (`services`, `referrer`, `playbackType`) and `is`/`has`/`can`/`should`
 *    booleans are never events.
 * 2. **Event-backed** — the field is actually produced: it is assigned in a
 *    linked script, OR it carries an `alias=` (its value is set by the child
 *    component the alias forwards). A tense-named field that is never written and
 *    not aliased (`queued`, `videoPlayerAttached`, `borderStyled`) is inbound
 *    state → Property.
 *
 * When no linked script exists at all, nothing is written, so every non-aliased
 * field is a Property. "ambiguous" is returned only on a genuine conflict — a
 * standalone state participle (e.g. `expanded`) that is both read and written —
 * which a `fieldClassificationOverrides` entry resolves.
 */
export function classifyField(input: FieldClassificationInput): FieldClass {
  const { config, filePath, componentName, fieldId, fieldElement, projectSources } =
    input;

  const override = configOverride(config, filePath, fieldId);
  if (override) return override;

  // Boolean-state naming is always an inbound property.
  if (/^(is|has|can|should)[A-Z0-9]/.test(fieldId)) return "property";

  const words = splitWords(fieldId);
  const lastWord = (words[words.length - 1] ?? "").toLowerCase();
  const standaloneParticiple =
    words.length === 1 && STATE_PARTICIPLES.has(lastWord);

  const brs = resolveLinkedBrs(filePath, componentName, projectSources);
  const usage = brs
    ? classifyUsage(brs, fieldId)
    : { read: false, write: false };

  // An event must be produced somewhere: written in a linked script, or backed
  // by an alias that forwards a child component's event.
  const hasAlias = !!attrValue(fieldElement, "alias");
  const eventBacked = usage.write || hasAlias;

  if (standaloneParticiple) {
    // A dual-natured participle (`expanded`, `selected`, …) is only an event
    // when produced. Read+write is a genuine conflict unless the participle
    // reads as configured inbound state (`enabled`, `selected`, `focused`).
    if (!eventBacked) return "property";
    if (usage.read && usage.write) {
      return PROPERTY_PARTICIPLES.has(lastWord) ? "property" : "ambiguous";
    }
    return "event";
  }

  // Clear action tense, but only an event when actually produced.
  if (hasTenseSuffix(lastWord)) {
    return eventBacked ? "event" : "property";
  }

  // No event-like name → inbound property, regardless of how it is used.
  return "property";
}
