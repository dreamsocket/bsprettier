import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../../src/cli.js";
import { withTempProject } from "../helpers/temp-project.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cli --write pipeline", () => {
  // Single smoke test: --write must persist a rule's output to disk and exit 0.
  // Per-rule transformation correctness is covered by the rule unit tests; this
  // only proves the CLI write path itself works.
  it.sequential("persists rule fixes to disk", async () => {
    await withTempProject(
      {
        files: {
          "components/Widget.brs":
            "sub init()\n    if (m.x) then m.y = 1\nend sub\n",
        },
      },
      async (ctx) => {
        await expect(
          main(["components/Widget.brs", "--write"]),
        ).resolves.toBe(0);

        const output = ctx.read("components/Widget.brs");
        expect(output).toContain("if(m.x)");
        expect(output).toContain("end if");
      },
    );
  });
});

describe("cli I/O discipline", () => {
  it.sequential("prints forced progress to stderr without polluting list output", async () => {
    await withTempProject(
      {
        files: {
          "components/NeedsFormat.brs":
            "sub init()\n    if (m.x) then m.y = 1\nend sub\n",
        },
      },
      async (ctx) => {
        await expect(
          main(["components/**/*.brs", "--list-different", "--progress"]),
        ).resolves.toBe(1);

        expect(ctx.stdoutText().trim()).toBe("components/NeedsFormat.brs");
        expect(ctx.stderrText()).toContain("Progress 0/4");
        expect(ctx.stderrText()).toContain("Progress 4/4");
        expect(ctx.stderrText()).toContain("processed 1 file(s)");
      },
    );
  });

  it.sequential("formats stdin using the provided stdin filepath", async () => {
    const stdin = process.stdin as NodeJS.ReadStream & AsyncIterable<Buffer>;
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(stdin, Symbol.asyncIterator).mockImplementation(async function* () {
      yield Buffer.from("sub init()\n    if (m.x) then m.y = 1\nend sub\n");
    });

    await expect(
      main(["--stdin-filepath", "components/Widget.brs"]),
    ).resolves.toBe(0);

    const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(output).toContain("if(m.x)");
    expect(output).toContain("end if");
  });
});
