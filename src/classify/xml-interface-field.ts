import { readFileSync } from "node:fs";
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
}

/** Read the sibling local .brs source for a component xml, if present. */
function readLocalBrs(filePath: string, componentName: string): string | null {
  const dir = dirname(filePath);
  const candidates = [
    componentName ? join(dir, `${componentName}.brs`) : "",
    join(dir, `${baseNameNoExt(filePath)}.brs`),
  ].filter(Boolean);
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
    const norm = key.replace(/\\/g, "/");
    if (filePath.replace(/\\/g, "/").endsWith(norm)) {
      const v = fields[fieldId];
      if (v === "event" || v === "property") return v;
    }
  }
  return undefined;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Classify a single `<field>` as an Event (outbound) or Property (inbound)
 * field using conservative single-component heuristics. Returns "ambiguous"
 * when signals conflict and no config override resolves it.
 */
export function classifyField(input: FieldClassificationInput): FieldClass {
  const { config, filePath, componentName, fieldId, fieldElement } = input;

  const override = configOverride(config, filePath, fieldId);
  if (override) return override;

  const brs = readLocalBrs(filePath, componentName);
  const id = escapeRegExp(fieldId);

  let eventSignal = false;
  let propertySignal = false;

  if (brs) {
    // Outbound write: `m.top.<fieldId> = ...` → Event.
    const writeRe = new RegExp(`m\\.top\\.${id}\\s*=`, "i");
    if (writeRe.test(brs)) eventSignal = true;

    // `observeFieldScoped("<fieldId>", ...)` → Property.
    const observeRe = new RegExp(
      `observeFieldScoped\\s*\\(\\s*["']${id}["']`,
      "i",
    );
    if (observeRe.test(brs)) propertySignal = true;

    // Any read of `m.top.<fieldId>` not part of an assignment → Property.
    const readRe = new RegExp(`m\\.top\\.${id}\\b(?!\\s*=)`, "i");
    if (readRe.test(brs)) propertySignal = true;
  }

  // `alias=` to a notify-style child field is a weak Event signal.
  if (attrValue(fieldElement, "alias")) {
    if (!propertySignal) eventSignal = true;
  }

  if (eventSignal && propertySignal) return "ambiguous";
  if (eventSignal) return "event";
  // Default inbound classification: Property.
  return "property";
}
