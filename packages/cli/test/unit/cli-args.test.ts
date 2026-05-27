import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../../src/cli.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cli argument parsing", () => {
  it.sequential("prints help for the short help flag", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(main(["-h"])).resolves.toBe(0);

    const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(output).toContain("Usage:");
    expect(output).toContain("-h, --help");
    expect(stderr).not.toHaveBeenCalled();
  });

  it.sequential("reports mutually exclusive modes as a usage error", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(main(["components/**/*.brs", "--check", "--write"])).resolves.toBe(3);

    expect(stderr.mock.calls.map(([chunk]) => String(chunk)).join("")).toContain(
      "mutually exclusive",
    );
  });

  it.sequential("reports unknown rule ids as a usage error", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(
      main(["components/**/*.brs", "--rules=brs/not-real", "--check"]),
    ).resolves.toBe(3);

    expect(stderr.mock.calls.map(([chunk]) => String(chunk)).join("")).toContain(
      "unknown rule id",
    );
  });
});
