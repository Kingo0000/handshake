<script>
  import { api } from '../api.js';
  import { formatMoney } from '../money.js';

  let { config, oncreate, onerror } = $props();

  const SAMPLE = `[10:02] Dana (Brightside Coffee): hey Ada! so we need a site for the coffee shop before the holidays
[10:03] Dana: landing page w/ our menu + prices, and people should be able to order ahead for pickup
[10:03] Dana: most ppl will see it on their phones from instagram so it HAS to work on mobile
[10:04] Dana: and make it look premium, like really pop
[10:05] Dana: fast too, our current wix site takes forever
[10:06] Dana: budget is $600. can you do the page first and then hook up instagram + google maps after?`;

  let brief = $state('');
  let drafting = $state(false);
  let saving = $state(false);
  let draft = $state(null);

  const total = $derived(draft ? draft.milestones.reduce((sum, m) => sum + Number(m.amount || 0), 0) : 0);

  async function generate() {
    drafting = true;
    try {
      draft = await api('/contracts/draft', { method: 'POST', body: { brief } });
    } catch (e) {
      onerror(e.message);
    } finally {
      drafting = false;
    }
  }

  async function accept() {
    saving = true;
    try {
      const result = await api('/contracts', { method: 'POST', body: draft });
      oncreate(result);
      draft = null;
      brief = '';
    } catch (e) {
      onerror(e.message);
    } finally {
      saving = false;
    }
  }

  const removeCriterion = (m, j) => (m.criteria = m.criteria.filter((_, k) => k !== j));
</script>

<section class="drafter">
  <div class="drafter-head">
    <div>
      <p class="eyebrow">Step 1 · Agree</p>
      <h2>Turn a messy brief into a contract a machine can check</h2>
    </div>
    {#if config && !config.aiConfigured}
      <span class="chip open"><span class="dot"></span>Add OPENAI_API_KEY to enable</span>
    {/if}
  </div>

  {#if !draft}
    <label class="field">
      <span>Paste the brief or chat thread</span>
      <textarea class="brief" bind:value={brief} rows="6" placeholder="Paste a WhatsApp, email or Slack thread with the client…"></textarea>
    </label>
    <div class="row-actions">
      <button class="primary" onclick={generate} disabled={drafting || brief.trim().length < 20}>
        {#if drafting}<span class="spin"></span>Drafting milestones…{:else}Draft contract with AI{/if}
      </button>
      <button class="ghost small" onclick={() => (brief = SAMPLE)} disabled={drafting}>Use a sample brief</button>
    </div>
  {:else}
    <div class="draft">
      <div class="draft-title">
        <input class="title-input" bind:value={draft.title} aria-label="Contract title" />
        <p class="meta">{draft.summary}</p>
      </div>
      {#each draft.milestones as m, i}
        <div class="draft-ms">
          <div class="draft-ms-head">
            <span class="ms-num">{i + 1}</span>
            <input class="ms-title" bind:value={m.title} aria-label="Milestone title" />
            <div class="money-input slim"><span class="prefix">$</span><input bind:value={m.amount} inputmode="decimal" aria-label="Amount" /></div>
            <span class="meta">due in {m.due_days} days</span>
          </div>
          <ul class="criteria edit">
            {#each m.criteria as c, j}
              <li class:vague={c.vague}>
                <span class="method">{c.check_method}</span>
                <div>
                  <input bind:value={c.statement} aria-label="Criterion" />
                  {#if c.vague}<p class="rewrote">Rewrote “{c.suggestion}” into something checkable</p>{/if}
                </div>
                <button class="x" aria-label="Remove criterion" onclick={() => removeCriterion(m, j)}>×</button>
              </li>
            {/each}
          </ul>
        </div>
      {/each}
      <div class="row-actions">
        <button class="primary" onclick={accept} disabled={saving}>{saving ? 'Freezing…' : `Accept & freeze contract · ${formatMoney(total)}`}</button>
        <button class="ghost small" onclick={() => (draft = null)}>Start over</button>
        <span class="meta">Both sides sign this version. It's hashed, and every payment decision cites it.</span>
      </div>
    </div>
  {/if}
</section>
