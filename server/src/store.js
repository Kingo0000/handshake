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
