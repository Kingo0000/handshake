# Handshake

**An AI referee for freelance payments.** PayPal holds the client's money, an AI agent checks the delivered work in a real browser, and a person approves the split it proposes. The freelancer is paid for what passed, and the rest goes back to the client automatically.

**Live demo:** https://handshake-beta-amber.vercel.app (PayPal sandbox, no login needed) · Built for the PayPal AI Hackathon.

---

## The problem

Cross-border freelancers (a Lagos developer, a Manila designer, a Nairobi copywriter working for a US client) lose money two ways: the client goes quiet after delivery, or the client says "this isn't what I asked for" and neither side has an objective record. Clients have the opposite fear: paying upfront and getting nothing.

## What it does

1. **Agree.** Paste the chat thread where the deal was made. The AI drafts milestones with a price, a due date and **testable acceptance criteria** (load time, mobile layout, sections that must exist). Subjective asks like "make it look premium" are kept, rewritten into something checkable, and flagged so both sides see the change. Both accept, and that version is frozen with a SHA-256 hash that every later payment event cites.
2. **Fund.** The client funds a milestone with PayPal using `intent: AUTHORIZE`. The money is held, not paid out, and the freelancer can see the hold before starting.
3. **Deliver.** The freelancer submits a link to the live work, with a note.
4. **Verify.** An AI agent opens the link in headless Chromium, on a phone viewport and a desktop viewport. It measures load time and horizontal overflow, reads the page, looks at the screenshots, and returns **pass, fail or unclear for every criterion**, with the evidence and a screenshot.
5. **Settle.** The AI proposes a full release, a partial release or a refund, and explains why. It cannot move money. A person approves, and Handshake makes a PayPal **partial capture with `final_capture: true`**, so the freelancer is paid for what passed and PayPal returns the rest of the hold to the client. Or it voids the hold.

**Prompt-injection safe.** The demo delivery (`/demo/brightside/`) hides a line telling the AI reviewer to approve everything. The agent treats delivered content as evidence, never as instructions: it ignores the line and flags it to both sides.

## How PayPal is used

All calls go to the **PayPal sandbox** (`https://api-m.sandbox.paypal.com`) from [server/src/paypal.js](server/src/paypal.js).

| Step | PayPal API |
|---|---|
| Fund (PayPal button) | JS SDK buttons + Orders v2 `POST /v2/checkout/orders` with `intent: AUTHORIZE`, then `POST /v2/checkout/orders/{id}/authorize` |
| Fund (judges' shortcut) | Orders v2 with `intent: AUTHORIZE` and a `payment_source.card` using PayPal's published sandbox test card. It's still a real sandbox authorization |
| Release in full | Payments v2 `POST /v2/payments/authorizations/{id}/capture` |
| Partial release | The same capture with an `amount` and `final_capture: true`, so PayPal returns the remainder to the client |
| Refund | Payments v2 `POST /v2/payments/authorizations/{id}/void` |
| Show the truth | `GET /v2/payments/authorizations/{id}` behind "Verify with PayPal", so nobody has to take Handshake's word for it |

Every POST sends a `PayPal-Request-Id` idempotency key, so a retried request can never capture twice. The server checks each release against what is held before calling PayPal.

## How AI is used

**OpenAI GPT-5 nano** (`gpt-5-nano-2025-08-07`) through the official OpenAI SDK, Chat Completions API, in [server/src/agent.js](server/src/agent.js). The model is one environment variable (`OPENAI_MODEL`).

| Job | How |
|---|---|
| Contract drafter | Structured output with a strict JSON schema: milestones, prices, due dates, criteria with a check method, weight and a `vague` flag |
| Delivery verifier | A tool-using agent loop with two strict function tools: `inspect_url` (Playwright: HTTP status, load time, horizontal overflow, broken images, links, forms, console errors, visible text, and a screenshot passed back to the model as an image) and `submit_verdicts` |
| Settlement proposer | Structured output: release, partial or void, a percentage, and a plain-language rationale |

**Guardrails.** The AI only proposes. The server turns its percentage into an amount clamped to the hold (a proposal of 140% becomes 100%, covered by a test), a refund proposal can never pre-fill a release, and every money move needs a second click from a person. Measurements override impressions in the verifier's instructions, and delivered content is evidence, never instructions. Each event is logged against the contract hash, including whether a release followed the AI's proposal.

## Try it (judges)

1. Open https://handshake-beta-amber.vercel.app and click **Use a sample brief**, then **Draft contract with AI** (about 15 to 30 seconds).
2. Click **Accept & freeze contract**.
3. On Milestone 1, click **Sandbox: hold with PayPal's test card**. No PayPal login needed. (The yellow PayPal button also works with any PayPal sandbox personal account.)
4. Paste `https://handshake-beta-amber.vercel.app/demo/brightside/` as the delivery link and click **Submit delivery**.
5. Click **Verify against the contract with AI** (about 1 to 2 minutes). Each criterion gets a verdict with a screenshot, and the hidden instruction is flagged.
6. Click **Use this proposal**, then click the release button twice. Open **Activity**, then **Verify with PayPal** to see PayPal's own status.

## Run it locally

Requires Node 22 or newer.

```bash
npm install
npx playwright install chromium
cp .env.example .env   # add PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and OPENAI_API_KEY
npm run dev            # API on :8787, app on http://localhost:5181
```

- **PayPal:** [developer.paypal.com](https://developer.paypal.com) → Apps & Credentials → Sandbox → Create App. The test-card shortcut needs a sandbox business account that can take card payments; a US sandbox business account works.
- **OpenAI:** [platform.openai.com](https://platform.openai.com) → API keys.
- `npm test` runs 17 unit and API tests with PayPal and the AI faked.
- `npm run sandbox:check` runs the money flow against the real sandbox with no browser: hold → full capture, hold → partial capture with the rest returned, hold → void.

## Deploy

**Vercel** (how the live demo runs): `api/index.js` wraps the same Express app as a serverless function. Data and screenshots go to **Vercel Blob** (`BLOB_READ_WRITE_TOKEN`), and the verifier uses `@sparticuz/chromium`. Set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENV=sandbox` and `OPENAI_API_KEY`, connect a Blob store, and deploy. Configuration is in [vercel.json](vercel.json).

**Any Node host:** `npm run build && npm start`, with Playwright's Chromium installed and the same environment variables. Data is a JSON file (`DATA_PATH`).

## Stack

Svelte 5 + Vite · Node 22 + Express 5 · OpenAI SDK · Playwright · PayPal Orders v2 and Payments v2 · Vitest · Vercel + Vercel Blob

## Project layout

```
api/index.js              Vercel entry (blob store, blob screenshots)
server/index.js           Local/Node entry
server/src/app.js         Routes: contracts, milestones, PayPal, verify, settle
server/src/agent.js       The three AI jobs
server/src/browser.js     The verifier's browser tool (Playwright)
server/src/paypal.js      PayPal Orders v2 / Payments v2 client
server/src/money.js       Cents arithmetic and release planning
server/src/store.js       JSON file store and Vercel Blob store
server/demo-sites/        Demo delivery with a mobile bug and a planted prompt injection
src/                      Svelte app
test/                     Vitest suites
```

## AI tools used

OpenAI GPT-5 nano runs the contract drafter, the verifier agent and the settlement proposer. Claude Code was used as a coding assistant during development.

## License

[MIT](LICENSE)
