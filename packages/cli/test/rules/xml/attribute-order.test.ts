import { describe, expect, it } from "vitest";
import { config, formatSource } from "../../helpers/format.js";
import { xml } from "../../helpers/source.js";

describe("xml/attribute-order", () => {
  it("sorts attributes ascii-ascending when no name is pinned", () => {
    const src = xml`
      <component name="W" extends="Group">
        <interface>
          <field type="node" id="focus" alias="other" />
        </interface>
      </component>
    `;
    const result = formatSource({
      filePath: "W.xml",
      source: src,
      config,
      onlyRules: new Set(["xml/attribute-order"]),
    });

    expect(result.changed).toBe(true);
    // `id` is pinned first on <field>; the rest sort ascii-ascending.
    expect(result.output).toContain(
      '<field id="focus" alias="other" type="node" />',
    );
  });

  it("pins `name` first on <component> regardless of source order", () => {
    const src = xml`
      <component extends="Group" name="W">
      </component>
    `;
    const result = formatSource({
      filePath: "W.xml",
      source: src,
      config,
      onlyRules: new Set(["xml/attribute-order"]),
    });

    expect(result.changed).toBe(true);
    expect(result.output).toContain('<component name="W" extends="Group">');
  });

  it("pins `name` first on <function>", () => {
    const src = xml`
      <component name="W" extends="Group">
        <interface>
          <function alias="x" name="show" />
        </interface>
      </component>
    `;
    const result = formatSource({
      filePath: "W.xml",
      source: src,
      config,
      onlyRules: new Set(["xml/attribute-order"]),
    });

    expect(result.changed).toBe(true);
    expect(result.output).toContain('<function name="show" alias="x" />');
  });

  it("leaves already-ordered attributes untouched", () => {
    const src = xml`
      <component name="W" extends="Group">
        <interface>
          <field id="focus" alias="other" type="node" />
        </interface>
      </component>
    `;
    const result = formatSource({
      filePath: "W.xml",
      source: src,
      config,
      onlyRules: new Set(["xml/attribute-order"]),
    });

    expect(result.changed).toBe(false);
  });

  it("does not touch elements with a single attribute", () => {
    const src = xml`
      <component name="W" extends="Group">
        <script uri="Widget.brs" />
      </component>
    `;
    const result = formatSource({
      filePath: "W.xml",
      source: src,
      config,
      onlyRules: new Set(["xml/attribute-order"]),
    });

    expect(result.changed).toBe(false);
  });
});
