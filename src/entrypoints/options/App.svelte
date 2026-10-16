<script lang="ts">
  import ShieldMark from "../../lib/ShieldMark.svelte";
  import browser from "webextension-polyfill";
  import { OpenShieldClient, isLocalHost, originPattern, validateConfig } from "../../lib/client";
  import { clearConfig, loadConfig, saveConfig } from "../../lib/storage";

  let host = $state("127.0.0.1");
  let port = $state(9310);
  let token = $state("");
  let message = $state<{ ok: boolean; text: string } | null>(null);
  const extOrigin = location.origin;

  loadConfig().then((c) => ((host = c.host), (port = c.port), (token = c.token)));

  async function save(e: Event) {
    e.preventDefault();
    const v = validateConfig({ host, port: Number(port), token });
    if (!v.success) return (message = { ok: false, text: v.error });
    // LAN hosts need an explicit, user-granted host permission.
    if (!isLocalHost(v.data.host)) {
      const granted = await browser.permissions.request({ origins: [originPattern(v.data)] });
      if (!granted) return (message = { ok: false, text: "Permission for that host was not granted." });
    }
    await saveConfig(v.data);
    const h = await new OpenShieldClient(v.data).health();
    message = h.success
      ? { ok: true, text: `Connected to OpenShield ${h.data.version ?? ""}`.trim() }
      : { ok: false, text: `Saved, but the server did not answer: ${h.error}` };
  }

  async function forget() {
    await clearConfig();
    token = "";
    message = { ok: true, text: "Pairing removed from this browser." };
  }
</script>

<main>
  <h1 class="title"><ShieldMark size={22} /> OpenShield settings</h1>
  <form onsubmit={save}>
    <label>Host <input bind:value={host} autocomplete="off" /></label>
    <label>Port <input type="number" min="1" max="65535" bind:value={port} /></label>
    <label>Pairing token <input type="password" bind:value={token} autocomplete="off" /></label>
    <div class="row">
      <button class="primary" type="submit">Save and test</button>
      <button type="button" onclick={forget}>Forget pairing</button>
    </div>
  </form>
  {#if message}<p class={message.ok ? "" : "err"}>{message.text}</p>{/if}

  <h2>Server setup</h2>
  <p class="muted">
    Requires <code>openshield serve</code> 1.1.1 or newer. The token is required on every request and is kept in
    this browser's local extension storage only. Add this extension's origin to the server's CORS allowlist in
    <code>~/.config/openshield/config.toml</code>:
  </p>
  <pre>[desktop]
allowed_origins = ["{extOrigin}"]</pre>
  <p class="muted">Only loopback and LAN hosts are accepted. Never expose port 9310 to the internet.</p>
</main>

<style>
  .title { display: flex; align-items: center; gap: 10px; }
  main { max-width: 520px; margin: 24px auto; padding: 0 16px; }
  label { display: block; margin: 10px 0; }
  .row { display: flex; gap: 8px; margin-top: 12px; }
  pre { background: var(--bs-field); padding: 8px; border-radius: 4px; user-select: all; }
</style>
