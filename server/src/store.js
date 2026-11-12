// JSON file store for the prototype. Writes are serialized so concurrent
// requests can't interleave and lose an update.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const EMPTY = { milestones: [] };

export function createStore(path) {
  let queue = Promise.resolve();

  async function read() {
    try {
      return JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return structuredClone(EMPTY);
      throw error;
    }
  }

  async function write(state) {
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(state, null, 2));
    await rename(temp, path);
  }

  // Runs fn(state) under the write lock and persists the result.
  function update(fn) {
    const run = queue.then(async () => {
      const state = await read();
      const result = await fn(state);
      await write(state);
      return result;
    });
    queue = run.catch(() => {});
    return run;
  }

  return { read, update };
}

// Vercel Blob store for serverless hosting, where the filesystem does not survive between requests.
// Every write is a new immutable blob, and a read lists the newest one, so a CDN copy is never stale.
export function createBlobStore({ prefix = 'db/', keep = 10 } = {}) {
  let queue = Promise.resolve();
  let blob;
  const sdk = () => (blob ??= import('@vercel/blob'));

  async function versions() {
    const { list } = await sdk();
    const { blobs } = await list({ prefix });
    return blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  }

  async function read() {
    const [latest] = await versions();
    if (!latest) return structuredClone(EMPTY);
    const response = await fetch(latest.url);
    if (!response.ok) throw new Error(`Could not read the store (${response.status})`);
    return response.json();
  }

  async function write(state) {
    const { put, del } = await sdk();
    await put(`${prefix}state.json`, JSON.stringify(state), { access: 'public', addRandomSuffix: true, contentType: 'application/json' });
    const stale = (await versions()).slice(keep);
    if (stale.length) await del(stale.map((b) => b.url)).catch(() => {});
  }

  function update(fn) {
    const run = queue.then(async () => {
      const state = await read();
      const result = await fn(state);
      await write(state);
      return result;
    });
    queue = run.catch(() => {});
    return run;
  }

  return { read, update };
}
