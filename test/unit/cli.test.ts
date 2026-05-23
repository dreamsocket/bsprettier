import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../../src/cli.js";

const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
  vi.restoreAllMocks();
});

describe("cli discovery", () => {
  it.sequential("supports explicit globs outside the current directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "bsprettier-cli-"));
    const cwd = join(root, "tool");
    const externalComponents = join(root, "target", "components");

    mkdirSync(cwd, { recursive: true });
    mkdirSync(externalComponents, { recursive: true });
    writeFileSync(join(cwd, ".gitignore"), "*.brs\n", "utf8");
    writeFileSync(
      join(externalComponents, "NeedsFormat.brs"),
      "sub init()\n    if (m.x) then m.y = 1\nend sub\n",
      "utf8",
    );

    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      process.chdir(cwd);

      await expect(
        main(["../target/components/**/*.brs", "--list-different"]),
      ).resolves.toBe(1);
      expect(stdout.mock.calls.map(([chunk]) => String(chunk)).join("")).toContain(
        "../target/components/NeedsFormat.brs",
      );
    } finally {
      process.chdir(originalCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.sequential("moves XML onChange handlers into component init on write", async () => {
    const root = mkdtempSync(join(tmpdir(), "bsprettier-cli-"));
    const components = join(root, "components");
    const xmlPath = join(components, "Widget.xml");
    const brsPath = join(components, "Widget.brs");

    mkdirSync(components, { recursive: true });
    writeFileSync(
      xmlPath,
      '<component name="Widget" extends="Group">\n' +
        '  <script type="text/brightscript" uri="Widget.brs" />\n' +
        "  <interface>\n" +
        '    <field id="focusedChild" type="node" onChange="_focusNav" />\n' +
        "  </interface>\n" +
        "</component>\n",
      "utf8",
    );
    writeFileSync(
      brsPath,
        "sub init()\n" +
        "    m.ready = true\n" +
        "end sub\n\n" +
        "sub _focusNav()\n" +
        "end sub\n",
      "utf8",
    );

    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      process.chdir(root);

      await expect(
        main([
          "components/Widget.xml",
          "components/Widget.brs",
          "--rules=xml/no-onchange-field",
          "--write",
        ]),
      ).resolves.toBe(0);

      expect(readFileSync(xmlPath, "utf8")).not.toContain("onChange");
      expect(readFileSync(brsPath, "utf8")).toContain(
        '    m.top.observeFieldScoped("focusedChild", "_setFocusedChild")\n' +
          "    m.ready = true",
      );
      expect(readFileSync(brsPath, "utf8")).toContain("sub _setFocusedChild()");
    } finally {
      process.chdir(originalCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.sequential("does not rename existing observers during onChange migration", async () => {
    const root = mkdtempSync(join(tmpdir(), "bsprettier-cli-"));
    const components = join(root, "components");
    const xmlPath = join(components, "Widget.xml");
    const brsPath = join(components, "Widget.brs");

    mkdirSync(components, { recursive: true });
    writeFileSync(
      xmlPath,
      '<component name="Widget" extends="Group">\n' +
        '  <script type="text/brightscript" uri="Widget.brs" />\n' +
        "  <interface>\n" +
        '    <field id="focusedChild" type="node" onChange="_focusNav" />\n' +
        "  </interface>\n" +
        "</component>\n",
      "utf8",
    );
    writeFileSync(
      brsPath,
      "sub init()\n" +
        '    m.top.observeFieldScoped("focusedChild", "_focusNav")\n' +
        "end sub\n\n" +
        "sub _focusNav()\n" +
        "end sub\n",
      "utf8",
    );

    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      process.chdir(root);

      await expect(
        main([
          "components/Widget.xml",
          "components/Widget.brs",
          "--rules=xml/no-onchange-field",
          "--write",
        ]),
      ).resolves.toBe(0);

      expect(readFileSync(xmlPath, "utf8")).not.toContain("onChange");
      const output = readFileSync(brsPath, "utf8");
      expect(output).toContain(
        '    m.top.observeFieldScoped("focusedChild", "_focusNav")',
      );
      expect(output).toContain("sub _focusNav()");
      expect(output).not.toContain("_setFocusedChild");
    } finally {
      process.chdir(originalCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.sequential("prefixes private primary component routines on write", async () => {
    const root = mkdtempSync(join(tmpdir(), "bsprettier-cli-"));
    const components = join(root, "components");
    const xmlPath = join(components, "Widget.xml");
    const brsPath = join(components, "Widget.brs");

    mkdirSync(components, { recursive: true });
    writeFileSync(
      xmlPath,
      '<component name="Widget" extends="Group">\n' +
        '  <script type="text/brightscript" uri="Widget.brs" />\n' +
        "  <interface>\n" +
        '    <function name="show" />\n' +
        "  </interface>\n" +
        "</component>\n",
      "utf8",
    );
    writeFileSync(
      brsPath,
      "sub init()\n" +
        "end sub\n\n" +
        "sub show()\n" +
        "    helper()\n" +
        "end sub\n\n" +
        "sub helper()\n" +
        "end sub\n",
      "utf8",
    );

    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      process.chdir(root);

      await expect(
        main([
          "components/Widget.xml",
          "components/Widget.brs",
          "--rules=audit/private-member-naming",
          "--write",
        ]),
      ).resolves.toBe(0);

      const output = readFileSync(brsPath, "utf8");
      expect(output).toContain("sub show()");
      expect(output).toContain("    _helper()");
      expect(output).toContain("sub _helper()");
    } finally {
      process.chdir(originalCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.sequential("removes private prefixes from public interface routines on write", async () => {
    const root = mkdtempSync(join(tmpdir(), "bsprettier-cli-"));
    const components = join(root, "components");
    const xmlPath = join(components, "Widget.xml");
    const brsPath = join(components, "Widget.brs");

    mkdirSync(components, { recursive: true });
    writeFileSync(
      xmlPath,
      '<component name="Widget" extends="Group">\n' +
        '  <script type="text/brightscript" uri="Widget.brs" />\n' +
        "  <interface>\n" +
        '    <function name="_show" />\n' +
        "  </interface>\n" +
        "</component>\n",
      "utf8",
    );
    writeFileSync(
      brsPath,
      "sub init()\n" +
        "    _show()\n" +
        "end sub\n\n" +
        "sub _show()\n" +
        "end sub\n",
      "utf8",
    );

    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      process.chdir(root);

      await expect(
        main([
          "components/Widget.xml",
          "components/Widget.brs",
          "--rules=audit/private-member-naming",
          "--write",
        ]),
      ).resolves.toBe(0);

      expect(readFileSync(xmlPath, "utf8")).toContain(
        '<function name="show" />',
      );
      const output = readFileSync(brsPath, "utf8");
      expect(output).toContain("    show()");
      expect(output).toContain("sub show()");
    } finally {
      process.chdir(originalCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.sequential("leaves existing observer intent names alone on write", async () => {
    const root = mkdtempSync(join(tmpdir(), "bsprettier-cli-"));
    const components = join(root, "components");
    const brsPath = join(components, "Widget.brs");

    mkdirSync(components, { recursive: true });
    writeFileSync(
      brsPath,
      "sub init()\n" +
        '    m.top.observeFieldScoped("focusedChild", "_focusNav")\n' +
        "end sub\n\n" +
        "sub _focusNav()\n" +
        "end sub\n",
      "utf8",
    );

    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      process.chdir(root);

      await expect(
        main([
          "components/Widget.brs",
          "--rules=audit/handler-intent",
          "--write",
        ]),
      ).resolves.toBe(0);

      const output = readFileSync(brsPath, "utf8");
      expect(output).toContain(
        '    m.top.observeFieldScoped("focusedChild", "_focusNav")',
      );
      expect(output).toContain("sub _focusNav()");
    } finally {
      process.chdir(originalCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.sequential("applies only the private prefix to primary-script observers on write", async () => {
    const root = mkdtempSync(join(tmpdir(), "bsprettier-cli-"));
    const components = join(root, "components");
    const xmlPath = join(components, "Widget.xml");
    const brsPath = join(components, "Widget.brs");

    mkdirSync(components, { recursive: true });
    writeFileSync(
      xmlPath,
      '<component name="Widget" extends="Group">\n' +
        '  <script type="text/brightscript" uri="Widget.brs" />\n' +
        "  <interface>\n" +
        '    <function name="show" />\n' +
        "  </interface>\n" +
        "</component>\n",
      "utf8",
    );
    writeFileSync(
      brsPath,
      "sub init()\n" +
        '    m.top.observeFieldScoped("focusedChild", "focusNav")\n' +
        "end sub\n\n" +
        "sub focusNav()\n" +
        "end sub\n",
      "utf8",
    );

    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      process.chdir(root);

      await expect(
        main([
          "components/Widget.xml",
          "components/Widget.brs",
          "--rules=audit/private-member-naming",
          "--write",
        ]),
      ).resolves.toBe(0);

      const output = readFileSync(brsPath, "utf8");
      expect(output).toContain(
        '    m.top.observeFieldScoped("focusedChild", "_focusNav")',
      );
      expect(output).toContain("sub _focusNav()");
      expect(output).not.toContain("_setFocusedChild");
    } finally {
      process.chdir(originalCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
