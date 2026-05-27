import { describe, expect, it } from "vitest";
import { config, formatSource } from "../../helpers/format.js";
import { brs } from "../../helpers/source.js";

describe("audit/handler-intent", () => {
  it("does not flag private helpers unless they are m.top observer callbacks", () => {
    const src = brs`
      sub init()
          _cancelJob()
      end sub

      sub _cancelJob()
      end sub
    `;
    const result = formatSource({
      filePath: "Helpers.brs",
      source: src,
      config,
      onlyRules: new Set(["audit/handler-intent"]),
    });
    expect(result.diagnostics).toEqual([]);
  });

  it("does not force existing m.top observers to use _set property names", () => {
    const src = brs`
      sub init()
          m.top.observeFieldScoped("focusedChild", "_focusNav")
      end sub

      sub _focusNav()
      end sub
    `;
    const result = formatSource({
      filePath: "Observer.brs",
      source: src,
      config,
      onlyRules: new Set(["audit/handler-intent"]),
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.output).toContain(
      '    m.top.observeFieldScoped("focusedChild", "_focusNav")',
    );
    expect(result.output).toContain("sub _focusNav()");
  });

  it("accepts _set prefixes for m.top observeField callbacks", () => {
    const src = brs`
      sub init()
          m.top.observeField("focusedChild", "_setFocusedChild")
      end sub

      sub _setFocusedChild()
      end sub
    `;
    const result = formatSource({
      filePath: "Observer.brs",
      source: src,
      config,
      onlyRules: new Set(["audit/handler-intent"]),
    });
    expect(result.diagnostics).toEqual([]);
  });

  it("does not force existing non-top observers to use _on property names", () => {
    const src = brs`
      sub init()
          m.child.observeFieldScoped("focusedChild", "_focusNav")
      end sub

      sub _focusNav()
      end sub
    `;
    const result = formatSource({
      filePath: "Observer.brs",
      source: src,
      config,
      onlyRules: new Set(["audit/handler-intent"]),
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.output).toContain(
      '    m.child.observeFieldScoped("focusedChild", "_focusNav")',
    );
    expect(result.output).toContain("sub _focusNav()");
  });

  it("accepts _on prefixes for observers on member objects", () => {
    const src = brs`
      sub init()
          m._timer.observeFieldScoped("fired", "_onTimerFired")
      end sub

      sub _onTimerFired()
      end sub
    `;
    const result = formatSource({
      filePath: "Observer.brs",
      source: src,
      config,
      onlyRules: new Set(["audit/handler-intent"]),
    });
    expect(result.diagnostics).toEqual([]);
  });
});
