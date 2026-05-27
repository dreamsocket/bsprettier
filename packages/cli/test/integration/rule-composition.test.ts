import { describe, expect, it } from "vitest";
import { config, formatSource } from "../helpers/format.js";
import { brs as brsSource, xml as xmlSource } from "../helpers/source.js";

describe("rule composition", () => {
  it("renames parameters in conditions after inline if conversion", () => {
    const src = brsSource`
      function pick(item as object) as object
          if item <> invalid then return item
          return invalid
      end function
    `;
    const result = formatSource({
      filePath: "ParamInlineIf.brs",
      source: src,
      config,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.output).toContain(
      "    if(p_item <> invalid)\n        return p_item\n    end if",
    );
  });

  it("does not surface private member diagnostics when a later _ui rewrite handles the member", () => {
    const xmlPath = "components/Player.xml";
    const brsPath = "components/Player.brs";
    const xml = xmlSource`
      <component name="Player" extends="Group">
        <script type="text/brightscript" uri="Player.brs" />
      </component>
    `;
    const brs = brsSource`
      sub init()
          m._SFVodOlyEndLabel = m.top.findNode("SFVodOlyEndLabel")
          m._SFVodOlyEndLabel.labelText = "Done"
      end sub
    `;
    const result = formatSource({
      filePath: brsPath,
      source: brs,
      config,
      projectSources: new Map([
        [xmlPath, xml],
        [brsPath, brs],
      ]),
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.output).toContain(
      '    m._uiSfVodOlyEndLabel = m.top.findNode("SFVodOlyEndLabel")',
    );
    expect(result.output).toContain(
      '    m._uiSfVodOlyEndLabel.labelText = "Done"',
    );
  });
});
