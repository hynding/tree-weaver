import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

/**
 * The folder the server may read and write. Every path a tool receives is resolved
 * against it, and paths that lead outside it (with `..`, an absolute path or a
 * symlink) are refused, so an agent can't touch files the user didn't hand over.
 */
export class Workspace {
  readonly root: string;

  constructor(
    root: string,
    readonly readOnly = false,
  ) {
    this.root = resolve(root);
  }

  /** The absolute path for `path`, after checking it stays inside the root. */
  async resolve(path: string): Promise<string> {
    if (typeof path !== 'string' || !path.trim()) throw new Error('The path is empty');
    const full = resolve(this.root, path);
    if (!inside(this.root, full)) throw new Error(`"${path}" is outside the workspace (${this.root})`);
    // Follow symlinks for the deepest part of the path that exists.
    let probe = full;
    for (;;) {
      try {
        const real = await realpath(probe);
        const realRoot = await realpath(this.root);
        if (!inside(realRoot, real)) throw new Error(`"${path}" is outside the workspace (${this.root})`);
        break;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        const up = dirname(probe);
        if (up === probe) break;
        probe = up;
      }
    }
    return full;
  }

  /** `path` as shown to the agent: relative to the root. */
  display(full: string): string {
    return relative(this.root, full) || '.';
  }

  async read(path: string): Promise<string> {
    const full = await this.resolve(path);
    try {
      return await readFile(full, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`${path}: no such file in the workspace`);
      throw err;
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await stat(await this.resolve(path));
      return true;
    } catch {
      return false;
    }
  }

  async write(path: string, data: string): Promise<string> {
    if (this.readOnly) throw new Error('The server was started with --read-only; return the document instead of writing it (leave out the output path)');
    const full = await this.resolve(path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, data, 'utf8');
    return this.display(full);
  }
}

function inside(root: string, path: string): boolean {
  if (path === root) return true;
  const rel = relative(root, path);
  return !!rel && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel);
}
