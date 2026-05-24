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
  private readonly brsParseCache = new Map<string, BrsParseResult | null>();
  private readonly publicNamesCache = new Map<string, Set<string>>();

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
    return this.xmlFiles.filter((xml) => xml.referencedScripts.includes(abs));
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
    const xmlPath = absolutePath(filePath);
    const parts: string[] = [];
    const dir = dirname(xmlPath);
    for (const [sourcePath, source] of this.sourceByAbs) {
      if (!/\.(brs|bs)$/i.test(sourcePath)) continue;
      if (dirname(sourcePath) === dir) parts.push(source);
    }
    return parts.length > 0 ? parts.join("\n") : null;
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
