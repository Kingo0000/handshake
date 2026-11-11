import { createAgent } from './src/agent.js';
import { createApp } from './src/app.js';
import { createInspector } from './src/browser.js';
import { loadConfig, missingPaypalConfig } from './src/config.js';
import { createPayPal } from './src/paypal.js';
import { createStore } from './src/store.js';

const config = loadConfig();
const missing = missingPaypalConfig(config);
if (missing.length && config.isProduction) throw new Error(`Missing ${missing.join(', ')}`);

const app = createApp({
  config,
  store: createStore(config.dataPath),
  paypal: createPayPal(config.paypal),
  agent: createAgent({ apiKey: config.openaiApiKey, model: config.openaiModel, evidenceDir: config.evidencePath, inspector: createInspector(config.evidencePath) }),
});

app.listen(config.port, () => {
  console.log(`Handshake API on http://localhost:${config.port} (PayPal ${config.paypal.env})`);
  if (!config.openaiApiKey) console.warn('AI is not configured yet: set OPENAI_API_KEY in .env');
  if (missing.length) console.warn(`PayPal is not configured yet: copy .env.example to .env and set ${missing.join(', ')}`);
});
