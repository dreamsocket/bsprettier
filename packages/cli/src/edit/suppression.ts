import { LineIndex } from "../util/line-index.js";

export interface SuppressionMap {
  /** Whole file is disabled. */
  fileDisabled: boolean;
  /** Map of 0-based line number → set of suppressed rule ids, or "all". */
  lines: Map<number, Set<string> | "all">;
  lineIndex: LineIndex;
}

const BRS_DISABLE = /'\s*bsprettier-disable\b/;
const BRS_DISABLE_NEXT = /'\s*bsprettier-disable-next-line\b([^\n]*)/;
const XML_DISABLE = /<!--\s*bsprettier-disable\s*-->/;
const XML_DISABLE_NEXT = /<!--\s*bsprettier-disable-next-line\b([^]*?)-->/;

function parseRuleList(rest: string): Set<string> | "all" {
  const ids = rest
    .replace(/-->/g, "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== "bsprettier-disable-next-line");
  return ids.length > 0 ? new Set(ids) : "all";
}

export function buildSuppressionMap(
  source: string,
  lang: "brs" | "xml",
): SuppressionMap {
  const lineIndex = new LineIndex(source);
  const lines = new Map<number, Set<string> | "all">();

  // Fast path: the overwhelming majority of files contain no suppression
  // marker at all. Checking the bare substring before doing any line-splitting
  // or regex work avoids a per-file allocation/regex pass that, with reparses,
  // ran several times per file in the multi-phase pipeline.
  if (source.indexOf("bsprettier-") < 0) {
    return { fileDisabled: false, lines, lineIndex };
  }

  const rawLines = source.split(/\r?\n/);

  // Whole-file disable: must be the first non-blank line.
  let fileDisabled = false;
  for (const line of rawLines) {
    if (line.trim().length === 0) continue;
    if (lang === "brs") {
      fileDisabled =
        BRS_DISABLE.test(line) && !BRS_DISABLE_NEXT.test(line);
    } else {
      fileDisabled =
        XML_DISABLE.test(line) && !XML_DISABLE_NEXT.test(line);
    }
    break;
  }

  const nextRe = lang === "brs" ? BRS_DISABLE_NEXT : XML_DISABLE_NEXT;
  for (let i = 0; i < rawLines.length; i++) {
    const m = nextRe.exec(rawLines[i]!);
    if (m) {
      lines.set(i + 1, parseRuleList(m[1] ?? ""));
    }
  }

  return { fileDisabled, lines, lineIndex };
}

export function isSuppressed(
  map: SuppressionMap,
  offset: number,
  ruleId: string,
): boolean {
  if (map.fileDisabled) return true;
  const line = map.lineIndex.offsetToPosition(offset).line;
  const entry = map.lines.get(line);
  if (!entry) return false;
  return entry === "all" || entry.has(ruleId);
}
