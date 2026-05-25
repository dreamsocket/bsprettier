import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceFormatService } from "../../src/editor/workspace-service.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "bsprettier-workspace-"));
  roots.push(root);
  return root;
}

describe("WorkspaceFormatService", () => {
  it("formats with linked XML project context in project mode", () => {
    const root = tempRoot();
    const componentDir = join(root, "components", "player");
    mkdirSync(componentDir, { recursive: true });
    const xml =
      '<component name="LivePlayer" extends="Group">\n' +
      '  <script type="text/brightscript" uri="LivePlayer.brs" />\n' +
      '  <script type="text/brightscript" uri="LivePlayertracking.brs" />\n' +
      "  <interface>\n" +
      '    <function name="show" />\n' +
      "  </interface>\n" +
      "</component>\n";
    const playerBrs =
      "sub show()\n" +
      "    trackPageLoad()\n" +
      "end sub\n";
    const trackingBrs =
      "sub trackPageLoad()\n" +
      "end sub\n";

    writeFileSync(join(componentDir, "LivePlayer.xml"), xml, "utf8");
    writeFileSync(join(componentDir, "LivePlayer.brs"), playerBrs, "utf8");
    writeFileSync(
      join(componentDir, "LivePlayertracking.brs"),
      trackingBrs,
      "utf8",
    );

    const service = new WorkspaceFormatService({
      cwd: root,
      onlyRules: new Set(["audit/private-member-naming"]),
    });
    const response = service.format({
      mode: "project",
      filePath: "components/player/LivePlayer.brs",
      source: playerBrs,
    });

    expect(response.mode).toBe("project");
    expect(response.result.output).toContain("_trackPageLoad()");
  });

  it("can fall back to single-file stdin behavior", () => {
    const root = tempRoot();
    const componentDir = join(root, "components", "player");
    mkdirSync(componentDir, { recursive: true });
    const xml =
      '<component name="LivePlayer" extends="Group">\n' +
      '  <script type="text/brightscript" uri="LivePlayer.brs" />\n' +
      "  <interface>\n" +
      '    <function name="show" />\n' +
      "  </interface>\n" +
      "</component>\n";
    const playerBrs =
      "sub show()\n" +
      "end sub\n" +
      "\n" +
      "sub helper()\n" +
      "end sub\n";
    writeFileSync(join(componentDir, "LivePlayer.xml"), xml, "utf8");
    writeFileSync(join(componentDir, "LivePlayer.brs"), playerBrs, "utf8");

    const service = new WorkspaceFormatService({
      cwd: root,
      onlyRules: new Set(["audit/private-member-naming"]),
    });
    const project = service.format({
      mode: "project",
      filePath: "components/player/LivePlayer.brs",
      source: playerBrs,
    });
    const singleFile = service.format({
      mode: "singleFile",
      filePath: "components/player/LivePlayer.brs",
      source: playerBrs,
    });

    expect(project.result.output).toContain("sub _helper()");
    expect(singleFile.result.output).toContain("sub helper()");
  });
});
