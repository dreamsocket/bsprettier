import { describe, expect, it } from "vitest";
import { config, formatSource } from "../../../helpers/format.js";
import { brs as brsSource, xml as xmlSource } from "../../../helpers/source.js";

describe("audit/private-member-naming: call-site rewrites", () => {
  it("renames indexed m function exports when component routines become private", () => {
    const xmlPath = "components/BFFDecoder.xml";
    const brsPath = "components/BFFDecoder.brs";
    const xml = xmlSource`
      <component name="BFFDecoder" extends="Group">
        <script type="text/brightscript" uri="BFFDecoder.brs" />
        <interface>
          <function name="convertObject" />
        </interface>
      </component>
    `;
    const brs = brsSource`
      sub init()
          m["createComponent"] = createComponent
      end sub

      function convertObject(value as Object) as Dynamic
          return value
      end function

      function createComponent(value as Object) as Object
          return value
      end function
    `;
    const result = formatSource({
      filePath: brsPath,
      source: brs,
      config,
      projectSources: new Map([
        [xmlPath, xml],
        [brsPath, brs],
      ]),
      onlyRules: new Set(["audit/private-member-naming"]),
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.output).toContain(
      '    m["createComponent"] = _createComponent',
    );
    expect(result.output).toContain("function _createComponent(");

    const partial = brsSource`
      sub init()
          m["createComponent"] = createComponent
      end sub

      function convertObject(value as Object) as Dynamic
          return value
      end function

      function _createComponent(value as Object) as Object
          return value
      end function
    `;
    const repaired = formatSource({
      filePath: brsPath,
      source: partial,
      config,
      projectSources: new Map([
        [xmlPath, xml],
        [brsPath, partial],
      ]),
      onlyRules: new Set(["audit/private-member-naming"]),
    });

    expect(repaired.diagnostics).toEqual([]);
    expect(repaired.output).toContain(
      '    m["createComponent"] = _createComponent',
    );
    expect(repaired.output).toContain("function _createComponent(");
  });

  it("rewrites call sites in a sibling scope script when a routine is privatized", () => {
    const xmlPath = "components/player/LivePlayer.xml";
    const playerBrsPath = "components/player/LivePlayer.brs";
    const trackingBrsPath = "components/player/LivePlayertracking.brs";
    const xml = xmlSource`
      <component name="LivePlayer" extends="Group">
        <script type="text/brightscript" uri="LivePlayer.brs" />
        <script type="text/brightscript" uri="LivePlayertracking.brs" />
        <interface>
          <function name="show" />
        </interface>
      </component>
    `;
    // trackPageLoad is declared in the tracking script (it will be privatized
    // when that file is formatted) but called from LivePlayer.brs.
    const trackingBrs = brsSource`
      sub trackPageLoad()
      end sub
    `;
    const playerBrs = brsSource`
      sub show()
          trackPageLoad()
      end sub
    `;
    const projectSources = new Map([
      [xmlPath, xml],
      [playerBrsPath, playerBrs],
      [trackingBrsPath, trackingBrs],
    ]);

    // Formatting LivePlayer.brs: its own routines are all public/interface, so it
    // gains no rename diagnostics, but the call to the now-private sibling
    // routine must be rewritten.
    const player = formatSource({
      filePath: playerBrsPath,
      source: playerBrs,
      config,
      projectSources,
      onlyRules: new Set(["audit/private-member-naming"]),
    });
    expect(player.output).toContain("    _trackPageLoad()");
    expect(player.output).toContain("sub show()");

    // Formatting the tracking script: the declaration itself is privatized.
    const tracking = formatSource({
      filePath: trackingBrsPath,
      source: trackingBrs,
      config,
      projectSources,
      onlyRules: new Set(["audit/private-member-naming"]),
    });
    expect(tracking.output).toContain("sub _trackPageLoad()");
  });
});
