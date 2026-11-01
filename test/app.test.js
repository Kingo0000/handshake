import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/src/app.js';
import { loadConfig } from '../server/src/config.js';
import { createStore } from '../server/src/store.js';

// Stands in for PayPal and records what the server asked it to do.
function fakePayPal() {
  const calls = [];
  return {
    calls,
    async createAuthorizeOrder(args) { calls.push(['order', args]); return { id: 'ORDER-1', status: 'CREATED' }; },
    async authorizeOrder(id) {
      calls.push(['authorize', id]);
      return { status: 'COMPLETED', purchase_units: [{ payments: { authorizations: [{ id: 'AUTH-1', status: 'CREATED', expiration_time: '2026-12-01T00:00:00Z' }] } }] };
    },
    async captureAuthorization(id, args) { calls.push(['capture', id, args]); return { id: 'CAP-1', status: 'COMPLETED' }; },
    async voidAuthorization(id) { calls.push(['void', id]); return {}; },
    async getAuthorization(id) { return { id, status: 'CREATED', amount: { value: '400.00' } }; },
  };
}

let dir, server, base, paypal;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'handshake-'));
  const config = loadConfig({ PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 'secret' });
  paypal = fakePayPal();
  const app = createApp({ config, store: createStore(join(dir, 'db.json')), paypal });
  server = app.listen(0);
  base = `http://localhost:${server.address().port}/api`;
});

afterEach(async () => {
  server.close();
  await rm(dir, { recursive: true, force: true });
});

async function post(path, body) {
  const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  return { status: res.status, body: await res.json() };
}

async function fundedMilestone() {
  const { body: milestone } = await post('/milestones', { title: 'Landing page', amount: '400' });
  await post(`/milestones/${milestone.id}/order`);
  const { body } = await post(`/milestones/${milestone.id}/authorize`);
  return body;
}

describe('milestone money flow', () => {
  it('funds a milestone with an AUTHORIZE order and stores the hold', async () => {
    const milestone = await fundedMilestone();
    expect(milestone.status).toBe('funded');
    expect(milestone.authorizationId).toBe('AUTH-1');
    expect(paypal.calls[0][1]).toMatchObject({ amount: '400.00', currency: 'USD' });
  });

  it('partially releases with final_capture so the rest goes back', async () => {
    const milestone = await fundedMilestone();
    const { status, body } = await post(`/milestones/${milestone.id}/release`, { amount: '300' });
    expect(status).toBe(200);
    expect(body).toMatchObject({ status: 'partially_released', releasedAmount: '300.00', returnedAmount: '100.00' });
    expect(paypal.calls.at(-1)).toEqual(['capture', 'AUTH-1', expect.objectContaining({ amount: '300.00', finalCapture: true })]);
  });

  it('refuses to release more than was held, without calling PayPal', async () => {
    const milestone = await fundedMilestone();
    const { status } = await post(`/milestones/${milestone.id}/release`, { amount: '500' });
    expect(status).toBe(400);
    expect(paypal.calls.some(([name]) => name === 'capture')).toBe(false);
  });

  it('voids a hold once, and refuses to release it afterwards', async () => {
    const milestone = await fundedMilestone();
    expect((await post(`/milestones/${milestone.id}/void`)).body.status).toBe('voided');
    expect((await post(`/milestones/${milestone.id}/release`)).status).toBe(400);
  });
});
