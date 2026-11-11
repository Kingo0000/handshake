<script>
  import { api, loadPayPalSdk } from '../api.js';
  import { formatMoney, toCents } from '../money.js';
  import SettlePanel from './SettlePanel.svelte';

  let { milestone, config, onupdate, onerror } = $props();

  const STATUS = {
    draft: { label: 'Not funded', tone: 'open' },
    awaiting_payment: { label: 'Waiting for client', tone: 'open' },
    funded: { label: 'Funded · held', tone: 'held' },
    released: { label: 'Paid in full', tone: 'paid' },
    partially_released: { label: 'Partly paid', tone: 'paid' },
    voided: { label: 'Refunded', tone: 'back' },
  };

  const EVENT_LABELS = {
    created: 'Milestone created',
    order_created: 'PayPal checkout opened',
    funded: 'Client funded, money held',
    released: 'Released to freelancer',
    partially_released: 'Partly released, rest returned',
    voided: 'Hold voided, refunded',
    delivered: 'Freelancer delivered the work',
    verified: 'AI verified the delivery',
  };

  const VERDICT = { pass: 'Pass', fail: 'Fail', unclear: 'Unclear' };

  let busy = $state(false);
  let paypalTruth = $state(null);
  let deliveryUrl = $state('');
  let deliveryNote = $state('');
  let verifying = $state(false);
  let suggestion = $state(null);

  const review = $derived(milestone.review);
  const verdictFor = (id) => review?.verdicts?.find((v) => v.criterion_id === id);

  const status = $derived(STATUS[milestone.status] || { label: milestone.status, tone: 'open' });
  const settled = $derived(['released', 'partially_released', 'voided'].includes(milestone.status));
  const fundable = $derived(['draft', 'awaiting_payment'].includes(milestone.status));
  const stage = $derived(settled ? 3 : milestone.submission ? 2 : milestone.status === 'funded' ? 1 : 0);

  // Share of the milestone in each state, for the money bar.
  const bar = $derived.by(() => {
    const total = toCents(milestone.amount) || 1;
    const pct = (cents) => `${(cents / total) * 100}%`;
    if (milestone.status === 'funded') return [{ tone: 'held', width: '100%' }];
    if (!settled) return [];
    return [
      { tone: 'paid', width: pct(toCents(milestone.releasedAmount)) },
      { tone: 'back', width: pct(toCents(milestone.returnedAmount)) },
    ];
  });

  async function act(fn) {
    busy = true;
    try {
      await fn();
    } catch (e) {
      onerror(e.message);
    } finally {
      busy = false;
    }
  }

  const release = (amount) => act(async () => {
    onupdate(await api(`/milestones/${milestone.id}/release`, { method: 'POST', body: { amount } }));
  });

  const voidHold = () => act(async () => {
    onupdate(await api(`/milestones/${milestone.id}/void`, { method: 'POST' }));
  });

  const fundWithTestCard = () => act(async () => {
    onupdate(await api(`/milestones/${milestone.id}/fund-test-card`, { method: 'POST' }));
  });

  const deliver = () => act(async () => {
    onupdate(await api(`/milestones/${milestone.id}/submit`, { method: 'POST', body: { url: deliveryUrl, note: deliveryNote } }));
  });

  async function verify() {
    verifying = true;
    try {
      onupdate(await api(`/milestones/${milestone.id}/verify`, { method: 'POST' }));
    } catch (e) {
      onerror(e.message);
    } finally {
      verifying = false;
    }
  }

  const checkPaypal = () => act(async () => {
    paypalTruth = await api(`/milestones/${milestone.id}/paypal`);
  });

  // Svelte action: renders PayPal buttons that fund this milestone with an authorization hold.
  function paypalButtons(node) {
    let buttons;
    loadPayPalSdk(config.paypalClientId, milestone.currency)
      .then((paypal) => {
        buttons = paypal.Buttons({
          style: { layout: 'horizontal', tagline: false, height: 44, shape: 'rect' },
          createOrder: async () => (await api(`/milestones/${milestone.id}/order`, { method: 'POST' })).id,
          onApprove: () => act(async () => {
            onupdate(await api(`/milestones/${milestone.id}/authorize`, { method: 'POST' }));
          }),
          onError: (e) => onerror(e?.message || 'PayPal could not complete the payment'),
        });
        return buttons.render(node);
      })
      .catch((e) => onerror(e.message));
    return { destroy: () => buttons?.close?.() };
  }
</script>

<article class="milestone" class:busy>
  <header>
    <div>
      <h3>{milestone.title}</h3>
      <p class="meta">
        Added {new Date(milestone.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
        {#if milestone.versionHash}<span class="hash" title={milestone.versionHash}>contract #{milestone.versionHash.slice(0, 8)}</span>{/if}
      </p>
    </div>
    <div class="amount-block">
      <span class="amount">{formatMoney(milestone.amount, milestone.currency)}</span>
      <span class="chip {status.tone}"><span class="dot"></span>{status.label}</span>
    </div>
  </header>

  <ol class="stepper" aria-label="Progress">
    {#each ['Funded', 'Delivered', 'Verified', 'Settled'] as step, i}
      {@const done = i < stage || (i === 2 && review) || (settled && i === 3)}
      <li class:done={done} class:current={!settled && !done && i === stage}>
        <span class="node">{#if done}✓{:else}{i + 1}{/if}</span>
        <span class="step-label">{step}</span>
      </li>
    {/each}
  </ol>

  {#if bar.length}
    <div class="money-bar" role="img" aria-label="Where the money is">
      {#each bar as part}
        <span class={part.tone} style:width={part.width}></span>
      {/each}
    </div>
  {/if}

  {#if milestone.criteria?.length}
    <ul class="criteria">
      {#each milestone.criteria as c}
        {@const v = verdictFor(c.id)}
        <li class={v?.result}>
          <span class="verdict">{v ? VERDICT[v.result] : c.checkMethod}</span>
          <div>
            <p>{c.statement}</p>
            {#if v}<p class="evidence">{v.evidence}</p>{/if}
          </div>
          {#if v?.screenshot}
            <a href="/api/evidence/{v.screenshot}" target="_blank" rel="noreferrer"><img class="shot" src="/api/evidence/{v.screenshot}" alt="Screenshot evidence" /></a>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if fundable}
    <div class="fund">
      <p>The client funds this milestone through PayPal. The money is held, not charged, until you release it.</p>
      {#if config?.paypalConfigured}
        <div class="paypal-slot" use:paypalButtons></div>
        {#if config.paypalEnv === 'sandbox'}
          <button class="ghost small test-card" onclick={fundWithTestCard} disabled={busy}>Sandbox: hold with PayPal's test card</button>
        {/if}
      {:else}
        <button class="primary" disabled title="Add PayPal sandbox keys to .env">Fund with PayPal</button>
      {/if}
    </div>
  {:else if milestone.status === 'funded'}
    {#if !milestone.submission}
      <div class="deliver">
        <h4>Deliver the work</h4>
        <label class="field"><span>Link to the delivered work</span><input class="url-input" bind:value={deliveryUrl} placeholder="https://…" /></label>
        <label class="field"><span>Note for the client (optional)</span><input class="note-input" bind:value={deliveryNote} placeholder="What changed, how to test it" /></label>
        <button class="primary" onclick={deliver} disabled={busy || !deliveryUrl}>Submit delivery</button>
      </div>
    {:else}
      <div class="deliver">
        <div class="delivered-head">
          <h4>Delivered</h4>
          <a class="mono small-link" href={milestone.submission.url} target="_blank" rel="noreferrer">{milestone.submission.url}</a>
        </div>
        {#if !review}
          <button class="primary verify-btn" onclick={verify} disabled={verifying}>
            {#if verifying}<span class="spin"></span>AI is opening the site on mobile and desktop…{:else}Verify against the contract with AI{/if}
          </button>
        {:else}
          {#if review.injectionDetected}
            <div class="injection" role="alert">
              <strong>Ignored an instruction hidden in the delivery.</strong>
              <span>{review.injectionNote}</span>
            </div>
          {/if}
          <div class="proposal">
            <div>
              <p class="eyebrow">AI proposal · you decide</p>
              <h4>{review.proposal.action === 'release' ? 'Release in full' : review.proposal.action === 'void' ? 'Refund the client' : `Release ${review.proposal.percent}%`} · {formatMoney(review.proposal.amount, milestone.currency)}</h4>
              <p>{review.proposal.rationale}</p>
            </div>
            <div class="proposal-actions">
              <button class="primary" onclick={() => (suggestion = { ...review.proposal })}>Use this proposal</button>
              <button class="ghost small" onclick={verify} disabled={verifying}>{verifying ? 'Re-checking…' : 'Re-check'}</button>
            </div>
          </div>
        {/if}
      </div>
    {/if}
    <SettlePanel {milestone} {busy} {suggestion} onrelease={release} onvoid={voidHold} />
  {:else if settled}
    <dl class="receipt">
      <div><dt>To freelancer</dt><dd class="paid">{formatMoney(milestone.releasedAmount || 0, milestone.currency)}</dd></div>
      <div><dt>Back to client</dt><dd class="back">{formatMoney(milestone.returnedAmount || 0, milestone.currency)}</dd></div>
      {#if milestone.captureId}<div><dt>PayPal capture</dt><dd class="mono">{milestone.captureId}</dd></div>{/if}
    </dl>
  {/if}

  <footer>
    <details>
      <summary>Activity · {milestone.events.length}</summary>
      <ol class="timeline">
        {#each milestone.events.toReversed() as event}
          <li>
            <span class="t-dot"></span>
            <span class="t-label">{EVENT_LABELS[event.type] || event.type}{event.amount ? ` · ${formatMoney(event.amount, milestone.currency)}` : ''}</span>
            <time>{new Date(event.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>
          </li>
        {/each}
      </ol>
    </details>
    {#if milestone.authorizationId}
      <button class="ghost small" onclick={checkPaypal} disabled={busy}>
        {paypalTruth ? `PayPal says: ${paypalTruth.status.replaceAll('_', ' ').toLowerCase()}` : 'Verify with PayPal'}
      </button>
    {/if}
  </footer>
</article>
