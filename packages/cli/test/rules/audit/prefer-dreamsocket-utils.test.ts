import { describe, expect, it } from "vitest";
import { config, formatSource } from "../../helpers/format.js";
import { brs } from "../../helpers/source.js";

describe("audit/prefer-dreamsocket-utils", () => {
  it("reports builtin calls when the Dreamsocket utility audit rule is enabled", () => {
    const src = brs`
      sub init()
          upper = UCase("title")
          kind = Type(m.top)
      end sub
    `;
    const auditConfig = {
      ...config,
      rules: {
        ...config.rules,
        "audit/prefer-dreamsocket-utils": "warn" as const,
      },
    };
    const result = formatSource({
      filePath: "Utils.brs",
      source: src,
      config: auditConfig,
      onlyRules: new Set(["audit/prefer-dreamsocket-utils"]),
    });

    expect(result.diagnostics.map((d) => d.message).join("\n")).toContain(
      "StringUtil_*",
    );
    expect(result.diagnostics.map((d) => d.message).join("\n")).toContain(
      "TypeUtil_*",
    );
  });
});
