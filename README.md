# Handshake

**An AI referee for freelance payments. The client's money is held through PayPal, an AI agent checks the work against what was agreed, and the payment is released, partly released or refunded based on evidence instead of an argument.**

Built for the PayPal AI Hackathon (deadline Nov 12, 2026).

---

## The problem

Cross-border freelancers (for example a Lagos developer, a Manila designer or a Nairobi copywriter working for a US client) lose money in two ways:

1. **Non-payment.** The work gets delivered and the client goes quiet.
2. **Scope fights.** "This isn't what I asked for." Neither side can point to an objective record, so disputes drag on or the freelancer gives in.

Clients have the opposite fear: paying upfront and getting nothing. Escrow platforms exist, but they charge high fees, lock both sides into one marketplace, and still settle disputes with a slow human reviewer.

## The idea

Handshake turns a loose brief into a **contract a machine can check**, then ties PayPal money movement to that contract.

1. **Agree.** The client pastes a brief or chat thread. The AI turns it into milestones, each with **testable acceptance criteria** ("landing page loads under 2s on mobile", "logo delivered as SVG + PNG in 3 colourways"), plus a price and deadline. Both sides edit and accept it, and that version is frozen and hashed.
2. **Fund.** The client funds each milestone through PayPal Checkout using `intent: AUTHORIZE`. The money is held on the client's account, not paid out yet. The freelancer can see that the milestone is funded before starting.
3. **Deliver.** The freelancer submits evidence: a live URL, a GitHub repo, files, screenshots or a doc.
4. **Verify.** The agent checks each criterion with real tools: it loads the URL in a headless browser and takes screenshots, inspects the repo, reads the files, and uses vision on the designs. It produces a **verdict per criterion** (pass, fail or unclear) with cited evidence.
5. **Settle.**
   - All pass and the client approves (or the review window passes with no response): **full capture** and the freelancer is paid.
   - Partial pass: the AI proposes a fair split, and on agreement Handshake makes a **partial capture with `final_capture: true`**, so the rest goes back to the client automatically.
   - Fail or abandoned: **void** the authorization.
   - Platform cut, or paying a subcontractor: **Payouts API**.

Every payment decision cites the criteria and evidence it was based on, so both sides can see why.

## Why it can win

| Judging criterion | How Handshake scores |
|---|---|
| Technological implementation | Uses PayPal Orders v2 (authorize, partial capture, void, reauthorize), Payouts, webhooks and Invoicing as the core of the product. The AI is an agent that uses tools (browser, repo, vision), not a chatbot bolted on. |
| Design | One clear flow, Agree → Fund → Deliver → Verify → Settle, with a shared contract page both sides use. |
| Potential impact | A specific audience (tens of millions of cross-border freelancers) with a specific, expensive problem: non-payment and scope disputes. |
| Innovation | The AI decides **how much** money moves, and PayPal's partial capture lets that decision be applied exactly. |
| Presentation | The demo tells a story: a broken deliverable gets a partial payout, it gets fixed, then the full payout. All of it can be shown in under 3 minutes. |

Prizes it targets: the overall prizes, **Best Use of PayPal + AI**, **Most Impactful**, **Best Use of Agentic Commerce**, and **Best Use of Render** (deploy there; your abegreply stack already uses it).

See [PLAN.md](PLAN.md) for the architecture, the 11-day schedule and the demo script.

## Run it locally

Requires Node 22 or newer.

```bash
npm install
cp .env.example .env   # add your PayPal sandbox client ID and secret
npm run dev            # API on :8787, app on http://localhost:5181
```

Get sandbox credentials from [developer.paypal.com](https://developer.paypal.com) → Apps & Credentials → Sandbox → create an app. To fund a milestone in the app, log in to the PayPal popup with the **sandbox personal account** listed under Testing Tools → Sandbox Accounts.

Check the whole money flow against the sandbox with no browser (hold → full capture, hold → partial capture with the rest returned, hold → void):

```bash
npm run sandbox:check
```

`npm test` runs the unit and API tests with PayPal faked.

### How money moves

| Milestone state | PayPal call |
|---|---|
| Funded (held) | `POST /v2/checkout/orders` with `intent: AUTHORIZE`, buyer approves, then `POST /v2/checkout/orders/{id}/authorize` |
| Released | `POST /v2/payments/authorizations/{id}/capture` |
| Partly released | `.../capture` with `amount` and `final_capture: true`, so PayPal returns the rest to the client |
| Voided | `POST /v2/payments/authorizations/{id}/void` |

The server checks every release against what's held before calling PayPal, and sends idempotency keys (`PayPal-Request-Id`) so a retried request can't capture twice.

## License

MIT
