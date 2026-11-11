import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import express from 'express';
import { AgentError } from './agent.js';
import { missingPaypalConfig } from './config.js';
import { SUPPORTED_CURRENCIES, fromCents, planRelease, toCents } from './money.js';
import { PayPalError, authorizationFromOrder } from './paypal.js';

const DIST = new URL('../../dist', import.meta.url).pathname;
const DEMO_SITES = new URL('../demo-sites', import.meta.url).pathname;

class NotFound extends Error {}

// PayPal's published sandbox Visa (developer.paypal.com → Testing Tools → Card testing).
const SANDBOX_CARD = {
  number: '4111111111111111',
  expiry: '2030-12',
  security_code: '123',
  name: 'Sandbox Client',
  billing_address: { address_line_1: '1 Main St', admin_area_2: 'San Jose', admin_area_1: 'CA', postal_code: '95131', country_code: 'US' },
};

export function createApp({ config, store, paypal, agent }) {
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
      aiConfigured: Boolean(agent?.configured),
      currencies: SUPPORTED_CURRENCIES,
    });
  });

  // Agree: the AI turns a brief into milestones with testable criteria. Nothing is saved until both sides accept.
  app.post('/api/contracts/draft', async (req, res) => {
    const brief = String(req.body?.brief || '').trim().slice(0, 8000);
    if (brief.length < 20) throw new RangeError('Paste the brief or chat thread first');
    res.json(await agent.draftContract(brief));
  });

  // Freeze the accepted contract. Its hash is recorded on every later decision.
  app.post('/api/contracts', async (req, res) => {
    const body = req.body || {};
    const title = String(body.title || '').trim().slice(0, 120);
    if (!title) throw new RangeError('Give the contract a title');
    if (!Array.isArray(body.milestones) || !body.milestones.length) throw new RangeError('A contract needs at least one milestone');
    const milestones = body.milestones.slice(0, 5).map((m, i) => {
      const cents = toCents(m.amount);
      if (cents < 100) throw new RangeError(`Milestone ${i + 1} must be at least 1.00`);
      const criteria = (m.criteria || []).slice(0, 8).map((c, j) => ({
        id: `m${i + 1}c${j + 1}`,
        statement: String(c.statement || '').trim().slice(0, 300),
        checkMethod: ['url', 'visual', 'file', 'manual'].includes(c.check_method) ? c.check_method : 'manual',
        weight: Math.min(3, Math.max(1, Number(c.weight) || 2)),
      })).filter((c) => c.statement);
      if (!criteria.length) throw new RangeError(`Milestone ${i + 1} needs at least one criterion`);
      return { title: String(m.title || '').trim().slice(0, 120) || `Milestone ${i + 1}`, amount: fromCents(cents), dueDays: Number(m.due_days) || null, criteria };
    });
    const terms = { title, summary: String(body.summary || '').slice(0, 1000), milestones };
    const versionHash = createHash('sha256').update(JSON.stringify(terms)).digest('hex');
    const now = new Date().toISOString();
    const contract = { id: randomUUID(), ...terms, versionHash, acceptedAt: now };
    const created = milestones.map((m) => ({
      id: randomUUID(),
      contractId: contract.id,
      versionHash,
      title: m.title,
      amount: m.amount,
      currency: 'USD',
      dueDays: m.dueDays,
      criteria: m.criteria,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      events: [{ at: now, type: 'created', versionHash }],
    }));
    await store.update((state) => {
      (state.contracts ??= []).push(contract);
      state.milestones.push(...created);
    });
    res.status(201).json({ contract, milestones: created });
  });

  app.get('/api/contracts', async (_req, res) => {
    const state = await store.read();
    res.json((state.contracts || []).toReversed());
  });

  // Deliver: the freelancer points at the work.
  app.post('/api/milestones/:id/submit', async (req, res) => {
    const milestone = await findMilestone(req.params.id);
    if (milestone.status !== 'funded') throw new RangeError('Work can be delivered once the milestone is funded');
    let url;
    try { url = new URL(String(req.body?.url || '')).toString(); } catch { throw new RangeError('Enter the full link to the delivered work'); }
    const submission = { url, note: String(req.body?.note || '').slice(0, 2000), at: new Date().toISOString() };
    res.json(await saveMilestone(milestone.id, { submission, review: null }, { type: 'delivered', url }));
  });

  // Verify: the agent checks every criterion with real tools, then proposes a split. Nothing moves yet.
  app.post('/api/milestones/:id/verify', async (req, res) => {
    const milestone = await findMilestone(req.params.id);
    if (milestone.status !== 'funded' || !milestone.submission) throw new RangeError('There is no delivery to verify yet');
    const result = await agent.verify({ milestone, submission: milestone.submission });
    const proposal = await agent.proposeSettlement({ milestone, verdicts: result.verdicts });
    // The AI suggests a percentage; the server turns it into an amount that can never exceed the hold.
    const total = toCents(milestone.amount);
    const percent = proposal.action === 'void' ? 0 : Math.min(100, Math.max(0, Math.round(proposal.percent)));
    const review = {
      at: new Date().toISOString(),
      versionHash: milestone.versionHash,
      verdicts: result.verdicts,
      inspections: result.inspections,
      injectionDetected: result.injection_detected,
      injectionNote: result.injection_note,
      proposal: { action: percent === 0 ? 'void' : percent === 100 ? 'release' : 'partial', percent, amount: fromCents(Math.floor((total * percent) / 100)), rationale: proposal.rationale },
    };
    const passed = result.verdicts.filter((v) => v.result === 'pass').length;
    res.json(await saveMilestone(milestone.id, { review }, { type: 'verified', passed, total: result.verdicts.length, proposedAmount: review.proposal.amount }));
  });

  app.use('/api/evidence', express.static(config.evidencePath, { immutable: true, maxAge: '1y' }));
  // Sample deliveries for the demo (one with a broken mobile layout and a planted prompt injection).
  app.use('/demo', express.static(DEMO_SITES));

  app.get('/api/milestones', async (_req, res) => {
    const state = await store.read();
    // Newest contract first, but a contract's milestones stay in order (1, 2, 3).
    const groups = new Map();
    for (const m of state.milestones) {
      const key = m.contractId || m.id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    }
    res.json([...groups.values()].toReversed().flat());
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

  // Sandbox only: place a real PayPal hold with PayPal's published test card, so judges can
  // try the flow without a sandbox buyer login. Live mode never exposes this.
  app.post('/api/milestones/:id/fund-test-card', async (req, res) => {
    requirePaypal();
    if (config.paypal.env !== 'sandbox') throw new RangeError('Test cards only work in the PayPal sandbox');
    const milestone = await findMilestone(req.params.id);
    if (!['draft', 'awaiting_payment'].includes(milestone.status)) throw new RangeError(`Milestone is already ${milestone.status}`);
    let order = await paypal.createAuthorizeOrder({
      amount: milestone.amount,
      currency: milestone.currency,
      description: milestone.title,
      referenceId: milestone.id,
      paymentSource: { card: SANDBOX_CARD },
      requestId: `test-card-${milestone.id}`,
    });
    let authorization = authorizationFromOrder(order);
    if (!authorization) {
      order = await paypal.authorizeOrder(order.id, { requestId: `authorize-${milestone.id}` });
      authorization = authorizationFromOrder(order);
    }
    if (!authorization) throw new RangeError(`PayPal did not return an authorization (order status ${order.status})`);
    const updated = await saveMilestone(milestone.id, {
      status: 'funded',
      orderId: order.id,
      authorizationId: authorization.id,
      authorizationExpiresAt: authorization.expiration_time,
    }, { type: 'funded', authorizationId: authorization.id, paypalStatus: authorization.status, via: 'sandbox_test_card' });
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
    }, {
      type: plan.partial ? 'partially_released' : 'released',
      captureId: capture.id,
      amount: plan.amount,
      paypalStatus: capture.status,
      basis: milestone.review?.proposal?.amount === plan.amount ? 'ai_proposal_approved_by_client' : 'client_decision',
      versionHash: milestone.versionHash,
    });
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
    if (error instanceof AgentError) return res.status(502).json({ error: error.message });
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
