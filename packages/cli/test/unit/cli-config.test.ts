import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../../src/cli.js";
import { withTempProject } from "../helpers/temp-project.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cli config and discovery", () => {
  it.sequential("supports explicit globs outside the current directory", async () => {
    await withTempProject(
      {
        cwd: "tool",
        files: {
          "tool/.gitignore": "*.brs\n",
          "target/components/NeedsFormat.brs":
            "sub init()\n    if (m.x) then m.y = 1\nend sub\n",
        },
      },
      async (ctx) => {
        await expect(
          main(["../target/components/**/*.brs", "--list-different"]),
        ).resolves.toBe(1);
        expect(ctx.stdoutText()).toContain(
          "../target/components/NeedsFormat.brs",
        );
      },
    );
  });

  it.sequential("reports invalid config instead of silently using defaults", async () => {
    await withTempProject(
      {
        files: {
          ".bsprettierrc": "{ nope",
          "components/Widget.brs": "sub init()\nend sub\n",
        },
      },
      async (ctx) => {
        await expect(main(["components/**/*.brs", "--check"])).resolves.toBe(3);

        expect(ctx.stderrText()).toContain("config");
      },
    );
  });

  it.sequential("discovers configuration from bsprettier.json", async () => {
    // Disable bsfmt and the one rule that would rewrite this file. A clean exit
    // is only possible if bsprettier.json is actually discovered and honored.
    await withTempProject(
      {
        files: {
          "bsprettier.json": JSON.stringify({
            formatter: null,
            rules: { "brs/block-if-form": "off", "brs/if-condition-parens": "off" },
          }),
          "components/Widget.brs":
            "sub init()\n    if (m.x) then m.y = 1\nend sub\n",
        },
      },
      async () => {
        // Without the config, defaults would split the single-line if and exit 1.
        await expect(main(["components/**/*.brs", "--check"])).resolves.toBe(0);
      },
    );
  });

  it.sequential("applies ignore patterns to globs outside the current directory", async () => {
    // `**/vendor/**` is not a built-in default ignore, so excluding the vendor
    // file proves both that bsprettier.json is loaded and that ignore patterns
    // apply to an out-of-cwd glob (fast-glob's own `ignore` silently did not).
    const changing = "sub init()\n    if (m.x) then m.y = 1\nend sub\n";
    await withTempProject(
      {
        cwd: "tool",
        files: {
          "tool/bsprettier.json": JSON.stringify({ ignore: ["**/vendor/**"] }),
          "target/components/Widget.brs": changing,
          "target/components/vendor/Lib.brs": changing,
        },
      },
      async (ctx) => {
        await expect(
          main(["../target/components/**/*.brs", "--list-different"]),
        ).resolves.toBe(1);

        const out = ctx.stdoutText();
        expect(out).toContain("Widget.brs");
        expect(out).not.toContain("vendor");
      },
    );
  });
});
