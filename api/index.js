// Vercel entry: the same Express app, with blob storage for data and screenshots,
// and Chromium for serverless functions (see browser.js).
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { head, put } from '@vercel/blob';
import { createAgent } from '../server/src/agent.js';
import { createApp } from '../server/src/app.js';
import { createInspector } from '../server/src/browser.js';
import { loadConfig } from '../server/src/config.js';
import { createPayPal } from '../server/src/paypal.js';
import { createBlobStore } from '../server/src/store.js';

const config = loadConfig({ ...process.env, EVIDENCE_PATH: '/tmp/evidence' });

// Screenshots are taken to /tmp, then copied to blob storage so later requests can show them.
const local = createInspector(config.evidencePath);
const inspector = {
  async inspect(url, viewport) {
    const facts = await local.inspect(url, viewport);
    const image = await readFile(join(config.evidencePath, facts.screenshot));
    await put(`evidence/${facts.screenshot}`, image, { access: 'public', addRandomSuffix: false, contentType: 'image/png' });
    return facts;
  },
};

export default createApp({
  config,
  store: createBlobStore(),
  paypal: createPayPal(config.paypal),
  agent: createAgent({ apiKey: config.openaiApiKey, model: config.openaiModel, evidenceDir: config.evidencePath, inspector }),
  evidenceUrl: async (name) => (await head(`evidence/${name}`)).url,
});
