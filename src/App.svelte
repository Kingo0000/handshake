<script>
  import { onMount } from 'svelte';
  import { api, loadPayPalSdk } from './api.js';

  const STATUS_LABELS = {
    draft: 'Not funded',
    awaiting_payment: 'Waiting for client',
    funded: 'Funded (held)',
    released: 'Released',
    partially_released: 'Partly released',
    voided: 'Voided, refunded',
  };

  let config = $state(null);
  let milestones = $state([]);
  let error = $state('');
  let busy = $state('');
  let form = $state({ title: 'Landing page, mobile + desktop', amount: '400.00' });
  let partialAmounts = $state({});
  let paypalStatus = $state({});

  onMount(async () => {
    try {
      [config, milestones] = await Promise.all([api('/config'), api('/milestones')]);
    } catch (e) {
      error = e.message;
    }
  });

  function replace(updated) {
    milestones = milestones.map((m) => (m.id === updated.id ? updated : m));
  }

  async function run(key, fn) {
    busy = key;
    error = '';
    try {
      await fn();
    } catch (e) {
      error = e.message;
    } finally {
      busy = '';
    }
  }

  function createMilestone(event) {
    event.preventDefault();
    run('create', async () => {
      const milestone = await api('/milestones', { method: 'POST', body: { ...form, currency: 'USD' } });
      milestones = [milestone, ...milestones];
    });
  }

  function release(milestone, amount) {
    run(`release-${milestone.id}`, async () => {
      replace(await api(`/milestones/${milestone.id}/release`, { method: 'POST', body: amount ? { amount } : {} }));
    });
  }

  function voidHold(milestone) {
    run(`void-${milestone.id}`, async () => {
      replace(await api(`/milestones/${milestone.id}/void`, { method: 'POST' }));
    });
  }

  function checkPaypal(milestone) {
    run(`check-${milestone.id}`, async () => {
      paypalStatus[milestone.id] = await api(`/milestones/${milestone.id}/paypal`);
    });
  }

  // Svelte action: renders PayPal buttons that fund this milestone with an authorization hold.
  function paypalButtons(node, milestone) {
    let buttons;
    loadPayPalSdk(config.paypalClientId, milestone.currency)
      .then((paypal) => {
        buttons = paypal.Buttons({
          style: { layout: 'horizontal', tagline: false, height: 40 },
          createOrder: async () => (await api(`/milestones/${milestone.id}/order`, { method: 'POST' })).id,
          onApprove: () => run(`fund-${milestone.id}`, async () => {
            replace(await api(`/milestones/${milestone.id}/authorize`, { method: 'POST' }));
          }),
          onError: (e) => { error = e?.message || 'PayPal could not complete the payment'; },
        });
        return buttons.render(node);
      })
      .catch((e) => { error = e.message; });
    return { destroy: () => buttons?.close?.() };
  }

  const money = (amount, currency) => `${currency} ${amount}`;
</script>

<main>
  <header>
    <h1>Handshake</h1>
    <p class="lede">Clients fund each milestone with a PayPal hold. Money is released in full, in part, or refunded, based on the work.</p>
    {#if config}
      <span class="env">PayPal {config.paypalEnv}</span>
    {/if}
  </header>

  {#if config && !config.paypalConfigured}
    <p class="notice">PayPal isn't configured yet. Copy <code>.env.example</code> to <code>.env</code>, add your sandbox client ID and secret, then restart the server.</p>
  {/if}

  {#if error}
    <p class="notice error" role="alert">{error}</p>
  {/if}

  <form class="card new" onsubmit={createMilestone}>
    <h2>New milestone</h2>
    <label>
      What's being delivered
      <input bind:value={form.title} maxlength="120" required />
    </label>
    <label class="amount">
      Amount (USD)
      <input bind:value={form.amount} inputmode="decimal" required />
    </label>
    <button disabled={busy === 'create'}>Add milestone</button>
  </form>

  {#each milestones as milestone (milestone.id)}
    <article class="card">
      <div class="row">
        <h2>{milestone.title}</h2>
        <span class="badge {milestone.status}">{STATUS_LABELS[milestone.status] || milestone.status}</span>
      </div>
      <p class="amount-line">{money(milestone.amount, milestone.currency)}
        {#if milestone.releasedAmount}<span>· {money(milestone.releasedAmount, milestone.currency)} paid to freelancer</span>{/if}
        {#if milestone.returnedAmount && milestone.returnedAmount !== '0.00'}<span>· {money(milestone.returnedAmount, milestone.currency)} back to client</span>{/if}
      </p>

      {#if ['draft', 'awaiting_payment'].includes(milestone.status) && config?.paypalConfigured}
        <div class="paypal" use:paypalButtons={milestone}></div>
      {/if}

      {#if milestone.status === 'funded'}
        <div class="actions">
          <button onclick={() => release(milestone)} disabled={!!busy}>Release all</button>
          <span class="partial">
            <input placeholder="e.g. 300.00" inputmode="decimal" bind:value={partialAmounts[milestone.id]} aria-label="Partial amount" />
            <button class="secondary" onclick={() => release(milestone, partialAmounts[milestone.id])} disabled={!!busy || !partialAmounts[milestone.id]}>Release part</button>
          </span>
          <button class="danger" onclick={() => voidHold(milestone)} disabled={!!busy}>Void hold</button>
        </div>
      {/if}

      {#if milestone.authorizationId}
        <div class="paypal-truth">
          <button class="link" onclick={() => checkPaypal(milestone)} disabled={!!busy}>Check status with PayPal</button>
          {#if paypalStatus[milestone.id]}
            <span>Authorization {paypalStatus[milestone.id].id}: <strong>{paypalStatus[milestone.id].status}</strong></span>
          {/if}
        </div>
      {/if}

      <ol class="timeline">
        {#each milestone.events as event}
          <li><time>{new Date(event.at).toLocaleString()}</time> {event.type.replaceAll('_', ' ')}{event.amount ? ` · ${event.amount}` : ''}</li>
        {/each}
      </ol>
    </article>
  {:else}
    <p class="empty">No milestones yet. Add one above, then fund it with a sandbox PayPal account.</p>
  {/each}
</main>
