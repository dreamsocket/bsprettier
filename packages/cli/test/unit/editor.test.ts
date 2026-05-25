import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatSingleFileForEditor,
} from "../../src/editor.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "bsprettier-editor-"));
  roots.push(root);
  return root;
}

describe("editor formatting helpers", () => {
  it("formats single-file editor input with stdin semantics", () => {
    const root = tempRoot();
    mkdirSync(join(root, "components"), { recursive: true });

    const result = formatSingleFileForEditor({
      cwd: root,
      filePath: "components/Widget.brs",
      source: "sub init()\n    if (m.x) then m.y = 1\nend sub\n",
    });

    expect(result.status).toBe("changed");
    expect(result.output).toContain("if(m.x)");
    expect(result.output).toContain("end if");
  });

  it("loads config fresh for each single-file editor request", () => {
    const root = tempRoot();
    mkdirSync(join(root, "components"), { recursive: true });

    const source = "sub init()\nend sub\n";
    writeFileSync(join(root, "components", "Widget.brs"), source, "utf8");
    const before = formatSingleFileForEditor({
      cwd: root,
      filePath: "components/Widget.brs",
      source,
      onlyRules: new Set(["brs/format-style"]),
    });
    expect(before.output).toContain("sub init()");

    writeFileSync(
      join(root, ".bsprettierrc"),
      JSON.stringify({
        formatter: {
          keywordCase: "upper",
        },
      }),
      "utf8",
    );

    const after = formatSingleFileForEditor({
      cwd: root,
      filePath: "components/Widget.brs",
      source,
      onlyRules: new Set(["brs/format-style"]),
    });
    expect(after.output).toContain("SUB init()");
  });

  it("resolves explicit config paths from the workspace cwd", () => {
    const root = tempRoot();
    mkdirSync(join(root, "config"), { recursive: true });
    mkdirSync(join(root, "components"), { recursive: true });
    writeFileSync(
      join(root, "config", "bsprettier.json"),
      JSON.stringify({
        formatter: {
          keywordCase: "upper",
        },
      }),
      "utf8",
    );

    const result = formatSingleFileForEditor({
      cwd: root,
      configPath: "config/bsprettier.json",
      filePath: "components/Widget.brs",
      source: "sub init()\nend sub\n",
      onlyRules: new Set(["brs/format-style"]),
    });

    expect(result.output).toContain("SUB init()");
  });
});
