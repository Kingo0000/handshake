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
  };

  let busy = $state(false);
  let paypalTruth = $state(null);

  const status = $derived(STATUS[milestone.status] || { label: milestone.status, tone: 'open' });
  const settled = $derived(['released', 'partially_released', 'voided'].includes(milestone.status));
  const fundable = $derived(['draft', 'awaiting_payment'].includes(milestone.status));
  const stage = $derived(settled ? 2 : milestone.status === 'funded' ? 1 : 0);

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
      <p class="meta">Added {new Date(milestone.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</p>
    </div>
    <div class="amount-block">
      <span class="amount">{formatMoney(milestone.amount, milestone.currency)}</span>
      <span class="chip {status.tone}"><span class="dot"></span>{status.label}</span>
    </div>
  </header>

  <ol class="stepper" aria-label="Progress">
    {#each ['Funded', 'Delivered', 'Settled'] as step, i}
      <li class:done={i < stage || (settled && i === 2)} class:current={!settled && i === stage}>
        <span class="node">{#if i < stage || (settled && i === 2)}✓{:else}{i + 1}{/if}</span>
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

  {#if fundable}
    <div class="fund">
      <p>The client funds this milestone through PayPal. The money is held, not charged, until you release it.</p>
      {#if config?.paypalConfigured}
        <div class="paypal-slot" use:paypalButtons></div>
      {:else}
        <button class="primary" disabled title="Add PayPal sandbox keys to .env">Fund with PayPal</button>
      {/if}
    </div>
  {:else if milestone.status === 'funded'}
    <SettlePanel {milestone} {busy} onrelease={release} onvoid={voidHold} />
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
