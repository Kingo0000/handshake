<script>
  import { onMount } from 'svelte';
  import { api } from './api.js';
  import Composer from './components/Composer.svelte';
  import MilestoneCard from './components/MilestoneCard.svelte';
  import Summary from './components/Summary.svelte';

  let config = $state(null);
  let milestones = $state([]);
  let loading = $state(true);
  let error = $state('');

  onMount(async () => {
    try {
      [config, milestones] = await Promise.all([api('/config'), api('/milestones')]);
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
    }
  });

  function replace(updated) {
    milestones = milestones.map((m) => (m.id === updated.id ? updated : m));
  }
</script>

<div class="shell">
  <header class="topbar">
    <div class="brand">
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="9" fill="var(--accent)" />
        <path d="M8 17.5l4.2 4.2a2 2 0 0 0 2.8 0L24 12.7M8 11.5h6M18 20.5h6" stroke="var(--accent-ink)" stroke-width="2.4" stroke-linecap="round" fill="none" />
      </svg>
      <span>Handshake</span>
    </div>
    {#if config}
      <span class="env-pill" class:live={config.paypalEnv === 'live'}>
        <span class="dot"></span>PayPal {config.paypalEnv}
      </span>
    {/if}
  </header>

  <main>
    <section class="intro">
      <p class="eyebrow">Milestone payments</p>
      <h1>Get paid for the work,<br /><em>not the argument.</em></h1>
      <p class="lede">Clients fund each milestone up front with a PayPal hold. When the work lands, release it in full, release part of it, or return it. Every cent is accounted for.</p>
    </section>

    {#if error}
      <div class="banner error" role="alert">
        <strong>Something went wrong.</strong> {error}
        <button class="ghost small" onclick={() => (error = '')}>Dismiss</button>
      </div>
    {/if}

    {#if config && !config.paypalConfigured}
      <div class="banner">
        <strong>Connect PayPal sandbox to fund milestones.</strong>
        Copy <code>.env.example</code> to <code>.env</code>, add your sandbox client ID and secret, then restart <code>npm run dev</code>.
      </div>
    {/if}

    <Summary {milestones} />

    <div class="layout">
      <section class="list" aria-label="Milestones">
        <div class="section-head">
          <h2>Milestones</h2>
          <span class="count">{milestones.length}</span>
        </div>

        {#if loading}
          <div class="skeleton"></div>
          <div class="skeleton"></div>
        {:else}
          {#each milestones as milestone (milestone.id)}
            <MilestoneCard {milestone} {config} onupdate={replace} onerror={(message) => (error = message)} />
          {:else}
            <div class="empty">
              <div class="empty-art" aria-hidden="true">
                <span></span><span></span><span></span>
              </div>
              <h3>No milestones yet</h3>
              <p>Break the job into milestones on the right. Each one is funded and released separately.</p>
            </div>
          {/each}
        {/if}
      </section>

      <aside class="side">
        <Composer oncreate={(m) => (milestones = [m, ...milestones])} onerror={(message) => (error = message)} />

        <div class="how">
          <h3>How money moves</h3>
          <ol>
            <li><span class="step-dot held"></span><div><strong>Client funds</strong><p>PayPal places a hold. Nothing is charged yet, but the freelancer can see it's there.</p></div></li>
            <li><span class="step-dot paid"></span><div><strong>Work is delivered</strong><p>Release all of it, or part of it if only some of the work meets the brief.</p></div></li>
            <li><span class="step-dot back"></span><div><strong>The rest goes back</strong><p>Anything not released returns to the client automatically.</p></div></li>
          </ol>
        </div>
      </aside>
    </div>
  </main>
</div>
