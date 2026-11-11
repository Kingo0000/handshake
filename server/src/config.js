const PAYPAL_BASES = {
  sandbox: 'https://api-m.sandbox.paypal.com',
  live: 'https://api-m.paypal.com',
};

export function loadConfig(env = process.env) {
  const paypalEnv = env.PAYPAL_ENV || 'sandbox';
  if (!PAYPAL_BASES[paypalEnv]) throw new Error(`PAYPAL_ENV must be "sandbox" or "live", got "${paypalEnv}"`);
  return {
    port: Number(env.PORT) || 8787,
    isProduction: env.NODE_ENV === 'production',
    dataPath: env.DATA_PATH || new URL('../data/db.json', import.meta.url).pathname,
    evidencePath: env.EVIDENCE_PATH || new URL('../data/evidence', import.meta.url).pathname,
    openaiApiKey: env.OPENAI_API_KEY || '',
    openaiModel: env.OPENAI_MODEL || undefined,
    paypal: {
      env: paypalEnv,
      baseUrl: PAYPAL_BASES[paypalEnv],
      clientId: env.PAYPAL_CLIENT_ID || '',
      clientSecret: env.PAYPAL_CLIENT_SECRET || '',
    },
  };
}

export function missingPaypalConfig(config) {
  const missing = [];
  if (!config.paypal.clientId) missing.push('PAYPAL_CLIENT_ID');
  if (!config.paypal.clientSecret) missing.push('PAYPAL_CLIENT_SECRET');
  return missing;
}
