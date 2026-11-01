import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import express from 'express';
import { missingPaypalConfig } from './config.js';
import { SUPPORTED_CURRENCIES, fromCents, planRelease, toCents } from './money.js';
import { PayPalError, authorizationFromOrder } from './paypal.js';

const DIST = new URL('../../dist', import.meta.url).pathname;

class NotFound extends Error {}

export function createApp({ config, store, paypal }) {
  const app = express();
  app.use(express.json({ limit: '100kb' }));

  async function findMilestone(id) {
    const state = await store.read();
    const milestone = state.milestones.find((m) => m.id === id);
    if (!milestone) throw new NotFound(`No milestone ${id}`);
    return milestone;
  }

  function saveMilestone(id, changes, event) {
    return store.update((state) => {
      const milestone = state.milestones.find((m) => m.id === id);
      if (!milestone) throw new NotFound(`No milestone ${id}`);
      Object.assign(milestone, changes, { updatedAt: new Date().toISOString() });
      if (event) milestone.events.push({ at: new Date().toISOString(), ...event });
      return milestone;
    });
  }

  function requirePaypal() {
    const missing = missingPaypalConfig(config);
    if (missing.length) throw new RangeError(`PayPal is not configured: set ${missing.join(', ')} in .env`);
  }

  app.get('/api/config', (_req, res) => {
    res.json({
      paypalEnv: config.paypal.env,
      paypalClientId: config.paypal.clientId,
      paypalConfigured: missingPaypalConfig(config).length === 0,
      currencies: SUPPORTED_CURRENCIES,
    });
  });

  app.get('/api/milestones', async (_req, res) => {
    const state = await store.read();
    res.json(state.milestones.toReversed());
  });

  app.post('/api/milestones', async (req, res) => {
    const title = String(req.body?.title || '').trim().slice(0, 120);
    const currency = String(req.body?.currency || 'USD').toUpperCase();
    if (!title) throw new RangeError('Give the milestone a title');
    if (!SUPPORTED_CURRENCIES.includes(currency)) throw new RangeError(`Currency must be one of ${SUPPORTED_CURRENCIES.join(', ')}`);
    const cents = toCents(req.body?.amount);
    if (cents < 100) throw new RangeError('Milestones must be at least 1.00');
    const now = new Date().toISOString();
    const milestone = {
      id: randomUUID(),
      title,
      amount: fromCents(cents),
      currency,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      events: [{ at: now, type: 'created' }],
    };
    await store.update((state) => { state.milestones.push(milestone); });
    res.status(201).json(milestone);
  });

  // Step 1 of funding: PayPal order with intent AUTHORIZE. The buyer approves it in the PayPal popup.
  app.post('/api/milestones/:id/order', async (req, res) => {
    requirePaypal();
    const milestone = await findMilestone(req.params.id);
    if (!['draft', 'awaiting_payment'].includes(milestone.status)) throw new RangeError(`Milestone is already ${milestone.status}`);
    const order = await paypal.createAuthorizeOrder({
      amount: milestone.amount,
      currency: milestone.currency,
      description: milestone.title,
      referenceId: milestone.id,
    });
    await saveMilestone(milestone.id, { status: 'awaiting_payment', orderId: order.id }, { type: 'order_created', orderId: order.id });
    res.json({ id: order.id });
  });

  // Step 2 of funding: after buyer approval, place the hold. Money stays on the client's account.
  app.post('/api/milestones/:id/authorize', async (req, res) => {
    requirePaypal();
    const milestone = await findMilestone(req.params.id);
    if (milestone.status === 'funded') return res.json(milestone);
    if (milestone.status !== 'awaiting_payment' || !milestone.orderId) throw new RangeError('Create a PayPal order for this milestone first');
    const order = await paypal.authorizeOrder(milestone.orderId, { requestId: `authorize-${milestone.id}` });
    const authorization = authorizationFromOrder(order);
    if (!authorization) throw new RangeError(`PayPal did not return an authorization (order status ${order.status})`);
    const updated = await saveMilestone(milestone.id, {
      status: 'funded',
      authorizationId: authorization.id,
      authorizationExpiresAt: authorization.expiration_time,
    }, { type: 'funded', authorizationId: authorization.id, paypalStatus: authorization.status });
    res.json(updated);
  });

  // Full or partial release. Partial captures use final_capture so PayPal returns the rest to the client.
  app.post('/api/milestones/:id/release', async (req, res) => {
    requirePaypal();
    const milestone = await findMilestone(req.params.id);
    const plan = planRelease(milestone, req.body?.amount);
    const capture = await paypal.captureAuthorization(milestone.authorizationId, {
      amount: plan.amount,
      currency: milestone.currency,
      finalCapture: true,
      note: plan.partial ? `Partial release for "${milestone.title}". ${plan.returnedToClient} ${milestone.currency} returned to you.` : undefined,
      requestId: `capture-${milestone.id}`,
    });
    const updated = await saveMilestone(milestone.id, {
      status: plan.partial ? 'partially_released' : 'released',
      captureId: capture.id,
      releasedAmount: plan.amount,
      returnedAmount: plan.returnedToClient,
    }, { type: plan.partial ? 'partially_released' : 'released', captureId: capture.id, amount: plan.amount, paypalStatus: capture.status });
    res.json(updated);
  });

  app.post('/api/milestones/:id/void', async (req, res) => {
    requirePaypal();
    const milestone = await findMilestone(req.params.id);
    if (milestone.status !== 'funded') throw new RangeError(`Only a funded milestone can be voided (this one is ${milestone.status})`);
    await paypal.voidAuthorization(milestone.authorizationId, { requestId: `void-${milestone.id}` });
    const updated = await saveMilestone(milestone.id, { status: 'voided', returnedAmount: milestone.amount }, { type: 'voided' });
    res.json(updated);
  });

  // What PayPal itself says about the hold, so the UI never has to take our word for it.
  app.get('/api/milestones/:id/paypal', async (req, res) => {
    requirePaypal();
    const milestone = await findMilestone(req.params.id);
    if (!milestone.authorizationId) throw new RangeError('This milestone has no PayPal authorization yet');
    const authorization = await paypal.getAuthorization(milestone.authorizationId);
    res.json({ id: authorization.id, status: authorization.status, amount: authorization.amount, expirationTime: authorization.expiration_time });
  });

  if (config.isProduction && existsSync(DIST)) {
    app.use(express.static(DIST));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(`${DIST}/index.html`));
  }

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  app.use((error, _req, res, _next) => {
    if (error instanceof NotFound) return res.status(404).json({ error: error.message });
    if (error instanceof RangeError) return res.status(400).json({ error: error.message });
    if (error instanceof PayPalError) {
      console.error(error.message, error.debugId ? `debug_id=${error.debugId}` : '');
      return res.status(502).json({ error: error.message, paypalDebugId: error.debugId });
    }
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body must be JSON' });
    console.error(error);
    res.status(500).json({ error: 'Something went wrong' });
  });

  return app;
}
