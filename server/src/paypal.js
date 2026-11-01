// Thin PayPal REST client: OAuth token caching, idempotency keys, and the
// Orders v2 / Payments v2 calls Handshake needs to hold and release money.
import { randomUUID } from 'node:crypto';

export class PayPalError extends Error {
  constructor(status, body) {
    const detail = body?.details?.[0];
    super(`PayPal ${status}: ${detail?.issue || body?.name || 'request failed'}${detail?.description ? ` (${detail.description})` : ''}`);
    this.status = status;
    this.body = body;
    this.debugId = body?.debug_id;
  }
}

export function createPayPal({ baseUrl, clientId, clientSecret }, fetchImpl = fetch) {
  let token = null;

  async function accessToken() {
    if (token && token.expiresAt > Date.now() + 60_000) return token.value;
    const res = await fetchImpl(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new PayPalError(res.status, body);
    token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return token.value;
  }

  async function request(method, path, body, { requestId } = {}) {
    const headers = {
      Authorization: `Bearer ${await accessToken()}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    };
    // PayPal dedupes retried POSTs that share a request id, so a retry never double-captures.
    if (method === 'POST') headers['PayPal-Request-Id'] = requestId || randomUUID();
    const res = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) throw new PayPalError(res.status, json);
    return json;
  }

  return {
    createAuthorizeOrder({ amount, currency, description, referenceId, paymentSource, requestId }) {
      const order = {
        intent: 'AUTHORIZE',
        purchase_units: [{
          reference_id: referenceId,
          description: description?.slice(0, 127),
          amount: { currency_code: currency, value: amount },
        }],
      };
      if (paymentSource) order.payment_source = paymentSource;
      return request('POST', '/v2/checkout/orders', order, { requestId });
    },
    getOrder(orderId) {
      return request('GET', `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
    },
    authorizeOrder(orderId, { requestId } = {}) {
      return request('POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, {}, { requestId });
    },
    getAuthorization(authorizationId) {
      return request('GET', `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}`);
    },
    // amount omitted captures the full authorized amount. finalCapture releases whatever is left back to the buyer.
    captureAuthorization(authorizationId, { amount, currency, finalCapture = true, note, requestId } = {}) {
      const body = { final_capture: finalCapture };
      if (amount) body.amount = { currency_code: currency, value: amount };
      if (note) body.note_to_payer = note.slice(0, 255);
      return request('POST', `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`, body, { requestId });
    },
    voidAuthorization(authorizationId, { requestId } = {}) {
      return request('POST', `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`, undefined, { requestId });
    },
  };
}

export function authorizationFromOrder(order) {
  return order?.purchase_units?.[0]?.payments?.authorizations?.[0] || null;
}
