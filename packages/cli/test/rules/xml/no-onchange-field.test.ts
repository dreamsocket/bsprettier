import { describe, expect, it } from "vitest";
import { config, formatSource } from "../../helpers/format.js";
import { xml } from "../../helpers/source.js";

describe("xml/no-onchange-field", () => {
  it("diagnoses XML onChange handlers so they can move to code observers", () => {
    const src = xml`
      <component name="W" extends="Group">
        <interface>
          <field id="focusedChild" type="node" onChange="_focusNav" />
        </interface>
      </component>
    `;
    const result = formatSource({
      filePath: "W.xml",
      source: src,
      config,
      onlyRules: new Set(["xml/no-onchange-field"]),
    });
    expect(result.changed).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.message).toContain(
      'field id="focusedChild"',
    );
    expect(result.diagnostics[0]!.message).toContain(
      'm.top.observeFieldScoped("focusedChild", "_setFocusedChild")',
    );
    expect(result.diagnostics[0]!.message).not.toContain("_focusNav");
  });
});
