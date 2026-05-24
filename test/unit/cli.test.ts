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

  it.sequential("creates init and rewrites privatized onChange handlers on write", async () => {
    const root = mkdtempSync(join(tmpdir(), "bsprettier-cli-"));
    const components = join(root, "components", "tasks", "Registry");
    const xmlPath = join(components, "Registry.xml");
    const brsPath = join(components, "Registry.brs");

    mkdirSync(components, { recursive: true });
    writeFileSync(
      xmlPath,
      '<component name="Registry" extends="Task">\n' +
        '  <script type="text/brightscript" uri="Registry.brs" />\n' +
        "  <interface>\n" +
        '    <field id="delete" onChange="OnDelete" type="assocarray" />\n' +
        '    <field id="read" onChange="OnRead" type="assocarray" />\n' +
        "  </interface>\n" +
        "</component>\n",
      "utf8",
    );
    writeFileSync(
      brsPath,
      "sub _onDelete()\n" +
        '    m.top.functionName = "delete"\n' +
        "end sub\n\n" +
        "sub _onRead()\n" +
        '    m.top.functionName = "read"\n' +
        "end sub\n",
      "utf8",
    );

    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    try {
      process.chdir(root);

      await expect(
        main([
          "components/tasks/Registry/Registry.xml",
          "components/tasks/Registry/Registry.brs",
          "--rules=xml/no-onchange-field",
          "--write",
        ]),
      ).resolves.toBe(0);

      expect(readFileSync(xmlPath, "utf8")).not.toContain("onChange");
      const output = readFileSync(brsPath, "utf8");
      expect(output).toContain("sub init()");
      expect(output).toContain(
        '    m.top.observeFieldScoped("delete", "_setDelete")',
      );
      expect(output).toContain(
        '    m.top.observeFieldScoped("read", "_setRead")',
      );
      expect(output).toContain("sub _setDelete()");
      expect(output).toContain("sub _setRead()");
      expect(output).not.toContain("_onDelete");
      expect(output).not.toContain("_onRead");
      expect(
        stderr.mock.calls.map(([chunk]) => String(chunk)).join(""),
      ).not.toContain("xml/no-onchange-field");
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

  it.sequential("never promotes private-prefixed routines to public on write", async () => {
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

      await main([
        "components/Widget.xml",
        "components/Widget.brs",
        "--rules=audit/private-member-naming",
        "--write",
      ]);

      // The `_` prefix is the author's private marking; it is never stripped.
      expect(readFileSync(xmlPath, "utf8")).toContain(
        '<function name="_show" />',
      );
      const output = readFileSync(brsPath, "utf8");
      expect(output).toContain("    _show()");
      expect(output).toContain("sub _show()");
      expect(output).not.toContain("sub show()");
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

  it.sequential("rewrites sibling UI member reads on write", async () => {
    const root = mkdtempSync(join(tmpdir(), "bsprettier-cli-"));
    const components = join(root, "components", "player");
    const xmlPath = join(components, "Player.xml");
    const mainBrsPath = join(components, "Player.brs");
    const viewBrsPath = join(components, "Playerview.brs");

    mkdirSync(components, { recursive: true });
    writeFileSync(
      xmlPath,
      '<component name="Player" extends="Group">\n' +
        '  <script type="text/brightscript" uri="Player.brs" />\n' +
        '  <script type="text/brightscript" uri="Playerview.brs" />\n' +
        "</component>\n",
      "utf8",
    );
    writeFileSync(
      mainBrsPath,
      "sub init()\n" +
        '    m.tileGroup = m.top.findNode("tileGroup")\n' +
        "end sub\n",
      "utf8",
    );
    writeFileSync(
      viewBrsPath,
      "sub render()\n" +
        "    m.tileGroup.visible = true\n" +
        "end sub\n",
      "utf8",
    );

    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      process.chdir(root);

      await expect(
        main([
          "components/player/Player.xml",
          "components/player/Player.brs",
          "components/player/Playerview.brs",
          "--rules=audit/ui-node-prefix",
          "--write",
        ]),
      ).resolves.toBe(0);

      expect(readFileSync(mainBrsPath, "utf8")).toContain(
        '    m._uiTileGroup = m.top.findNode("tileGroup")',
      );
      expect(readFileSync(viewBrsPath, "utf8")).toContain(
        "    m._uiTileGroup.visible = true",
      );
    } finally {
      process.chdir(originalCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.sequential("rewrites sibling routine calls on write", async () => {
    const root = mkdtempSync(join(tmpdir(), "bsprettier-cli-"));
    const components = join(root, "components", "player");
    const xmlPath = join(components, "LivePlayer.xml");
    const playerBrsPath = join(components, "LivePlayer.brs");
    const trackingBrsPath = join(components, "LivePlayertracking.brs");

    mkdirSync(components, { recursive: true });
    writeFileSync(
      xmlPath,
      '<component name="LivePlayer" extends="Group">\n' +
        '  <script type="text/brightscript" uri="LivePlayer.brs" />\n' +
        '  <script type="text/brightscript" uri="LivePlayertracking.brs" />\n' +
        "  <interface>\n" +
        '    <function name="show" />\n' +
        "  </interface>\n" +
        "</component>\n",
      "utf8",
    );
    writeFileSync(
      playerBrsPath,
      "sub show()\n" +
        "    trackPageLoad()\n" +
        "end sub\n",
      "utf8",
    );
    writeFileSync(
      trackingBrsPath,
      "sub trackPageLoad()\n" +
        "end sub\n",
      "utf8",
    );

    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      process.chdir(root);

      await expect(
        main([
          "components/player/LivePlayer.xml",
          "components/player/LivePlayer.brs",
          "components/player/LivePlayertracking.brs",
          "--rules=audit/private-member-naming",
          "--write",
        ]),
      ).resolves.toBe(0);

      expect(readFileSync(playerBrsPath, "utf8")).toContain(
        "    _trackPageLoad()",
      );
      expect(readFileSync(trackingBrsPath, "utf8")).toContain(
        "sub _trackPageLoad()",
      );
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
