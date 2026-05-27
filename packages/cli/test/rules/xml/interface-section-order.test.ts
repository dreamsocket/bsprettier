import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../../src/config.js";
import { config, formatSource } from "../../helpers/format.js";
import { brs as brsSource, xml as xmlSource } from "../../helpers/source.js";

describe("xml/interface-section-order", () => {
  it("does not reorder interface members when comments sit between them", () => {
    const src = xmlSource`
      <component name="W" extends="Group">
        <interface>
          <!-- z field --><field id="z" type="string" />
          <!-- a field --><field id="a" type="string" />
        </interface>
      </component>
    `;
    const result = formatSource({ filePath: "W.xml", source: src, config });
    expect(result.changed).toBe(false);
    expect(
      result.diagnostics.some((d) => d.ruleId === "xml/interface-section-order"),
    ).toBe(true);
  });

  it("reorders interface members and carries an own-line leading comment", () => {
    const src = xmlSource`
      <component name="W" extends="Group">
        <interface>
          <!-- z field -->
          <field id="z" type="string" />
          <field id="a" type="string" />
        </interface>
      </component>
    `;
    const result = formatSource({ filePath: "W.xml", source: src, config });
    expect(result.changed).toBe(true);
    expect(
      result.diagnostics.some((d) => d.ruleId === "xml/interface-section-order"),
    ).toBe(false);
    // a sorts first; the "z field" comment travels with field z.
    const a = result.output.indexOf('id="a"');
    const comment = result.output.indexOf("<!-- z field -->");
    const z = result.output.indexOf('id="z"');
    expect(a).toBeLessThan(comment);
    expect(comment).toBeLessThan(z);
  });

  it("sorts within a labelled section and keeps the section header anchored", () => {
    const src = xmlSource`
      <component name="W" extends="Group">
        <interface>
          <!-- PROPERTIES -->
          <field id="z" type="string" />
          <field id="a" type="string" />
        </interface>
      </component>
    `;
    const result = formatSource({ filePath: "W.xml", source: src, config });
    expect(result.changed).toBe(true);
    expect(
      result.diagnostics.some((d) => d.ruleId === "xml/interface-section-order"),
    ).toBe(false);
    // The PROPERTIES header stays first; fields sort a, z under it.
    const header = result.output.indexOf("<!-- PROPERTIES -->");
    const a = result.output.indexOf('id="a"');
    const z = result.output.indexOf('id="z"');
    expect(header).toBeLessThan(a);
    expect(a).toBeLessThan(z);
  });

  it("respects author sub-groupings under separate section headers", () => {
    // getters and functions are both Functions; each stays its own sorted block.
    const src = xmlSource`
      <component name="W" extends="Group">
        <interface>
          <!-- getters -->
          <function name="getB" />
          <function name="getA" />
          <!-- functions -->
          <function name="doB" />
          <function name="doA" />
        </interface>
      </component>
    `;
    const result = formatSource({ filePath: "W.xml", source: src, config });
    expect(result.changed).toBe(true);
    const getters = result.output.indexOf("<!-- getters -->");
    const getA = result.output.indexOf('name="getA"');
    const getB = result.output.indexOf('name="getB"');
    const functions = result.output.indexOf("<!-- functions -->");
    const doA = result.output.indexOf('name="doA"');
    const doB = result.output.indexOf('name="doB"');
    // Each block sorts internally; getters block stays before functions block.
    expect(getters).toBeLessThan(getA);
    expect(getA).toBeLessThan(getB);
    expect(getB).toBeLessThan(functions);
    expect(functions).toBeLessThan(doA);
    expect(doA).toBeLessThan(doB);
  });

  it("sorts within an author-labelled section even when classification disagrees", () => {
    // `loaded` classifies as an event, but the author grouped it under
    // PROPERTIES. We trust the grouping: both <field>s stay in the one run and
    // sort alphabetically under the anchored header — no cross-section move and
    // no refusal.
    const src = xmlSource`
      <component name="W" extends="Group">
        <interface>
          <!-- PROPERTIES -->
          <field id="loaded" type="boolean" />
          <field id="config" type="assocarray" />
        </interface>
      </component>
    `;
    const result = formatSource({ filePath: "W.xml", source: src, config });
    expect(result.changed).toBe(true);
    expect(
      result.diagnostics.some((d) => d.ruleId === "xml/interface-section-order"),
    ).toBe(false);
    // Header stays first; fields sort config, loaded under it.
    const header = result.output.indexOf("<!-- PROPERTIES -->");
    const cfg = result.output.indexOf('id="config"');
    const loaded = result.output.indexOf('id="loaded"');
    expect(header).toBeLessThan(cfg);
    expect(cfg).toBeLessThan(loaded);
  });

  it("uses configured XML field classification overrides", () => {
    const baseConfig = defaultConfig();
    const overrideConfig = {
      ...baseConfig,
      xml: {
        ...baseConfig.xml,
        fieldClassificationOverrides: {
          "components/Foo.xml": {
            dismissed: "property" as const,
          },
        },
      },
    };
    const src = xmlSource`
      <component name="Foo" extends="Group">
        <interface>
          <field id="title" type="string" />
          <field id="dismissed" type="boolean" />
        </interface>
      </component>
    `;

    const result = formatSource({
      filePath: "components/Foo.xml",
      source: src,
      config: overrideConfig,
      onlyRules: new Set(["xml/interface-section-order"]),
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.output.indexOf('id="dismissed"')).toBeLessThan(
      result.output.indexOf('id="title"'),
    );
  });

  it("classifies tensed names as events and nouns as properties", () => {
    const xmlPath = "Timer.xml";
    const brsPath = "Timer.brs";
    const xml = xmlSource`
      <component name="Timer" extends="Group">
        <interface>
          <field id="expiration" type="int" />
          <field id="updated" type="int" />
          <field id="ended" type="boolean" />
        </interface>
      </component>
    `;
    const brs = brsSource`
      sub init()
          m.top.ended = false
          m.top.updated = 0
      end sub
    `;
    const result = formatSource({
      filePath: xmlPath,
      source: xml,
      config,
      projectSources: new Map([
        [xmlPath, xml],
        [brsPath, brs],
      ]),
      onlyRules: new Set(["xml/interface-section-order"]),
    });
    expect(result.diagnostics).toEqual([]);
    // Events (ended, updated) sort before the property (expiration).
    const order = ["ended", "updated", "expiration"].map((id) =>
      result.output.indexOf(`id="${id}"`),
    );
    expect(order[0]).toBeLessThan(order[1]!);
    expect(order[1]).toBeLessThan(order[2]!);
  });

  it("treats a compound participle as an event but a leading modifier as a property", () => {
    const xmlPath = "Nav.xml";
    const brsPath = "Nav.brs";
    const xml = xmlSource`
      <component name="Nav" extends="Group">
        <interface>
          <field id="selectedItem" type="node" />
          <field id="itemSelected" type="node" />
        </interface>
      </component>
    `;
    const result = formatSource({
      filePath: xmlPath,
      source: xml,
      config,
      projectSources: new Map([
        [xmlPath, xml],
        [
          brsPath,
          brsSource`
            sub init()
            end sub
          `,
        ],
      ]),
      onlyRules: new Set(["xml/interface-section-order"]),
    });
    expect(result.diagnostics).toEqual([]);
    // itemSelected (event) sorts before selectedItem (property).
    expect(result.output.indexOf('id="itemSelected"')).toBeLessThan(
      result.output.indexOf('id="selectedItem"'),
    );
  });

  it("flags a standalone state participle that is both read and written", () => {
    const xmlPath = "Item.xml";
    const brsPath = "Item.brs";
    const xml = xmlSource`
      <component name="Item" extends="Group">
        <interface>
          <field id="expanded" type="boolean" />
          <field id="label" type="string" />
        </interface>
      </component>
    `;
    const brs = brsSource`
      sub _onTap()
          if (not m.top.expanded)
              m.top.expanded = true
          end if
      end sub
    `;
    const result = formatSource({
      filePath: xmlPath,
      source: xml,
      config,
      projectSources: new Map([
        [xmlPath, xml],
        [brsPath, brs],
      ]),
      onlyRules: new Set(["xml/interface-section-order"]),
    });
    expect(result.changed).toBe(false);
    expect(
      result.diagnostics.some((d) =>
        d.message.includes("Ambiguous Event/Property"),
      ),
    ).toBe(true);
  });

  it("resolves property-preferring participles to property even when read and written", () => {
    const xmlPath = "Item.xml";
    const brsPath = "Item.brs";
    const xml = xmlSource`
      <component name="Item" extends="Group">
        <interface>
          <field id="selected" type="boolean" />
          <field id="focused" type="boolean" />
          <field id="label" type="string" />
        </interface>
      </component>
    `;
    const brs = brsSource`
      sub _onTap()
          if (not m.top.selected)
              m.top.selected = true
          end if
          if (not m.top.focused)
              m.top.focused = true
          end if
      end sub
    `;
    const result = formatSource({
      filePath: xmlPath,
      source: xml,
      config,
      projectSources: new Map([
        [xmlPath, xml],
        [brsPath, brs],
      ]),
      onlyRules: new Set(["xml/interface-section-order"]),
    });
    // selected/focused classify as properties (not ambiguous), so the all-property
    // interface is already ordered and reordering proceeds without a diagnostic.
    expect(
      result.diagnostics.some((d) =>
        d.message.includes("Ambiguous Event/Property"),
      ),
    ).toBe(false);
  });

  it("treats a write-only non-tensed field as a property (events require a tense name)", () => {
    const xmlPath = "Svc.xml";
    const brsPath = "Svc.brs";
    const xml = xmlSource`
      <component name="Svc" extends="Group">
        <interface>
          <field id="error" type="string" />
          <field id="config" type="node" />
        </interface>
      </component>
    `;
    const brs = brsSource`
      sub init()
          cfg = m.top.config
          m.top.error = "boom"
      end sub
    `;
    const result = formatSource({
      filePath: xmlPath,
      source: xml,
      config,
      projectSources: new Map([
        [xmlPath, xml],
        [brsPath, brs],
      ]),
      onlyRules: new Set(["xml/interface-section-order"]),
    });
    expect(result.diagnostics).toEqual([]);
    // Neither field has a tense name, so both are properties (an event must be
    // tense-named AND produced). They sort alphabetically: config before error.
    expect(result.output.indexOf('id="config"')).toBeLessThan(
      result.output.indexOf('id="error"'),
    );
  });
});
