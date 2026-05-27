import { basename, dirname, isAbsolute, resolve } from "node:path";
import { parseBrs, type BrsParseResult } from "../parser/brighterscript-adapter.js";
import { parseXml, walkElements, type XmlParseResult } from "../parser/xml.js";
import { attrValue, tagNameEquals } from "../parser/xml-helpers.js";

interface ProjectXmlFile {
  path: string;
  source: string;
  parse: XmlParseResult;
  componentName: string | null;
  extendsName: string | null;
  publicNames: Set<string>;
  referencedScripts: string[];
  scopeScripts: string[];
}

export interface PublicInterfaceInfo {
  publicNames: Set<string>;
  requiresPrivatePrefixes: boolean;
  /** Other component-local scripts in this file's scope: abs path -> source. */
  scopeSources: Map<string, string>;
}

export interface FieldUsage {
  read: boolean;
  write: boolean;
}

export type FieldUsageMap = Map<string, FieldUsage>;

const contextCache = new WeakMap<ReadonlyMap<string, string>, ProjectContext>();

export function absolutePath(filePath: string): string {
  return isAbsolute(filePath) ? filePath : resolve(filePath);
}

export function baseNameNoExt(filePath: string): string {
  const file = basename(filePath);
  const dot = file.lastIndexOf(".");
  return dot > 0 ? file.slice(0, dot) : file;
}

function packageRootFor(filePath: string): string | null {
  const normalized = filePath.replaceAll("\\", "/");
  for (const segment of ["/components/", "/source/"]) {
    const idx = normalized.lastIndexOf(segment);
    if (idx >= 0) return filePath.slice(0, idx);
  }
  return null;
}

export function resolveUri(xmlPath: string, uri: string): string | null {
  if (
    /^[a-z][a-z0-9+.-]*:/i.test(uri) &&
    !uri.toLowerCase().startsWith("pkg:/")
  ) {
    return null;
  }
  if (uri.toLowerCase().startsWith("pkg:/")) {
    const root = packageRootFor(xmlPath);
    if (!root) return null;
    return resolve(root, uri.slice("pkg:/".length));
  }
  return resolve(dirname(xmlPath), uri);
}

function publicRoutineKey(name: string): string {
  return name.startsWith("_") ? name.slice(1).toLowerCase() : name.toLowerCase();
}

function collectOwnInterfaceFunctions(parse: XmlParseResult): Set<string> {
  const names = new Set<string>();
  if (parse.fatal || !parse.root) return names;

  for (const el of walkElements(parse.root)) {
    if (!tagNameEquals(el, "interface")) continue;
    for (const child of el.children) {
      if (!tagNameEquals(child, "function")) continue;
      const name = attrValue(child, "name");
      if (name) names.add(publicRoutineKey(name));
    }
  }
  return names;
}

function collectScripts(xmlPath: string, parse: XmlParseResult): {
  referencedScripts: string[];
  scopeScripts: string[];
} {
  const referencedScripts: string[] = [];
  const scopeScripts: string[] = [];
  if (parse.fatal || !parse.root) {
    return { referencedScripts, scopeScripts };
  }

  const dir = dirname(xmlPath);
  let hasScript = false;
  for (const el of walkElements(parse.root)) {
    if (!tagNameEquals(el, "script")) continue;
    hasScript = true;
    const uri = attrValue(el, "uri");
    if (!uri) continue;
    const target = resolveUri(xmlPath, uri);
    if (!target || !/\.(brs|bs)$/i.test(target)) continue;
    const abs = absolutePath(target);
    referencedScripts.push(abs);
    if (dirname(abs) === dir) scopeScripts.push(abs);
  }

  if (!hasScript) {
    const sibling = absolutePath(resolve(dir, `${baseNameNoExt(xmlPath)}.brs`));
    referencedScripts.push(sibling);
    scopeScripts.push(sibling);
  }

  return { referencedScripts, scopeScripts };
}

function isAnimationOrInterpolatorTag(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith("animation") || lower.endsWith("interpolator");
}

function readComponentInfo(filePath: string, source: string): ProjectXmlFile {
  const path = absolutePath(filePath);
  const parse = parseXml(source);
  const componentName = parse.root ? attrValue(parse.root, "name") ?? null : null;
  const scripts = collectScripts(path, parse);
  return {
    path,
    source,
    parse,
    componentName,
    extendsName: parse.root ? attrValue(parse.root, "extends") ?? null : null,
    publicNames: collectOwnInterfaceFunctions(parse),
    referencedScripts: scripts.referencedScripts,
    scopeScripts: scripts.scopeScripts,
  };
}

export class ProjectContext {
  readonly sourceByAbs = new Map<string, string>();
  readonly xmlFiles: ProjectXmlFile[] = [];
  readonly componentsByName = new Map<string, ProjectXmlFile>();
  private readonly componentsByReferencedScript = new Map<string, ProjectXmlFile[]>();
  private readonly brsParseCache = new Map<string, BrsParseResult | null>();
  private readonly publicNamesCache = new Map<string, Set<string>>();
  // linkedBrsForXml is called once per <field> by classifyField, so an
  // uncached call rescans every BRS source in the project per field. The
  // directory key dedupes naturally — same-directory siblings always produce
  // the same concatenated text. `null` is cached too so the lookup miss path
  // doesn't re-walk the whole sourceByAbs map.
  private readonly linkedBrsByDir = new Map<string, string | null>();
  // Same-directory BRS file list, built lazily on first request for that
  // directory. Used by linkedBrsForXml and by per-component field-usage maps.
  private brsByDir: Map<string, string[]> | null = null;
  // Per-directory `m.top.<field>` usage map. A single linear scan over the
  // linked BRS classifies every field at once, so xml/interface-section-order
  // is O(1) per <field> instead of one regex sweep per field.
  private readonly fieldUsageByDir = new Map<string, FieldUsageMap | null>();
  // Cache for rule-supplied computations whose result is deterministic in the
  // project sources. Keys are rule-namespaced (e.g. "ui-renames:<scope-key>"),
  // so two callers in the same scope share work without leaking state across
  // unrelated rules. Values are stored as `unknown`; the caller asserts the
  // type via the generic on `cache`.
  private readonly genericCache = new Map<string, unknown>();

  constructor(readonly sources: ReadonlyMap<string, string>) {
    for (const [filePath, source] of sources) {
      const abs = absolutePath(filePath);
      this.sourceByAbs.set(abs, source);
      if (!/\.xml$/i.test(filePath)) continue;
      const xml = readComponentInfo(abs, source);
      this.xmlFiles.push(xml);
      if (xml.componentName) {
        this.componentsByName.set(xml.componentName.toLowerCase(), xml);
      }
      for (const scriptPath of xml.referencedScripts) {
        const existing = this.componentsByReferencedScript.get(scriptPath);
        if (existing) {
          existing.push(xml);
        } else {
          this.componentsByReferencedScript.set(scriptPath, [xml]);
        }
      }
    }
  }

  getSource(filePath: string): string | undefined {
    return this.sourceByAbs.get(absolutePath(filePath));
  }

  getBrsParse(filePath: string): BrsParseResult | null {
    const abs = absolutePath(filePath);
    if (this.brsParseCache.has(abs)) return this.brsParseCache.get(abs)!;
    const source = this.sourceByAbs.get(abs);
    if (source === undefined || !/\.(brs|bs)$/i.test(abs)) {
      this.brsParseCache.set(abs, null);
      return null;
    }
    const parse = parseBrs(source, abs);
    this.brsParseCache.set(abs, parse);
    return parse;
  }

  componentsReferencingFile(filePath: string): ProjectXmlFile[] {
    const abs = absolutePath(filePath);
    return this.componentsByReferencedScript.get(abs) ?? [];
  }

  isSceneScript(filePath: string): boolean {
    return this.componentsReferencingFile(filePath).some(
      (xml) => xml.extendsName?.toLowerCase() === "scene",
    );
  }

  animationOrInterpolatorIds(filePath: string): Set<string> {
    const ids = new Set<string>();
    for (const xml of this.componentsReferencingFile(filePath)) {
      if (xml.parse.fatal || !xml.parse.root) continue;
      for (const el of walkElements(xml.parse.root)) {
        if (!isAnimationOrInterpolatorTag(el.name)) continue;
        const id = attrValue(el, "id");
        if (id) ids.add(id);
      }
    }
    return ids;
  }

  scopeSources(filePath: string): Map<string, string> {
    const brsPath = absolutePath(filePath);
    const scope = new Map<string, string>();
    const ownSource = this.sourceByAbs.get(brsPath);
    if (ownSource !== undefined) scope.set(brsPath, ownSource);

    for (const xml of this.componentsReferencingFile(brsPath)) {
      for (const scriptPath of xml.scopeScripts) {
        const source = this.sourceByAbs.get(scriptPath);
        if (source !== undefined) scope.set(scriptPath, source);
      }
    }
    return scope;
  }

  publicInterfaceInfo(filePath: string): PublicInterfaceInfo | null {
    const brsPath = absolutePath(filePath);
    const publicNames = new Set<string>();
    let requiresPrivatePrefixes = false;
    const scopeSources = new Map<string, string>();
    let foundComponent = false;

    for (const xml of this.componentsReferencingFile(brsPath)) {
      foundComponent = true;
      if (dirname(xml.path) === dirname(brsPath)) requiresPrivatePrefixes = true;
      for (const name of this.collectInterfaceFunctions(xml)) {
        publicNames.add(name);
      }
      for (const scriptPath of xml.scopeScripts) {
        if (scriptPath === brsPath) continue;
        const source = this.sourceByAbs.get(scriptPath);
        if (source !== undefined) scopeSources.set(scriptPath, source);
      }
    }

    return foundComponent
      ? { publicNames, requiresPrivatePrefixes, scopeSources }
      : null;
  }

  linkedBrsForXml(filePath: string): string | null {
    const dir = dirname(absolutePath(filePath));
    if (this.linkedBrsByDir.has(dir)) return this.linkedBrsByDir.get(dir)!;
    const parts: string[] = [];
    for (const sourcePath of this.brsFilesInDir(dir)) {
      const source = this.sourceByAbs.get(sourcePath);
      if (source !== undefined) parts.push(source);
    }
    const value = parts.length > 0 ? parts.join("\n") : null;
    this.linkedBrsByDir.set(dir, value);
    return value;
  }

  /**
   * Bucketed `m.top.<field>` usage for the component's linked BRS, keyed by
   * lowercased field id. A field marked `write` had an assignment statement
   * (or compound assignment); `read` covers reads and `observeField` self-
   * observations. Returns null when the component has no linked BRS at all.
   *
   * Single regex sweep over the cached linked BRS replaces what was previously
   * one full scan per <field>; see classifyUsage docstring for the rules.
   */
  fieldUsageForXml(filePath: string): FieldUsageMap | null {
    const dir = dirname(absolutePath(filePath));
    if (this.fieldUsageByDir.has(dir)) return this.fieldUsageByDir.get(dir)!;
    const brs = this.linkedBrsForXml(filePath);
    if (brs === null) {
      this.fieldUsageByDir.set(dir, null);
      return null;
    }
    const map: FieldUsageMap = new Map();
    const ensure = (key: string): FieldUsage => {
      let u = map.get(key);
      if (!u) {
        u = { read: false, write: false };
        map.set(key, u);
      }
      return u;
    };
    const refRe = /\bm\.top\.([A-Za-z_]\w*)\b/g;
    let m: RegExpExecArray | null;
    while ((m = refRe.exec(brs)) !== null) {
      const key = (m[1] ?? "").toLowerCase();
      if (!key) continue;
      const lineStart = brs.lastIndexOf("\n", m.index - 1) + 1;
      const before = brs.slice(lineStart, m.index);
      const atStatementStart = /^[ \t]*$/.test(before);
      const rest = brs.slice(m.index + m[0].length).replace(/^[ \t]*/, "");
      const usage = ensure(key);
      if (atStatementStart && /^=(?!=)/.test(rest)) {
        usage.write = true;
      } else if (atStatementStart && /^[-+*/]=/.test(rest)) {
        usage.write = true;
        usage.read = true;
      } else {
        usage.read = true;
      }
    }
    const obsRe = /\bobserveField(?:Scoped)?\s*\(\s*["']([^"']+)["']/gi;
    while ((m = obsRe.exec(brs)) !== null) {
      const id = (m[1] ?? "").toLowerCase();
      if (id) ensure(id).read = true;
    }
    this.fieldUsageByDir.set(dir, map);
    return map;
  }

  /**
   * Memoize a deterministic computation against this ProjectContext. Used by
   * rules whose scope-level result is the same for every file in the scope
   * (e.g. ui-node-prefix renames, sibling-script private aliases). The caller
   * is responsible for building a key that uniquely identifies the inputs.
   */
  cache<T>(key: string, build: () => T): T {
    if (this.genericCache.has(key)) return this.genericCache.get(key) as T;
    const value = build();
    this.genericCache.set(key, value);
    return value;
  }

  /**
   * Deterministic identity for this file's component-local scope: the sorted
   * absolute paths of every script that belongs to it. Two siblings in the
   * same scope return the same key, so a scope-level computation only runs
   * once per scope.
   */
  scopeKey(filePath: string): string {
    const brsPath = absolutePath(filePath);
    const paths = new Set<string>();
    paths.add(brsPath);
    for (const xml of this.componentsReferencingFile(brsPath)) {
      for (const scriptPath of xml.scopeScripts) paths.add(scriptPath);
    }
    return [...paths].sort().join("\0");
  }

  private brsFilesInDir(dir: string): string[] {
    if (!this.brsByDir) {
      this.brsByDir = new Map();
      for (const sourcePath of this.sourceByAbs.keys()) {
        if (!/\.(brs|bs)$/i.test(sourcePath)) continue;
        const d = dirname(sourcePath);
        const list = this.brsByDir.get(d);
        if (list) list.push(sourcePath);
        else this.brsByDir.set(d, [sourcePath]);
      }
    }
    return this.brsByDir.get(dir) ?? [];
  }

  private collectInterfaceFunctions(xml: ProjectXmlFile): Set<string> {
    const cacheKey = xml.path;
    const cached = this.publicNamesCache.get(cacheKey);
    if (cached) return cached;

    const names = new Set<string>();
    const seen = new Set<string>();
    let current: ProjectXmlFile | null = xml;
    while (current) {
      const key = current.componentName?.toLowerCase();
      if (!key || seen.has(key)) break;
      seen.add(key);

      for (const name of current.publicNames) names.add(name);
      if (!current.extendsName) break;
      current = this.componentsByName.get(current.extendsName.toLowerCase()) ?? null;
    }

    this.publicNamesCache.set(cacheKey, names);
    return names;
  }
}

export function getProjectContext(
  sources: ReadonlyMap<string, string>,
): ProjectContext {
  const cached = contextCache.get(sources);
  if (cached) return cached;
  const context = new ProjectContext(sources);
  contextCache.set(sources, context);
  return context;
}
