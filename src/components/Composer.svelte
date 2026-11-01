<script>
  import { api } from '../api.js';
  import { formatMoney } from '../money.js';

  let { oncreate, onerror } = $props();

  let title = $state('');
  let amount = $state('');
  let saving = $state(false);

  const valid = $derived(title.trim().length > 0 && Number(amount) >= 1);

  async function submit(event) {
    event.preventDefault();
    if (!valid) return;
    saving = true;
    try {
      oncreate(await api('/milestones', { method: 'POST', body: { title, amount, currency: 'USD' } }));
      title = '';
      amount = '';
    } catch (e) {
      onerror(e.message);
    } finally {
      saving = false;
    }
  }
</script>

<form class="composer" onsubmit={submit}>
  <h3>New milestone</h3>
  <label class="field">
    <span>Deliverable</span>
    <input bind:value={title} maxlength="120" placeholder="Landing page, mobile + desktop" required />
  </label>
  <label class="field">
    <span>Amount</span>
    <div class="money-input">
      <span class="prefix">$</span>
      <input bind:value={amount} inputmode="decimal" placeholder="400.00" required />
      <span class="suffix">USD</span>
    </div>
  </label>
  <button class="primary block" disabled={!valid || saving}>
    {saving ? 'Adding…' : valid ? `Add ${formatMoney(amount)} milestone` : 'Add milestone'}
  </button>
</form>
