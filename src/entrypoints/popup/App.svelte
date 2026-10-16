<script lang="ts">
  import KnightSprite from "../../lib/KnightSprite.svelte";
  import browser from "webextension-polyfill";
  import { OpenShieldClient, type SessionMessage, type SessionSummary, type WireDecision } from "../../lib/client";
  import { loadConfig } from "../../lib/storage";
  import type { BgStatus } from "../../lib/messages";

  let status = $state<BgStatus | null>(null);
  // Header knight mirrors the connection: pending approvals put him to work.
  const knight = $derived(
    !status || status.state === "connecting"
      ? "thinking"
      : status.state === "connected"
        ? status.approvals.length > 0
          ? "working"
          : "idle"
        : status.state === "unconfigured"
          ? "idle"
          : "error",
  );
  let sessions = $state<SessionSummary[]>([]);
  let messages = $state<SessionMessage[]>([]);
  let busy = $state<string | null>(null);

  const colors: Record<string, string> = {
    connected: "var(--bs-ok)", connecting: "var(--bs-warn)", disconnected: "var(--bs-accent)",
    unauthorized: "var(--bs-accent)", unconfigured: "var(--bs-muted)",
  };

  async function load() {
    status = (await browser.runtime.sendMessage({ type: "status" })) as BgStatus;
    if (status?.state !== "connected") return;
    const client = new OpenShieldClient(await loadConfig());
    const s = await client.sessions();
    if (s.success) sessions = s.data.slice(0, 8);
    if (status.currentSession) {
      const m = await client.messages(status.currentSession);
      if (m.success) messages = m.data.slice(-5);
    } else messages = [];
  }

  async function decide(id: string, decision: WireDecision) {
    busy = id;
    await browser.runtime.sendMessage({ type: "resolve", id, decision });
    busy = null;
    await load();
  }

  async function pick(id: string | null) {
    await browser.runtime.sendMessage({ type: "setSession", id });
    await load();
  }

  async function reconnect() {
    await browser.runtime.sendMessage({ type: "reconnect" });
    await load();
  }

  browser.runtime.onMessage.addListener((m: any) => {
    if (m?.type === "statusChanged") status = m.status;
  });
  load();
</script>

<main>
  <header>
    <KnightSprite state={knight} size={32} label={`OpenShield: ${status?.state ?? "loading"}`} />
    <h1>OpenShield</h1>
    <button class="link" onclick={() => browser.runtime.openOptionsPage()}>Settings</button>
  </header>

  {#if status}
    <p>
      <span class="dot" style:background={colors[status.state]}></span>{status.state}
      {#if status.version}<span class="muted">· v{status.version}</span>{/if}
      <span class="muted">· stream {status.ws}</span>
      <button onclick={reconnect}>Retry</button>
    </p>
    {#if status.error}<p class="err">{status.error}</p>{/if}
    {#if status.state === "unconfigured"}
      <p class="muted">Not paired yet. Open Settings and paste a token from <code>openshield serve</code>.</p>
    {/if}

    <h2>Pending approvals ({status.approvals.length})</h2>
    {#each status.approvals as a (a.id)}
      <div class="card">
        <strong>{a.tool}</strong> <span class="muted">{a.risk} · {a.session.slice(0, 8)}</span>
        <div class="muted args">{a.reason || JSON.stringify(a.args)}</div>
        <div class="row">
          <button class="primary" disabled={busy === a.id} onclick={() => decide(a.id, "approve")}>Approve</button>
          <button disabled={busy === a.id} onclick={() => decide(a.id, "reject")}>Deny</button>
        </div>
      </div>
    {:else}
      <p class="muted">Nothing waiting.</p>
    {/each}

    <h2>Sessions</h2>
    <button onclick={() => pick(null)} class:primary={!status.currentSession}>New session on next send</button>
    {#each sessions as s (s.id)}
      <div class="card session" class:current={s.id === status.currentSession}>
        <button class="link" onclick={() => pick(s.id)}>{s.title || s.id.slice(0, 8)}</button>
        {#if s.id === status.currentSession}<span class="muted">current</span>{/if}
      </div>
    {/each}

    {#if messages.length}
      <h2>Last messages</h2>
      {#each messages as m, i (i)}
        <div class="card"><span class="muted">{m.role}</span><div class="msg">{m.content.slice(0, 280)}</div></div>
      {/each}
    {/if}
  {/if}
</main>

<style>
  main { width: 340px; padding: 12px; }
  header { display: flex; align-items: center; gap: 8px; }
  header h1 { flex: 1; }
  .row { display: flex; gap: 6px; margin-top: 6px; }
  .args, .msg { white-space: pre-wrap; word-break: break-word; max-height: 6em; overflow: hidden; }
  .link { background: none; border: none; color: var(--bs-text); text-decoration: underline; padding: 0; }
  .session { display: flex; justify-content: space-between; }
  .current { border-color: var(--bs-accent); }
</style>
