import { describe, expect, it } from "vitest";
import { migrateOnChangeObservers } from "../../../src/edit/onchange-migration.js";
import { config, formatSource } from "../../helpers/format.js";
import { brs as brsSource, xml as xmlSource } from "../../helpers/source.js";

describe("xml/no-onchange-field", () => {
  it("diagnoses XML onChange handlers so they can move to code observers", () => {
    const src = xmlSource`
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

  // The actual rewrite is performed by `migrateOnChangeObservers`, a pre-pass
  // orchestrator that runs before per-file formatting because it spans XML and
  // BRS together.
  describe("migration pre-pass", () => {
    it("moves XML onChange handlers into the linked component's init", () => {
      const xmlPath = "/proj/components/Widget.xml";
      const brsPath = "/proj/components/Widget.brs";
      const sources = new Map([
        [
          xmlPath,
          xmlSource`
            <component name="Widget" extends="Group">
              <script type="text/brightscript" uri="Widget.brs" />
              <interface>
                <field id="focusedChild" type="node" onChange="_focusNav" />
              </interface>
            </component>
          `,
        ],
        [
          brsPath,
          brsSource`
            sub init()
                m.ready = true
            end sub

            sub _focusNav()
            end sub
          `,
        ],
      ]);

      const result = migrateOnChangeObservers(sources);

      expect(result.sources.get(xmlPath)).not.toContain("onChange");
      const brsOut = result.sources.get(brsPath)!;
      expect(brsOut).toContain(
        '    m.top.observeFieldScoped("focusedChild", "_setFocusedChild")\n' +
          "    m.ready = true",
      );
      expect(brsOut).toContain("sub _setFocusedChild()");
    });

    it("does not rename existing observers during migration", () => {
      const xmlPath = "/proj/components/Widget.xml";
      const brsPath = "/proj/components/Widget.brs";
      const sources = new Map([
        [
          xmlPath,
          xmlSource`
            <component name="Widget" extends="Group">
              <script type="text/brightscript" uri="Widget.brs" />
              <interface>
                <field id="focusedChild" type="node" onChange="_focusNav" />
              </interface>
            </component>
          `,
        ],
        [
          brsPath,
          brsSource`
            sub init()
                m.top.observeFieldScoped("focusedChild", "_focusNav")
            end sub

            sub _focusNav()
            end sub
          `,
        ],
      ]);

      const result = migrateOnChangeObservers(sources);

      expect(result.sources.get(xmlPath)).not.toContain("onChange");
      const brsOut = result.sources.get(brsPath)!;
      expect(brsOut).toContain(
        '    m.top.observeFieldScoped("focusedChild", "_focusNav")',
      );
      expect(brsOut).toContain("sub _focusNav()");
      expect(brsOut).not.toContain("_setFocusedChild");
    });

    it("creates init and rewrites privatized onChange handlers", () => {
      const xmlPath = "/proj/components/tasks/Registry/Registry.xml";
      const brsPath = "/proj/components/tasks/Registry/Registry.brs";
      const sources = new Map([
        [
          xmlPath,
          xmlSource`
            <component name="Registry" extends="Task">
              <script type="text/brightscript" uri="Registry.brs" />
              <interface>
                <field id="delete" onChange="OnDelete" type="assocarray" />
                <field id="read" onChange="OnRead" type="assocarray" />
              </interface>
            </component>
          `,
        ],
        [
          brsPath,
          brsSource`
            sub _onDelete()
                m.top.functionName = "delete"
            end sub

            sub _onRead()
                m.top.functionName = "read"
            end sub
          `,
        ],
      ]);

      const result = migrateOnChangeObservers(sources);

      expect(result.sources.get(xmlPath)).not.toContain("onChange");
      const brsOut = result.sources.get(brsPath)!;
      expect(brsOut).toContain("sub init()");
      expect(brsOut).toContain(
        '    m.top.observeFieldScoped("delete", "_setDelete")',
      );
      expect(brsOut).toContain(
        '    m.top.observeFieldScoped("read", "_setRead")',
      );
      expect(brsOut).toContain("sub _setDelete()");
      expect(brsOut).toContain("sub _setRead()");
      expect(brsOut).not.toContain("_onDelete");
      expect(brsOut).not.toContain("_onRead");
    });
  });
});
