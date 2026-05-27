import { describe, expect, it } from "vitest";
import { config, formatSource } from "../../helpers/format.js";
import { brs } from "../../helpers/source.js";

describe("audit/hardcoded-string", () => {
  it("reports direct user-facing string assignments when the audit rule is enabled", () => {
    const src = brs`
      sub init()
          m._uiTitle.text = "Play"
      end sub
    `;
    const auditConfig = {
      ...config,
      rules: { ...config.rules, "audit/hardcoded-string": "warn" as const },
    };
    const result = formatSource({
      filePath: "Strings.brs",
      source: src,
      config: auditConfig,
      onlyRules: new Set(["audit/hardcoded-string"]),
    });

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.message).toContain("ResourceUtil_getString");
  });
});
