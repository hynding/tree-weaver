import { createRequire } from 'node:module';
import {
  addVersion,
  componentProps,
  DISPLAY_IDS,
  findComponent,
  insertNode,
  instancesOf,
  instantiateComponent,
  resolveRef,
  saveComponent,
  type ComponentInstance,
  type Forest,
  resetToken,
  setToken,
  themeTokens,
  type DesignToken,
  applyPatch,
  findVersion,
  formatDiff,
  parseVersionLog,
  stringifyVersionLog,
  versionLogPath,
  type ChangeSource,
  type VersionLog,
  checkRendered,
  checkTree,
  createForest,
  formatCheckReport,
  DISPLAYS,
  formatIssues,
  isBranch,
  PatchError,
  renderDocument,
  replaceTree,
  TreeDataError,
  validateDocument,
  type CheckReport,
  type DesignKit,
  type DisplayId,
  type Tree,
  type TreeNode,
  type ValidationResult,
} from '@tree-weaver/core';
import {
  detectFormat,
  diffDocuments,
  exportComponent,
  exportComponentDef,
  isNativeFramework,
  exportForest,
  exportTree,
  FORMATS,
  FormatError,
  formatFromFileName,
  getFormat,
  importDocument,
  parseData,
  toEnvelope,
  validateText,
  type ComponentFramework,
  type ComponentStyling,
  type FormatId,
  type TreeDocument,
} from '@tree-weaver/formats';
import { createStarterKit, kitFromFile, kitManifest } from '@tree-weaver/kits';
import { BLUEPRINTS, expandShorthand, expandShorthandDocument, getStarter, getTemplate, STARTERS, TEMPLATES } from '@tree-weaver/branches';
import type { Workspace } from './workspace';

/** What a tool hands back: text for the model, optional structured data and images. */
export interface ToolOutput {
  text: string;
  data?: Record<string, unknown>;
  images?: { data: string; mimeType: string; label: string }[];
}

/** A tool failure the agent can act on: the message says what to fix. */
export class ToolError extends Error {}

/** Where a document comes from: a file in the workspace, or the text itself. */
export interface Source {
  path?: string;
  document?: string;
  format?: FormatId;
}

interface Loaded {
  doc: TreeDocument;
  format: FormatId;
  path?: string;
  /** The document as read. */
  text: string;
}

export class Tools {
  constructor(readonly ws: Workspace) {}

  /* ---------------------------------------------------------------- helpers */

  private async text(src: Source): Promise<{ text: string; name?: string }> {
    if (src.path !== undefined && src.document !== undefined) throw new ToolError('Give either "path" or "document", not both');
    if (src.path !== undefined) return { text: await this.ws.read(src.path), name: src.path };
    if (src.document !== undefined) return { text: src.document };
    throw new ToolError('Give the document as "path" (a file in the workspace) or "document" (its text)');
  }

  private async load(src: Source): Promise<Loaded> {
    const { text, name } = await this.text(src);
    const format = src.format ?? detectFormat(text, name);
    try {
      return { doc: importDocument(text, format), format, path: src.path, text };
    } catch (err) {
      if (err instanceof FormatError || err instanceof TreeDataError) throw new ToolError(`${name ?? 'document'}: ${err.message}`);
      throw err;
    }
  }

  private serialize(doc: TreeDocument, format: FormatId): string {
    return doc.kind === 'forest' ? exportForest(doc.forest, format) : exportTree(doc.tree, format, doc.kits);
  }

  /** Write to `output` when given, else return the text in the result. */
  private async deliver(output: string | undefined, data: string, summary: string, extra: Record<string, unknown> = {}): Promise<ToolOutput> {
    if (output) {
      const written = await this.ws.write(output, data);
      return { text: `${summary}\nWrote ${written}.`, data: { ...extra, path: written } };
    }
    return { text: `${summary}\n\n${data}`, data: { ...extra, document: data } };
  }

  private async versions(path: string): Promise<VersionLog> {
    const logPath = versionLogPath(path);
    if (!(await this.ws.exists(logPath))) return parseVersionLog(null);
    try {
      return parseVersionLog(await this.ws.read(logPath), true);
    } catch (err) {
      throw new ToolError(`${logPath}: ${(err as Error).message}`);
    }
  }

  private async keepVersion(path: string, text: string, format: string, init: { name?: string; source?: ChangeSource; auto?: boolean }) {
    const { log, version } = addVersion(await this.versions(path), { ...init, document: text, format });
    await this.ws.write(versionLogPath(path), stringifyVersionLog(log));
    return version;
  }

  private versionRef(log: VersionLog, path: string, ref: string | undefined) {
    if (!ref) throw new ToolError('Give "version": an id, a name, "latest", or a number from list_versions');
    const v = findVersion(log, ref);
    if (!v) throw new ToolError(`No version "${ref}" of ${path}. Call list_versions to see them.`);
    return v;
  }

  /* ------------------------------------------------------------------ tools */

  async createTree(args: {
    path?: string;
    template?: string;
    starter?: string;
    shorthand?: unknown;
    name?: string;
    forest?: boolean;
    starterKit?: boolean;
    format?: FormatId;
    overwrite?: boolean;
  }): Promise<ToolOutput> {
    if ([args.template, args.starter, args.shorthand].filter((x) => x !== undefined).length > 1) throw new ToolError('Give one of "template", "starter" or "shorthand"');
    if (args.path && !args.overwrite && (await this.ws.exists(args.path))) {
      throw new ToolError(`${args.path} already exists. Edit it with patch_tree, or pass "overwrite": true to replace it`);
    }
    const format = args.format ?? (args.path ? formatFromFileName(args.path) : null) ?? 'json';
    const kits: DesignKit[] = args.starterKit === false ? [] : [createStarterKit()];
    let doc: TreeDocument;
    let warnings: ValidationResult['warnings'] = [];

    if (args.starter !== undefined) {
      const starter = getStarter(args.starter);
      if (!starter) throw new ToolError(`No starter "${args.starter}". Starters: ${STARTERS.map((t) => t.id).join(', ')}`);
      // A starter brings its own token kit; the Weaver Basic kit would only compete with it.
      doc = { kind: 'forest', forest: starter.create(args.name) };
    } else if (args.shorthand !== undefined) {
      const raw = typeof args.shorthand === 'string' ? parseShorthandText(args.shorthand) : args.shorthand;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(JSON.stringify(expandShorthandDocument(raw))) as Record<string, unknown>;
      } catch (err) {
        throw new ToolError(`The shorthand can't be read: ${(err as Error).message}`);
      }
      const tree = data.tree as Record<string, unknown> | undefined;
      if (args.name && tree && (!tree.name || tree.name === 'Untitled tree')) tree.name = args.name;
      const check = validateDocument(data);
      if (!check.valid) throw new ToolError(`The expanded document has errors:\n${formatIssues(check)}`);
      warnings = check.warnings;
      doc = importDocument(JSON.stringify(data), 'json');
      if (doc.kind === 'tree' && !doc.kits.length) doc = { ...doc, kits };
    } else {
      const id = args.template ?? 'blank';
      const template = getTemplate(id);
      if (!template) throw new ToolError(`No template "${id}". Templates: ${TEMPLATES.map((t) => t.id).join(', ')}`);
      doc = { kind: 'tree', tree: template.create(args.name), kits };
    }

    if (args.forest && doc.kind === 'tree') {
      const forest = createForest(args.name ?? doc.tree.name, [doc.tree]);
      forest.kits = doc.kits;
      doc = { kind: 'forest', forest };
    }
    if (doc.kind === 'forest' && !getFormat(format).forest) throw new ToolError(`${getFormat(format).label} holds one tree; use json, yaml or xml for a forest`);

    const data = this.serialize(doc, format);
    const tree = doc.kind === 'forest' ? doc.forest.trees[0] : doc.tree;
    const outline = tree ? outlineText(tree) : '';
    const note = warnings.length ? `\nWarnings:\n${formatIssues({ errors: [], warnings })}` : '';
    if (args.path) {
      const written = await this.ws.write(args.path, data);
      return {
        text: `Created ${doc.kind} "${doc.kind === 'forest' ? doc.forest.name : doc.tree.name}" in ${written}.${note}\n\n${outline}`,
        data: { path: written, kind: doc.kind, format, tree: tree && { id: tree.id, name: tree.name }, warnings },
      };
    }
    return { text: `${data}${note}`, data: { document: data, kind: doc.kind, format, warnings } };
  }

  async outline(args: Source & { tree?: string }): Promise<ToolOutput> {
    const { doc } = await this.load(args);
    const trees = args.tree === undefined ? treesOf(doc) : [pickTree(doc, args.tree)];
    const text = [
      doc.kind === 'forest' ? `forest "${doc.forest.name}"  #${doc.forest.id}` : '',
      ...trees.map((t) => outlineText(t)),
      'Paths (/1/0) and ids (#b_...) both work as "target" and "parent" in patch_tree.',
    ]
      .filter(Boolean)
      .join('\n');
    return { text, data: { trees: trees.map((t) => ({ id: t.id, name: t.name, root: outlineData(t.root, '/') })) } };
  }

  async patchTree(args: Source & { ops: unknown; tree?: string; dryRun?: boolean; output?: string; label?: string; keepVersion?: boolean }): Promise<ToolOutput> {
    const loaded = await this.load(args);
    const tree = pickTree(loaded.doc, args.tree);
    let ops = args.ops;
    if (typeof ops === 'string') {
      try {
        ops = parseData(ops);
      } catch (err) {
        throw new ToolError(`"ops" is not valid JSON or YAML: ${(err as Error).message}`);
      }
    }
    let result;
    try {
      result = applyPatch(tree.root, ops, { expandNode: (value, path) => expandShorthand(value, path) });
    } catch (err) {
      if (err instanceof PatchError || err instanceof TreeDataError) throw new ToolError(`${err.message}\nNothing was changed.`);
      throw err;
    }
    const updated: Tree = { ...tree, root: result.root, updatedAt: new Date().toISOString() };
    const next: TreeDocument =
      loaded.doc.kind === 'forest' ? { kind: 'forest', forest: { ...replaceTree(loaded.doc.forest, updated), updatedAt: updated.updatedAt } } : { ...loaded.doc, tree: updated };
    const lines = result.changes.map((c) => `  ${c.kind.padEnd(10)} ${c.path ?? '(removed)'}  #${c.id}`);
    const warn = result.warnings.length ? `\nWarnings:\n${formatIssues({ errors: [], warnings: result.warnings })}` : '';
    const summary = `${args.dryRun ? 'Would apply' : 'Applied'} ${result.changes.length} operation${result.changes.length === 1 ? '' : 's'}:\n${lines.join('\n')}${warn}`;
    const data = { changes: result.changes, warnings: result.warnings, tree: { id: tree.id, name: tree.name } };
    if (args.dryRun) return { text: `${summary}\n\nNothing was written.\n\n${outlineText(updated)}`, data: { ...data, dryRun: true } };

    const serialized = this.serialize(next, loaded.format);
    const output = args.output ?? loaded.path;
    if (output) {
      // Editing the file in place: keep what it was, so the change can be reviewed (diff_versions) and rolled back (restore_version).
      let versionNote = '';
      if (loaded.path && output === loaded.path && args.keepVersion !== false && serialized !== loaded.text) {
        const v = await this.keepVersion(loaded.path, loaded.text, loaded.format, { name: args.label ? `Before ${args.label}` : 'Before patch', source: 'agent', auto: true });
        versionNote = `\nSaved the previous file as version ${v.id} (restore_version to roll back).`;
      }
      const written = await this.ws.write(output, serialized);
      return { text: `${summary}\nWrote ${written}.${versionNote}\n\n${outlineText(updated)}`, data: { ...data, path: written } };
    }
    return { text: `${summary}\n\n${serialized}`, data: { ...data, document: serialized } };
  }

  async validate(args: Source & { strict?: boolean }): Promise<ToolOutput> {
    const { text, name } = await this.text(args);
    const format = args.format ?? detectFormat(text, name);
    let result: ValidationResult;
    if (format === 'json' || format === 'yaml') result = validateText(text, format);
    else {
      try {
        result = validateDocument(toEnvelope(importDocument(text, format)));
      } catch (err) {
        result = { valid: false, kind: null, errors: [{ severity: 'error', path: '$', message: (err as Error).message }], warnings: [], counts: { trees: 0, branches: 0, leaves: 0 } };
      }
    }
    if (args.strict && result.warnings.length) result = { ...result, valid: false };
    const c = result.counts;
    const head = `${result.valid ? 'Valid' : 'Invalid'}${result.kind ? ` ${result.kind}` : ''}: ${c.trees} tree(s), ${c.branches} branches, ${c.leaves} leaves; ${result.errors.length} error(s), ${result.warnings.length} warning(s).`;
    const issues = formatIssues(result);
    return { text: issues ? `${head}\n${issues}` : head, data: { ...result, format } };
  }

  async renderHtml(args: Source & { tree?: string; output?: string; kits?: string[] }): Promise<ToolOutput> {
    const { doc } = await this.load(args);
    const tree = pickTree(doc, args.tree);
    const kits = [...kitsOf(doc)];
    for (const file of args.kits ?? []) kits.push(kitFromFile(file, await this.ws.read(file)));
    const html = exportTree(tree, 'html', kits);
    return this.deliver(args.output, html, `HTML page for "${tree.name}" (${html.length} characters).`, { tree: { id: tree.id, name: tree.name } });
  }

  async exportComponent(
    args: Source & { framework: ComponentFramework; styling?: ComponentStyling; tree?: string; component?: string; name?: string; typescript?: boolean; outputDir?: string; kits?: string[] },
  ): Promise<ToolOutput> {
    const { doc } = await this.load(args);
    const kits = [...kitsOf(doc)];
    for (const file of args.kits ?? []) kits.push(kitFromFile(file, await this.ws.read(file)));
    const options = { framework: args.framework, styling: args.styling, kits, name: args.name, typescript: args.typescript };
    let source: string;
    let out;
    if (args.component !== undefined) {
      const def = componentRef(doc, args.component);
      source = `component "${def.name}"`;
      out = exportComponentDef(def, options);
    } else {
      const tree = pickTree(doc, args.tree);
      source = `"${tree.name}"`;
      out = exportComponent(tree, options);
    }
    const native = isNativeFramework(out.framework);
    const summary = `${out.name}: ${source} as ${args.framework}${native ? '' : ` with ${out.styling === 'tailwind' ? 'Tailwind classes' : 'a CSS file'}`} (${out.files.length} file${out.files.length === 1 ? '' : 's'}, entry ${out.entry}).`;
    const meta = { name: out.name, framework: out.framework, styling: out.styling, entry: out.entry };
    if (args.outputDir) {
      const dir = args.outputDir.replace(/[\\/]+$/, '');
      const written: string[] = [];
      for (const f of out.files) written.push(await this.ws.write(`${dir}/${f.path}`, f.contents));
      return { text: `${summary}\nWrote ${written.join(', ')}.`, data: { ...meta, files: written } };
    }
    const text = out.files.map((f) => `===== ${f.path} =====\n${f.contents}`).join('\n');
    return { text: `${summary}\n\n${text}`, data: { ...meta, files: out.files.map((f) => f.path) } };
  }

  async convert(args: Source & { to: FormatId; tree?: string; output?: string }): Promise<ToolOutput> {
    const { doc, format } = await this.load(args);
    const to = args.to;
    let data: string;
    let what: string;
    if (doc.kind === 'forest' && getFormat(to).forest && args.tree === undefined) {
      data = exportForest(doc.forest, to);
      what = `forest "${doc.forest.name}"`;
    } else {
      const tree = pickTree(doc, args.tree);
      data = exportTree(tree, to, kitsOf(doc));
      what = `tree "${tree.name}"`;
    }
    const lossy = getFormat(to).lossless ? '' : ` ${getFormat(to).label} keeps the content but not every style or attribute.`;
    return this.deliver(args.output, data, `Converted ${what} from ${getFormat(format).label} to ${getFormat(to).label}.${lossy}`, { from: format, to });
  }

  async checkLayout(args: Source & { tree?: string; render?: boolean; displays?: DisplayId[]; kits?: string[] }): Promise<ToolOutput> {
    const { doc } = await this.load(args);
    const trees = args.tree === undefined ? treesOf(doc) : [pickTree(doc, args.tree)];
    const kits = [...kitsOf(doc)];
    for (const file of args.kits ?? []) kits.push(kitFromFile(file, await this.ws.read(file)));
    let note = '';
    const reports: CheckReport[] = [];
    let browser: Browser | null = null;
    if (args.render !== false) {
      try {
        browser = await launchBrowser();
      } catch (err) {
        if (args.render === true) throw err;
        note = `\nRendered checks skipped: ${(err as Error).message}`;
      }
    }
    try {
      for (const tree of trees) reports.push(browser ? await checkRendered(tree, { browser, kits, displays: args.displays }) : checkTree(tree));
    } finally {
      await browser?.close();
    }
    const ok = reports.every((r) => r.ok);
    return { text: `${reports.map(formatCheckReport).join('\n\n')}${note}`, data: { ok, rendered: !!browser, trees: reports } };
  }

  async screenshot(args: Source & { tree?: string; displays?: DisplayId[]; fullPage?: boolean; kits?: string[] }): Promise<ToolOutput> {
    const { doc } = await this.load(args);
    const tree = pickTree(doc, args.tree);
    const kits = [...kitsOf(doc)];
    for (const file of args.kits ?? []) kits.push(kitFromFile(file, await this.ws.read(file)));
    const html = renderDocument(tree, { kits });
    const wanted = args.displays?.length ? args.displays : (['lg', 'tablet', 'mobile-portrait'] as DisplayId[]);
    const browser = await launchBrowser();
    try {
      const images: NonNullable<ToolOutput['images']> = [];
      const report: Record<string, unknown>[] = [];
      for (const id of wanted) {
        const display = DISPLAYS.find((d) => d.id === id);
        if (!display) throw new ToolError(`No display "${id}". Displays: ${DISPLAYS.map((d) => d.id).join(', ')}`);
        const page = await browser.newPage({ viewport: { width: display.width, height: display.height }, javaScriptEnabled: false });
        try {
          await page.setContent(html, { waitUntil: 'load', timeout: 15000 }).catch(() => undefined);
          const metrics = await page.evaluate(
            '({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })',
          ) as { width: number; height: number };
          const shot = await page.screenshot({ fullPage: args.fullPage !== false, type: 'png' });
          images.push({ data: Buffer.from(shot).toString('base64'), mimeType: 'image/png', label: `${display.label} (${display.width}×${display.height})` });
          const overflow = metrics.width > display.width;
          report.push({ display: id, width: display.width, height: display.height, pageHeight: metrics.height, horizontalOverflow: overflow });
        } finally {
          await page.close();
        }
      }
      const lines = report.map(
        (r) => `- ${r.display}: ${r.width}px wide, page ${r.pageHeight}px tall${r.horizontalOverflow ? ' — content overflows sideways; something is wider than the screen' : ''}`,
      );
      return { text: `Screenshots of "${tree.name}":\n${lines.join('\n')}`, data: { tree: { id: tree.id, name: tree.name }, displays: report }, images };
    } finally {
      await browser.close();
    }
  }

  catalog(args: { kind: 'blueprints' | 'templates' | 'starters' | 'displays' | 'formats' }): ToolOutput {
    switch (args.kind) {
      case 'blueprints': {
        const list = BLUEPRINTS.map(({ id, label, category, description }) => ({ id, label, category, description }));
        return {
          text: `Blueprints (write "@<id>" or {"use": "<id>"} in shorthand and patch nodes):\n${list.map((b) => `- ${b.id} [${b.category}]: ${b.description}`).join('\n')}`,
          data: { blueprints: list },
        };
      }
      case 'templates': {
        const list = TEMPLATES.map(({ id, label, description }) => ({ id, label, description }));
        return { text: `Templates (create_tree "template"):\n${list.map((t) => `- ${t.id}: ${t.description}`).join('\n')}`, data: { templates: list } };
      }
      case 'starters': {
        const list = STARTERS.map(({ id, label, description, trees, components }) => ({ id, label, description, trees, components }));
        return {
          text: `Starter forests (create_tree "starter"), each with design tokens and components:\n${list.map((t) => `- ${t.id}: ${t.description}. Trees: ${t.trees.join(', ')}. Components: ${t.components.join(', ')}`).join('\n')}`,
          data: { starters: list },
        };
      }
      case 'displays': {
        const list = DISPLAYS.map((d) => ({ id: d.id, label: d.label, width: d.width, height: d.height, media: d.media, inherits: d.inherits }));
        return {
          text: `Displays (style keys). "lg" is the base; the others override it:\n${list.map((d) => `- ${d.id}: ${d.label}, ${d.width}×${d.height}${d.media ? `, ${d.media}` : ''}${d.inherits.length ? `, inherits ${d.inherits.join(' → ')}` : ''}`).join('\n')}`,
          data: { displays: list },
        };
      }
      case 'formats': {
        const list = FORMATS.map((f) => ({ ...f }));
        return { text: `Formats:\n${list.map((f) => `- ${f.id} (.${f.extensions.join(', .')}): ${f.forest ? 'forest or tree' : 'one tree'}${f.lossless ? '' : ', lossy'}`).join('\n')}`, data: { formats: list } };
      }
    }
  }

  async listVersions(args: { path: string }): Promise<ToolOutput> {
    const log = await this.versions(args.path);
    const list = log.versions.map(({ document: _, ...v }, i) => ({ number: i + 1, ...v }));
    if (!list.length) return { text: `No versions of ${args.path} yet. save_version saves one; patch_tree saves one before it changes the file.`, data: { versions: [] } };
    const lines = list.map((v) => `${String(v.number).padStart(3)}  ${v.createdAt}  ${v.name}${v.auto ? ' (automatic)' : ''}  ${v.id}`);
    return { text: `Versions of ${args.path}, oldest first:\n${lines.join('\n')}`, data: { versions: list } };
  }

  async saveVersion(args: { path: string; name?: string }): Promise<ToolOutput> {
    const loaded = await this.load({ path: args.path });
    const v = await this.keepVersion(args.path, loaded.text, loaded.format, { name: args.name, source: 'agent' });
    return { text: `Saved ${args.path} as "${v.name}" (${v.id}).`, data: { id: v.id, name: v.name, createdAt: v.createdAt } };
  }

  async diffVersions(args: { path: string; version?: string; against?: string }): Promise<ToolOutput> {
    const log = await this.versions(args.path);
    const from = args.version ? this.versionRef(log, args.path, args.version) : log.versions[log.versions.length - 1];
    if (!from) throw new ToolError(`${args.path} has no saved versions to compare with`);
    const before = importDocument(from.document, from.format as FormatId);
    const to = args.against ? this.versionRef(log, args.path, args.against) : null;
    const after = to ? importDocument(to.document, to.format as FormatId) : (await this.load({ path: args.path })).doc;
    const diff = diffDocuments(before, after);
    const target = to ? `"${to.name}"` : `the current ${args.path}`;
    return { text: `Changes from "${from.name}" (${from.id}) to ${target}:\n${formatDiff(diff)}`, data: { from: { id: from.id, name: from.name }, ...diff } };
  }

  async restoreVersion(args: { path: string; version: string }): Promise<ToolOutput> {
    const log = await this.versions(args.path);
    const v = this.versionRef(log, args.path, args.version);
    if (await this.ws.exists(args.path)) {
      const current = await this.ws.read(args.path);
      if (current !== v.document) await this.keepVersion(args.path, current, detectFormat(current, args.path), { name: `Before restoring "${v.name}"`, source: 'restore', auto: true });
    }
    const written = await this.ws.write(args.path, v.document);
    return { text: `Restored "${v.name}" to ${written}. The file as it was is saved as a version, so this can be undone too.`, data: { restored: { id: v.id, name: v.name }, path: written } };
  }

  async diff(args: { before: Source; after: Source }): Promise<ToolOutput> {
    const a = await this.load(args.before ?? {});
    const b = await this.load(args.after ?? {});
    const diff = diffDocuments(a.doc, b.doc);
    return { text: formatDiff(diff), data: { ...diff } };
  }

  async listTokens(args: Source): Promise<ToolOutput> {
    const { doc } = await this.load(args);
    const tokens = themeTokens(kitsOf(doc));
    const text = tokens.length
      ? `Design tokens (${tokens.length}). Use them as var(--name) in styles: exports name them (DesignTokens.x in SwiftUI/Flutter, theme utilities in Tailwind).\n${tokens
          .map((t) => `  ${t.name}: ${t.value}${t.resolved !== t.value ? ` (= ${t.resolved})` : ''}  [${t.kind}${t.edited ? ', edited' : ''}]`)
          .join('\n')}`
      : 'No design tokens. Add some with set_tokens, or a kit with :root { --name: value }.';
    return { text, data: { tokens } };
  }

  async setTokens(args: Source & { tokens?: DesignToken[]; reset?: string[]; output?: string; keepVersion?: boolean }): Promise<ToolOutput> {
    const loaded = await this.load(args);
    let kits = kitsOf(loaded.doc);
    const dash = (n: string) => (n.startsWith('--') ? n : `--${n}`);
    try {
      for (const name of args.reset ?? []) kits = resetToken(kits, dash(name));
      for (const t of args.tokens ?? []) kits = setToken(kits, { ...t, name: dash(t.name) });
    } catch (err) {
      throw new ToolError(`${(err as Error).message}\nNothing was changed.`);
    }
    const next: TreeDocument = loaded.doc.kind === 'forest' ? { kind: 'forest', forest: { ...loaded.doc.forest, kits, updatedAt: new Date().toISOString() } } : { ...loaded.doc, kits };
    const serialized = this.serialize(next, loaded.format);
    const tokens = themeTokens(kits);
    const output = args.output ?? loaded.path;
    const list = tokens.map((t) => `  ${t.name}: ${t.value}  [${t.kind}${t.edited ? ', edited' : ''}]`).join('\n');
    if (!output) return { text: `${serialized}`, data: { tokens, document: serialized } };
    let versionNote = '';
    if (loaded.path && output === loaded.path && args.keepVersion !== false && serialized !== loaded.text) {
      const v = await this.keepVersion(loaded.path, loaded.text, loaded.format, { name: 'Before tokens', source: 'agent', auto: true });
      versionNote = `\nSaved the previous file as version ${v.id} (restore_version to roll back).`;
    }
    const written = await this.ws.write(output, serialized);
    return { text: `Wrote ${written}.${versionNote}\nTokens:\n${list}`, data: { tokens, path: written } };
  }

  async listComponents(args: Source): Promise<ToolOutput> {
    const { doc } = await this.load(args);
    const forest = doc.kind === 'forest' ? doc.forest : undefined;
    const components = (forest?.components ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      ...(c.description ? { description: c.description } : {}),
      props: componentProps(c).map((p) => ({ name: p.name, type: p.type, default: p.default, ...(p.options ? { options: p.options } : {}) })),
      variants: c.variants.map((v) => v.name),
      instances: forest ? instancesOf(forest, c.id).length : 0,
    }));
    const text = components.length
      ? `Components (${components.length}). Insert one with insert_component; its props fill {{placeholders}} and variants pick style overrides per display.\n${components
          .map(
            (c) =>
              `  ${c.name} (${c.id}), ${c.instances} in use\n    props: ${c.props.map((p) => `${p.name}: ${p.type}${p.options ? ` [${p.options.join('|')}]` : ''}${p.default ? ` = ${JSON.stringify(p.default)}` : ''}`).join(', ') || 'none'}\n    variants: ${c.variants.join(', ') || 'none'}`,
          )
          .join('\n')}`
      : doc.kind === 'forest'
        ? 'No components. Save a branch as one with save_component.'
        : 'This is a single tree; components live in forests.';
    return { text, data: { components } };
  }

  async saveComponent(args: Source & { branch: string; name?: string; description?: string; tree?: string; output?: string; keepVersion?: boolean }): Promise<ToolOutput> {
    const loaded = await this.load(args);
    const forest = forestOf(loaded.doc);
    const tree = pickTree(loaded.doc, args.tree);
    const { node } = resolveRef(tree.root, args.branch);
    if (!isBranch(node)) throw new ToolError(`"${args.branch}" is a leaf; save a branch`);
    const saved = saveComponent({ ...forest, updatedAt: new Date().toISOString() }, tree.id, node.id, args.name ?? node.name ?? 'Component', args.description ? { description: args.description } : {});
    if (!saved) throw new ToolError(`Could not find "${args.branch}" in "${tree.name}"`);
    const def = saved.component;
    const props = componentProps(def);
    const summary = `Saved component "${def.name}" (${def.id})${props.length ? ` with props ${props.map((p) => `${p.name}: ${p.type}`).join(', ')}` : ''}.${
      node.id !== tree.root.id ? ` The branch is now its first instance (${node.id}).` : ''
    }${props.length ? '' : ' Add props by putting {{name}} placeholders in its text, attributes or classes (patch the component tree, or edit it in the editor).'}`;
    return this.writeForest(loaded, saved.forest, args, `Before saving "${def.name}"`, summary, { component: { id: def.id, name: def.name, props: props.map((p) => p.name) } });
  }

  async insertComponent(
    args: Source & { component: string; parent?: string; index?: number; props?: Record<string, string>; variants?: Partial<Record<DisplayId, string>>; tree?: string; output?: string; keepVersion?: boolean },
  ): Promise<ToolOutput> {
    const loaded = await this.load(args);
    const forest = forestOf(loaded.doc);
    const def = componentRef(loaded.doc, args.component);
    const tree = pickTree(loaded.doc, args.tree);
    const parent = resolveRef(tree.root, args.parent).node;
    if (!isBranch(parent)) throw new ToolError(`"${args.parent}" is a leaf; insert into a branch`);
    const known = componentProps(def).map((p) => p.name);
    const unknown = Object.keys(args.props ?? {}).filter((p) => !known.includes(p));
    if (unknown.length) throw new ToolError(`"${def.name}" has no prop ${unknown.join(', ')}. Props: ${known.join(', ') || 'none'}`);
    const variants: NonNullable<ComponentInstance['variants']> = {};
    for (const [display, name] of Object.entries(args.variants ?? {})) {
      if (!(DISPLAY_IDS as readonly string[]).includes(display)) throw new ToolError(`Unknown display "${display}". Displays: ${DISPLAY_IDS.join(', ')}`);
      if (name && name !== '-' && !def.variants.some((v) => v.name === name)) throw new ToolError(`"${def.name}" has no variant "${name}". Variants: ${def.variants.map((v) => v.name).join(', ') || 'none'}`);
      if (name) variants[display as DisplayId] = name;
    }
    const inst = instantiateComponent(def, args.props, variants);
    const root = insertNode(tree.root, parent.id, inst, args.index);
    const next: Forest = { ...forest, trees: forest.trees.map((t) => (t.id === tree.id ? { ...t, root } : t)), updatedAt: new Date().toISOString() };
    const summary = `Inserted "${def.name}" as ${inst.id} into ${parent.name ?? `<${parent.tag}>`} (${parent.id}).`;
    return this.writeForest(loaded, next, args, `Before inserting "${def.name}"`, summary, { id: inst.id, component: def.id });
  }

  /** Write a changed forest back (in place unless `output`), saving a version first. */
  private async writeForest(loaded: Loaded, forest: Forest, args: { output?: string; keepVersion?: boolean }, versionName: string, summary: string, extra: Record<string, unknown>): Promise<ToolOutput> {
    const serialized = this.serialize({ kind: 'forest', forest }, loaded.format);
    const output = args.output ?? loaded.path;
    if (!output) return { text: `${summary}\n\n${serialized}`, data: { ...extra, document: serialized } };
    let versionNote = '';
    if (loaded.path && output === loaded.path && args.keepVersion !== false && serialized !== loaded.text) {
      const v = await this.keepVersion(loaded.path, loaded.text, loaded.format, { name: versionName, source: 'agent', auto: true });
      versionNote = `\nSaved the previous file as version ${v.id} (restore_version to roll back).`;
    }
    const written = await this.ws.write(output, serialized);
    return { text: `${summary}\nWrote ${written}.${versionNote}`, data: { ...extra, path: written } };
  }

  async kitManifest(args: { paths: string[] }): Promise<ToolOutput> {
    if (!args.paths.length) throw new ToolError('Give at least one .css file or document');
    const kits: DesignKit[] = [];
    for (const path of args.paths) {
      if (/\.css$/i.test(path)) kits.push(kitFromFile(path, await this.ws.read(path)));
      else kits.push(...kitsOf((await this.load({ path })).doc));
    }
    const manifest = kitManifest(kits);
    const text = `Classes (${manifest.classes.length}): ${manifest.classes.join(' ') || 'none'}\nTokens (${manifest.tokens.length}): ${manifest.tokens.map((t) => `${t.name}: ${t.value}`).join('; ') || 'none'}\nUse these classes instead of inline styles where they fit.`;
    return { text, data: manifest as unknown as Record<string, unknown> };
  }
}

/* -------------------------------------------------------------- tree helpers */

function treesOf(doc: TreeDocument): Tree[] {
  return doc.kind === 'forest' ? doc.forest.trees : [doc.tree];
}

function kitsOf(doc: TreeDocument): DesignKit[] {
  return doc.kind === 'forest' ? doc.forest.kits : doc.kits;
}

function forestOf(doc: TreeDocument): Forest {
  if (doc.kind !== 'forest') throw new ToolError('Components live in forests, and this document is a single tree. Convert it to a forest first (json, yaml or xml with a "forest").');
  return doc.forest;
}

function componentRef(doc: TreeDocument, ref: string) {
  const components = doc.kind === 'forest' ? (doc.forest.components ?? []) : [];
  const def = findComponent(components, ref);
  if (!def) throw new ToolError(`No component "${ref}". ${components.length ? `Components: ${components.map((c) => `${c.name} (${c.id})`).join(', ')}` : 'The document has none; save one with save_component.'}`);
  return def;
}

/** A tree by id, name (any case) or 1-based number; the first tree when not given. */
export function pickTree(doc: TreeDocument, ref: string | undefined): Tree {
  const trees = treesOf(doc);
  if (!trees.length) throw new ToolError('The forest has no trees');
  if (ref === undefined) return trees[0];
  const lower = ref.toLowerCase();
  const found = trees.find((t) => t.id === ref) ?? trees.find((t) => t.name.toLowerCase() === lower) ?? (/^\d+$/.test(ref) ? trees[Number(ref) - 1] : undefined);
  if (!found) throw new ToolError(`No tree "${ref}". Trees: ${trees.map((t, i) => `${i + 1}. ${t.name} (${t.id})`).join(', ')}`);
  return found;
}

function parseShorthandText(text: string): unknown {
  try {
    return parseData(text);
  } catch (err) {
    throw new ToolError(`"shorthand" is not valid JSON or YAML: ${(err as Error).message}`);
  }
}

interface OutlineNode {
  path: string;
  id: string;
  kind: 'branch' | 'leaf';
  tag?: string;
  name?: string;
  classes?: string[];
  type?: string;
  value?: string;
  children?: OutlineNode[];
}

function outlineData(node: TreeNode, path: string): OutlineNode {
  if (!isBranch(node)) return { path, id: node.id, kind: 'leaf', type: node.type, value: node.value };
  const out: OutlineNode = { path, id: node.id, kind: 'branch', tag: node.tag };
  if (node.name) out.name = node.name;
  if (node.classes.length) out.classes = node.classes;
  out.children = node.children.map((c, i) => outlineData(c, `${path === '/' ? '' : path}/${i}`));
  return out;
}

/** The tree as indented lines: path, tag or text, classes, name and id. */
export function outlineText(tree: Tree): string {
  const lines = [`tree "${tree.name}"  #${tree.id}`];
  const walk = (node: TreeNode, path: string, depth: number) => {
    const pad = '  '.repeat(depth);
    if (!isBranch(node)) {
      const value = node.value.replace(/\s+/g, ' ');
      const shown = value.length > 60 ? `${value.slice(0, 59)}…` : value;
      lines.push(`${pad}${path}  ${node.type === 'text' ? JSON.stringify(shown) : `${node.type} ${shown}`}  #${node.id}`);
      return;
    }
    lines.push(`${pad}${path}  <${node.tag}>${node.classes.map((c) => `.${c}`).join('')}${node.name ? ` "${node.name}"` : ''}  #${node.id}`);
    node.children.forEach((c, i) => walk(c, `${path === '/' ? '' : path}/${i}`, depth + 1));
  };
  walk(tree.root, '/', 1);
  return lines.join('\n');
}

/* ------------------------------------------------------------------ browser */

interface Browser {
  newPage(opts: { viewport: { width: number; height: number }; javaScriptEnabled: boolean }): Promise<Page>;
  close(): Promise<void>;
}
interface Page {
  setContent(html: string, opts: { waitUntil: 'load'; timeout: number }): Promise<void>;
  evaluate<T = unknown>(expr: string): Promise<T>;
  screenshot(opts: { fullPage: boolean; type: 'png' }): Promise<Uint8Array>;
  close(): Promise<void>;
}

/** Launch Chromium through Playwright, which is an optional peer dependency. */
async function launchBrowser(): Promise<Browser> {
  let playwright: { chromium: { launch(opts: Record<string, unknown>): Promise<Browser> } } | undefined;
  try {
    playwright = (await import('playwright' as string)) as typeof playwright;
  } catch {
    try {
      // Also find a globally installed Playwright (NODE_PATH).
      playwright = createRequire(import.meta.url)('playwright') as typeof playwright;
    } catch {
      playwright = undefined;
    }
  }
  if (!playwright) {
    throw new ToolError('Screenshots need Playwright. Install it next to the server ("npm i playwright" and "npx playwright install chromium"), or use render_html instead');
  }
  const executablePath = process.env.TW_CHROMIUM_PATH || undefined;
  try {
    return await playwright.chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  } catch (err) {
    throw new ToolError(`Chromium did not start: ${(err as Error).message.split('\n')[0]}. Run "npx playwright install chromium", or set TW_CHROMIUM_PATH to a Chrome binary`);
  }
}
