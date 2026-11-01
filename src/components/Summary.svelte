<script>
  import { formatMoney, fromCents, toCents } from '../money.js';

  let { milestones } = $props();

  const totals = $derived.by(() => {
    let held = 0, paid = 0, returned = 0, open = 0;
    for (const m of milestones) {
      if (m.status === 'funded') held += toCents(m.amount);
      if (['draft', 'awaiting_payment'].includes(m.status)) open += toCents(m.amount);
      paid += toCents(m.releasedAmount);
      returned += toCents(m.returnedAmount);
    }
    return { held: fromCents(held), paid: fromCents(paid), returned: fromCents(returned), open: fromCents(open) };
  });
</script>

<section class="summary" aria-label="Totals">
  <div class="stat">
    <span class="label"><span class="swatch held"></span>Held in PayPal</span>
    <span class="value">{formatMoney(totals.held)}</span>
  </div>
  <div class="stat">
    <span class="label"><span class="swatch paid"></span>Paid to freelancer</span>
    <span class="value">{formatMoney(totals.paid)}</span>
  </div>
  <div class="stat">
    <span class="label"><span class="swatch back"></span>Returned to client</span>
    <span class="value">{formatMoney(totals.returned)}</span>
  </div>
  <div class="stat">
    <span class="label"><span class="swatch open"></span>Not yet funded</span>
    <span class="value">{formatMoney(totals.open)}</span>
  </div>
</section>
