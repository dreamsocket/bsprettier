import { cosmiconfigSync } from "cosmiconfig";
import type { FormattingOptions } from "brighterscript-formatter";
import type { Severity } from "./edit/types.js";

export type RuleSetting = Severity | "off";

export interface BsprettierConfig {
  include: string[];
  ignore: string[];
  rules: Record<string, RuleSetting>;
  brs: {
    blankLinesBetweenRoutines: number;
  };
  xml: {
    interfaceSectionComments: "preserve";
    fieldClassificationOverrides: Record<
      string,
      Record<string, "event" | "property">
    >;
  };
  formatter?: FormattingOptions | null;
}

export const DEFAULT_IGNORE = [
  "**/roku_modules/**",
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
];

const DEFAULT_RULES: Record<string, RuleSetting> = {
  "brs/declaration-order": "error",
  "brs/declaration-spacing": "error",
  "brs/block-if-form": "error",
  "brs/if-condition-parens": "error",
  "xml/attribute-order": "error",
  "xml/script-order": "error",
  "xml/interface-section-order": "error",
  "xml/no-onchange-field": "warn",
  "audit/handler-intent": "warn",
  "audit/ui-node-prefix": "warn",
  "audit/private-member-naming": "warn",
  "audit/prefer-dreamsocket-utils": "off",
  "audit/hardcoded-string": "off",
};

export function defaultConfig(): BsprettierConfig {
  return {
    include: ["**/*.{brs,bs,xml}"],
    ignore: [...DEFAULT_IGNORE],
    rules: { ...DEFAULT_RULES },
    brs: { blankLinesBetweenRoutines: 3 },
    xml: {
      interfaceSectionComments: "preserve",
      fieldClassificationOverrides: {},
    },
    formatter: {
      indentStyle: "spaces",
      indentSpaceCount: 4,
      formatIndent: true,
      keywordCase: "lower",
      typeCase: "title",
      compositeKeywords: "split",
      removeTrailingWhiteSpace: true,
      formatInteriorWhitespace: true,
      insertSpaceBeforeFunctionParenthesis: false,
      insertSpaceBetweenEmptyCurlyBraces: false,
      insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces: true,
      insertSpaceBetweenAssociativeArrayLiteralKeyAndColon: false,
      formatSingleLineCommentType: "singlequote",
      formatMultiLineObjectsAndArrays: true,
    },
  };
}

function mergeConfig(
  base: BsprettierConfig,
  loaded: Partial<BsprettierConfig> | null | undefined,
): BsprettierConfig {
  if (!loaded) return base;
  return {
    include: loaded.include ?? base.include,
    ignore: loaded.ignore ?? base.ignore,
    rules: { ...base.rules, ...(loaded.rules ?? {}) },
    brs: { ...base.brs, ...(loaded.brs ?? {}) },
    xml: {
      interfaceSectionComments: "preserve",
      fieldClassificationOverrides:
        loaded.xml?.fieldClassificationOverrides ??
        base.xml.fieldClassificationOverrides,
    },
    formatter: loaded.formatter === null
      ? null
      : loaded.formatter !== undefined
        ? { ...base.formatter, ...loaded.formatter }
        : base.formatter,
  };
}

export interface LoadConfigOptions {
  /** Explicit config file path (--config). */
  configPath?: string;
  /** Directory to start cosmiconfig search from. */
  searchFrom?: string;
}

export function loadConfig(opts: LoadConfigOptions = {}): BsprettierConfig {
  const explorer = cosmiconfigSync("bsprettier", {
    searchPlaces: [
      "package.json",
      "bsprettier.config.json",
      ".bsprettierrc.json",
      ".bsprettierrc",
    ],
  });
  const base = defaultConfig();
  const result = opts.configPath
    ? explorer.load(opts.configPath)
    : explorer.search(opts.searchFrom);
  return mergeConfig(base, result?.config as Partial<BsprettierConfig>);
}

export function ruleSetting(
  config: BsprettierConfig,
  ruleId: string,
): RuleSetting {
  return config.rules[ruleId] ?? "off";
}
