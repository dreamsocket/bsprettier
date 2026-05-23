import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BsprettierConfig } from "../config.js";
import { baseNameNoExt } from "../parser/xml-helpers.js";
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
 * Resolve the component's local `.brs` source. Prefers the in-memory project
 * sources (CLI/project mode) and falls back to reading the sibling file from
 * disk for single-file/stdin runs.
 */
function resolveLocalBrs(
  filePath: string,
  componentName: string,
  projectSources?: ReadonlyMap<string, string>,
): string | null {
  const dir = dirname(filePath);
  const candidates = [
    componentName ? join(dir, `${componentName}.brs`) : "",
    join(dir, `${baseNameNoExt(filePath)}.brs`),
  ]
    .filter(Boolean)
    .map(normPath);

  if (projectSources) {
    for (const [key, value] of projectSources) {
      const nk = normPath(key);
      if (candidates.some((c) => nk === c || nk.endsWith(`/${c}`))) {
        return value;
      }
    }
  }

  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, "utf8");
    } catch {
      // try next
    }
  }
  return null;
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
 * Classify how the component's own script uses `m.top.<fieldId>`. A field the
 * component reads is inbound (consumed); one it only writes is outbound
 * (produced/notified).
 */
function classifyUsage(brs: string, fieldId: string): Usage {
  const id = escapeRegExp(fieldId);
  const usage: Usage = { read: false, write: false };

  const re = new RegExp(`m\\.top\\.${id}\\b`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(brs)) !== null) {
    const rest = brs.slice(m.index + m[0].length).replace(/^[ \t]*/, "");
    if (/^=(?!=)/.test(rest)) {
      usage.write = true;
    } else if (/^[-+*/]=/.test(rest)) {
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
 * The field name is the primary signal: a tense suffix (`loaded`, `loading`,
 * `loadStarted`) marks an event, while a plain noun and `is`/`has`/`can`/`should`
 * booleans mark a property. The component's own `m.top.<field>` usage refines
 * the rest: a field it reads is an inbound property; one it only writes is an
 * outbound event. "ambiguous" is returned only on a genuine conflict — a
 * standalone state participle (e.g. `selected`) that is both read and written —
 * which a `fieldClassificationOverrides` entry resolves.
 */
export function classifyField(input: FieldClassificationInput): FieldClass {
  const { config, filePath, componentName, fieldId, projectSources } = input;

  const override = configOverride(config, filePath, fieldId);
  if (override) return override;

  // Boolean-state naming is always an inbound property.
  if (/^(is|has|can|should)[A-Z0-9]/.test(fieldId)) return "property";

  const words = splitWords(fieldId);
  const lastWord = (words[words.length - 1] ?? "").toLowerCase();
  const standaloneParticiple =
    words.length === 1 && STATE_PARTICIPLES.has(lastWord);

  const brs = resolveLocalBrs(filePath, componentName, projectSources);
  const usage = brs
    ? classifyUsage(brs, fieldId)
    : { read: false, write: false };

  // Clear action tense (not a dual-natured state participle) → event.
  if (hasTenseSuffix(lastWord) && !standaloneParticiple) return "event";

  if (standaloneParticiple) {
    if (usage.read && usage.write) {
      // Property-preferring participles (e.g. `enabled`, `selected`, `focused`)
      // are configured inbound state, not a genuine conflict.
      return PROPERTY_PARTICIPLES.has(lastWord) ? "property" : "ambiguous";
    }
    if (usage.write) return "event";
    return "property";
  }

  // No tense signal: fall back to inbound/outbound usage.
  if (usage.read) return "property";
  if (usage.write) return "event";
  return "property";
}
