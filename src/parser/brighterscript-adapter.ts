/**
 * Single import site for BrighterScript v1. bsprettier uses BSC only as a
 * lexer/parser library — never the Program/scope/validation pipeline, and never
 * AstEditor (which is transpile-scoped).
 */
import { Lexer } from "brighterscript/dist/lexer/Lexer.js";
import { Parser, ParseMode } from "brighterscript/dist/parser/Parser.js";
import { LineIndex } from "../util/line-index.js";
import { parseMetrics } from "./metrics.js";
import type { Span } from "../edit/types.js";

export interface BscToken {
  kind: string;
  text: string;
  location?: { range: BscRange };
  leadingTrivia?: BscToken[];
}

interface BscRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export interface BscDiagnostic {
  message: string;
  severity: number;
  code?: string | number;
}

/** A top-level `sub`/`function` declaration with computed source spans. */
export interface BrsRoutine {
  name: string;
  isSub: boolean;
  /** The routine name token span. */
  nameSpan: Span;
  /** The `sub`/`function` keyword token span. */
  keywordSpan: Span;
  /** keyword start .. `end sub`/`end function` end (no surrounding trivia). */
  declSpan: Span;
  /**
   * Full movable block: contiguous banner-comment lines (if any) through the
   * end of the `end sub` line, including a trailing same-line comment.
   */
  fullSpan: Span;
  /** Contiguous banner comment span immediately above the keyword, or null. */
  bannerSpan: Span | null;
  /** Raw BSC FunctionStatement node. */
  node: any;
}

export interface BrsParseResult {
  source: string;
  lineIndex: LineIndex;
  ast: any;
  /** True if a fatal (error-severity) parser diagnostic was produced. */
  fatal: boolean;
  diagnostics: BscDiagnostic[];
  topLevelFunctions: BrsRoutine[];
}

function rangeToSpan(li: LineIndex, range: BscRange): Span {
  return li.rangeToSpan(range);
}

/**
 * Compute the banner span: contiguous comment lines immediately above the
 * keyword, with no blank line separating them from it.
 */
function computeBanner(
  li: LineIndex,
  source: string,
  keyword: BscToken,
): Span | null {
  const trivia = keyword.leadingTrivia ?? [];
  if (trivia.length === 0) return null;
  // Walk backward from the end, skipping trailing whitespace.
  let i = trivia.length - 1;
  while (i >= 0 && trivia[i]!.kind === "Whitespace") i--;
  // Collect a trailing run of (Comment, Newline) pairs. A Newline directly
  // followed by another Newline (blank line) terminates the banner.
  let firstCommentIdx = -1;
  while (i >= 0) {
    const t = trivia[i]!;
    if (t.kind === "Newline") {
      // A newline is fine as a separator after a comment; keep scanning.
      i--;
      continue;
    }
    if (t.kind === "Comment") {
      firstCommentIdx = i;
      // Look at what precedes this comment.
      let j = i - 1;
      while (j >= 0 && trivia[j]!.kind === "Whitespace") j--;
      if (j < 0) {
        i = j;
        break;
      }
      if (trivia[j]!.kind === "Newline") {
        // Is there a blank line above (two consecutive newlines)?
        let k = j - 1;
        while (k >= 0 && trivia[k]!.kind === "Whitespace") k--;
        if (k >= 0 && trivia[k]!.kind === "Newline") {
          // blank line — banner stops here
          break;
        }
        i = j;
        continue;
      }
      // Non-newline, non-whitespace before comment — stop.
      break;
    }
    break;
  }
  if (firstCommentIdx < 0) return null;
  const firstComment = trivia[firstCommentIdx]!;
  if (!firstComment.location) return null;
  const start = li.positionToOffset(firstComment.location.range.start);
  // Banner ends at the start of the keyword's line (include the newline + indent).
  const kwOffset = keyword.location
    ? li.positionToOffset(keyword.location.range.start)
    : start;
  return { offset: start, length: Math.max(0, kwOffset - start) };
}

/** Extend an offset to the end of its line (excludes the line terminator). */
function endOfLine(source: string, offset: number): number {
  let i = offset;
  while (i < source.length && source[i] !== "\n" && source[i] !== "\r") i++;
  return i;
}

export function parseBrs(
  source: string,
  filePath: string,
): BrsParseResult {
  if (!parseMetrics.enabled) return parseBrsImpl(source, filePath);
  const t0 = performance.now();
  const result = parseBrsImpl(source, filePath);
  parseMetrics.brsCount++;
  parseMetrics.brsMs += performance.now() - t0;
  return result;
}

function parseBrsImpl(
  source: string,
  filePath: string,
): BrsParseResult {
  const lineIndex = new LineIndex(source);
  const lexResult = Lexer.scan(source);
  const isBrighterScript = /\.bs$/i.test(filePath);
  const parseResult = Parser.parse(lexResult.tokens, {
    mode: isBrighterScript ? ParseMode.BrighterScript : ParseMode.BrightScript,
  });

  const diagnostics: BscDiagnostic[] = [
    ...lexResult.diagnostics,
    ...parseResult.diagnostics,
  ].map((d: any) => ({
    message: d.message,
    severity: d.severity,
    code: d.code ?? d.legacyCode,
  }));
  const fatal = diagnostics.some((d) => d.severity === 1);

  const ast: any = parseResult.ast;
  const topLevelFunctions: BrsRoutine[] = [];
  for (const stmt of (ast.statements ?? []) as any[]) {
    if (stmt.kind !== "FunctionStatement") continue;
    const nameToken: BscToken | undefined = stmt.tokens?.name;
    const keyword: BscToken | undefined = stmt.func?.tokens?.functionType;
    const endKeyword: BscToken | undefined = stmt.func?.tokens?.endFunctionType;
    if (!nameToken || !keyword?.location) continue;
    const name = nameToken.text;
    const isSub = keyword.kind === "Sub";
    const keywordSpan = rangeToSpan(lineIndex, keyword.location.range);
    const nameSpan = nameToken.location
      ? rangeToSpan(lineIndex, nameToken.location.range)
      : { offset: keywordSpan.offset, length: 0 };
    const declStart = keywordSpan.offset;
    const declEndOffset = endKeyword?.location
      ? lineIndex.positionToOffset(endKeyword.location.range.end)
      : lineIndex.positionToOffset(stmt.location.range.end);
    // Extend to end of the `end sub` line to capture a trailing comment.
    const declLineEnd = endOfLine(source, declEndOffset);
    const declSpan: Span = {
      offset: declStart,
      length: declLineEnd - declStart,
    };
    const bannerSpan = computeBanner(lineIndex, source, keyword);
    const fullStart = bannerSpan ? bannerSpan.offset : declStart;
    const fullSpan: Span = {
      offset: fullStart,
      length: declLineEnd - fullStart,
    };
    topLevelFunctions.push({
      name,
      isSub,
      nameSpan,
      keywordSpan,
      declSpan,
      fullSpan,
      bannerSpan,
      node: stmt,
    });
  }

  return {
    source,
    lineIndex,
    ast,
    fatal,
    diagnostics,
    topLevelFunctions,
  };
}
