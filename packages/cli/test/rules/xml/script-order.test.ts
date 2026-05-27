import { describe, expect, it } from "vitest";
import { config, formatSource } from "../../helpers/format.js";
import { xml } from "../../helpers/source.js";

describe("xml/script-order", () => {
  it("does not reorder scripts when comments sit between them", () => {
    const src = xml`
      <component name="W" extends="Group">
        <!-- z --><script type="text/brightscript" uri="pkg:/z.brs" />
        <!-- a --><script type="text/brightscript" uri="pkg:/a.brs" />
      </component>
    `;
    const result = formatSource({ filePath: "W.xml", source: src, config });
    expect(result.changed).toBe(false);
    expect(
      result.diagnostics.some((d) => d.ruleId === "xml/script-order"),
    ).toBe(true);
  });

  it("reorders scripts and carries an own-line leading comment", () => {
    const src = xml`
      <component name="W" extends="Group">
        <!-- z -->
        <script type="text/brightscript" uri="pkg:/z.brs" />
        <script type="text/brightscript" uri="pkg:/a.brs" />
      </component>
    `;
    const result = formatSource({ filePath: "W.xml", source: src, config });
    expect(result.changed).toBe(true);
    expect(
      result.diagnostics.some((d) => d.ruleId === "xml/script-order"),
    ).toBe(false);
    // a.brs sorts first; the "z" comment travels with z.brs.
    const a = result.output.indexOf("a.brs");
    const comment = result.output.indexOf("<!-- z -->");
    const z = result.output.indexOf("z.brs");
    expect(a).toBeLessThan(comment);
    expect(comment).toBeLessThan(z);
  });

  it("groups script imports with blank lines between local, pkg, and source scripts", () => {
    const src = xml`
      <component name="LaunchDarkly" extends="Group">
        <script type="text/brightscript" uri="pkg:/components/launchdarkly/LaunchDarkly.brs" />
        <script type="text/brightscript" uri="ZLocal.brs" />
        <script type="text/brightscript" uri="LaunchDarkly.brs" />
        <script type="text/brightscript" uri="pkg:/source/ahelper.brs" />
        <script type="text/brightscript" uri="ALocal.brs" />
      </component>
    `;
    const result = formatSource({
      filePath: "components/services/LaunchDarkly/LaunchDarkly.xml",
      source: src,
      config,
    });
    expect(result.changed).toBe(true);
    expect(
      result.diagnostics.some((d) => d.ruleId === "xml/script-order"),
    ).toBe(false);
    expect(result.output).toBe(xml`
      <component name="LaunchDarkly" extends="Group">
        <script type="text/brightscript" uri="LaunchDarkly.brs" />
        <script type="text/brightscript" uri="ALocal.brs" />
        <script type="text/brightscript" uri="ZLocal.brs" />

        <script type="text/brightscript" uri="pkg:/components/launchdarkly/LaunchDarkly.brs" />

        <script type="text/brightscript" uri="pkg:/source/ahelper.brs" />
      </component>
    `);
  });

  it("adds script group blank lines when ordering is already correct", () => {
    const src = xml`
      <component name="Widget" extends="Group">
        <script type="text/brightscript" uri="Widget.brs" />
        <script type="text/brightscript" uri="WidgetHelpers.brs" />
        <script type="text/brightscript" uri="pkg:/components/common/Utils.brs" />
        <script type="text/brightscript" uri="pkg:/source/device.brs" />
      </component>
    `;
    const result = formatSource({
      filePath: "components/Widget.xml",
      source: src,
      config,
    });
    expect(result.output).toBe(xml`
      <component name="Widget" extends="Group">
        <script type="text/brightscript" uri="Widget.brs" />
        <script type="text/brightscript" uri="WidgetHelpers.brs" />

        <script type="text/brightscript" uri="pkg:/components/common/Utils.brs" />

        <script type="text/brightscript" uri="pkg:/source/device.brs" />
      </component>
    `);
  });
});
