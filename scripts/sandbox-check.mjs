// End-to-end check of the money flow against the PayPal sandbox, with no browser:
// three holds are placed with a sandbox test card, then one is fully captured,
// one is partially captured (rest returned to the buyer), and one is voided.
//
//   npm run sandbox:check
//
// Uses PayPal's published sandbox test card. Override with SANDBOX_CARD_NUMBER
// and SANDBOX_CARD_EXPIRY (YYYY-MM) if your sandbox account generated a different one.
import { randomUUID } from 'node:crypto';
import { loadConfig, missingPaypalConfig } from '../server/src/config.js';
import { PayPalError, authorizationFromOrder, createPayPal } from '../server/src/paypal.js';

const config = loadConfig();
if (config.paypal.env !== 'sandbox') {
  console.error('sandbox:check only runs against the PayPal sandbox (PAYPAL_ENV=sandbox).');
  process.exit(1);
}
const missing = missingPaypalConfig(config);
if (missing.length) {
  console.error(`Set ${missing.join(' and ')} in .env (copy .env.example). Get them from developer.paypal.com → Apps & Credentials → Sandbox.`);
  process.exit(1);
}

const paypal = createPayPal(config.paypal);
const card = {
  number: process.env.SANDBOX_CARD_NUMBER || '4111111111111111',
  expiry: process.env.SANDBOX_CARD_EXPIRY || '2030-12',
  security_code: '123',
  name: 'Sandbox Client',
  billing_address: { address_line_1: '1 Main St', admin_area_2: 'San Jose', admin_area_1: 'CA', postal_code: '95131', country_code: 'US' },
};

async function hold(label, amount) {
  const order = await paypal.createAuthorizeOrder({
    amount,
    currency: 'USD',
    description: `Handshake sandbox check: ${label}`,
    referenceId: `check-${label}`,
    paymentSource: { card },
    requestId: randomUUID(),
  });
  // Card orders usually come back already authorized; PayPal-wallet orders need an explicit authorize.
  let authorization = authorizationFromOrder(order);
  if (!authorization) authorization = authorizationFromOrder(await paypal.authorizeOrder(order.id));
  if (!authorization) throw new Error(`No authorization for ${label} (order ${order.id} is ${order.status})`);
  console.log(`  held ${amount} USD  order=${order.id}  authorization=${authorization.id}  status=${authorization.status}`);
  return authorization.id;
}

async function status(authorizationId) {
  const authorization = await paypal.getAuthorization(authorizationId);
  return authorization.status;
}

const results = [];
function check(name, actual, expected) {
  const ok = expected.includes(actual);
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}: ${actual}${ok ? '' : ` (expected ${expected.join(' or ')})`}`);
}

try {
  console.log('1. Full release');
  const full = await hold('full', '100.00');
  const fullCapture = await paypal.captureAuthorization(full, { finalCapture: true });
  check('capture', fullCapture.status, ['COMPLETED', 'PENDING']);
  check('authorization after capture', await status(full), ['CAPTURED']);

  console.log('2. Partial release: 75.00 of 100.00, remaining 25.00 returned');
  const partial = await hold('partial', '100.00');
  const partialCapture = await paypal.captureAuthorization(partial, { amount: '75.00', currency: 'USD', finalCapture: true });
  check('capture', partialCapture.status, ['COMPLETED', 'PENDING']);
  check('captured amount', partialCapture.amount?.value, ['75.00']);
  check('authorization after final partial capture', await status(partial), ['CAPTURED', 'PARTIALLY_CAPTURED']);

  console.log('3. Void (work abandoned)');
  const voided = await hold('void', '100.00');
  await paypal.voidAuthorization(voided);
  check('authorization after void', await status(voided), ['VOIDED']);
} catch (error) {
  if (error instanceof PayPalError) {
    console.error(`\n${error.message}${error.debugId ? `  debug_id=${error.debugId}` : ''}`);
    console.error(JSON.stringify(error.body?.details || error.body, null, 2));
    if (/card|payment_source|PAYEE_NOT_ENABLED/i.test(JSON.stringify(error.body))) {
      console.error('\nThe sandbox business account may not accept direct card payments. Use the browser flow instead: npm run dev, then pay with a sandbox personal account.');
    }
  } else {
    console.error(error);
  }
  process.exit(1);
}

const failed = results.filter((ok) => !ok).length;
console.log(failed ? `\n${failed} check(s) failed` : '\nAll sandbox checks passed');
process.exit(failed ? 1 : 0);
