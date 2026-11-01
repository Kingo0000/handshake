<script>
  import { formatMoney, fromCents, toCents } from '../money.js';

  let { milestone, busy, onrelease, onvoid } = $props();

  const PRESETS = [100, 75, 50, 25];

  let percent = $state(100);
  let custom = $state('');
  let confirming = $state(null);

  const total = $derived(toCents(milestone.amount));
  const releaseCents = $derived(
    percent === 'custom' ? Math.min(toCents(custom), total) : Math.floor((total * percent) / 100),
  );
  const returnCents = $derived(total - releaseCents);
  const valid = $derived(releaseCents > 0 && releaseCents <= total);

  function pick(value) {
    percent = value;
    confirming = null;
  }

  // Money moves can't be undone, so each one takes a second click.
  function confirmOr(kind, fn) {
    if (confirming === kind) {
      confirming = null;
      fn();
    } else {
      confirming = kind;
    }
  }
</script>

<div class="settle">
  <div class="settle-head">
    <h4>Settle this milestone</h4>
    <div class="segmented" role="radiogroup" aria-label="How much to release">
      {#each PRESETS as value}
        <button role="radio" aria-checked={percent === value} class:active={percent === value} onclick={() => pick(value)}>
          {value === 100 ? 'All' : `${value}%`}
        </button>
      {/each}
      <button role="radio" aria-checked={percent === 'custom'} class:active={percent === 'custom'} onclick={() => pick('custom')}>Custom</button>
    </div>
  </div>

  {#if percent === 'custom'}
    <label class="field inline">
      <span>Amount to release</span>
      <div class="money-input">
        <span class="prefix">$</span>
        <input bind:value={custom} inputmode="decimal" placeholder="0.00" oninput={() => (confirming = null)} />
        <span class="suffix">of {formatMoney(milestone.amount, milestone.currency)}</span>
      </div>
    </label>
  {/if}

  <div class="split">
    <div class="split-bar">
      <span class="paid" style:width="{(releaseCents / total) * 100}%"></span>
      <span class="back" style:width="{(returnCents / total) * 100}%"></span>
    </div>
    <div class="split-legend">
      <span><span class="swatch paid"></span>Freelancer gets <strong>{formatMoney(fromCents(releaseCents), milestone.currency)}</strong></span>
      <span><span class="swatch back"></span>Client gets back <strong>{formatMoney(fromCents(returnCents), milestone.currency)}</strong></span>
    </div>
  </div>

  <div class="settle-actions">
    <button class="primary" disabled={busy || !valid} class:confirm={confirming === 'release'}
      onclick={() => confirmOr('release', () => onrelease(fromCents(releaseCents)))}>
      {confirming === 'release' ? `Confirm: pay ${formatMoney(fromCents(releaseCents), milestone.currency)}` : `Release ${formatMoney(fromCents(releaseCents), milestone.currency)}`}
    </button>
    <button class="ghost danger" disabled={busy} class:confirm={confirming === 'void'}
      onclick={() => confirmOr('void', onvoid)}>
      {confirming === 'void' ? 'Confirm: refund everything' : 'Void and refund'}
    </button>
    {#if confirming}
      <button class="ghost small" onclick={() => (confirming = null)}>Cancel</button>
    {/if}
  </div>
</div>
