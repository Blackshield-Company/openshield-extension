import browser from "webextension-polyfill";
import {
  OpenShieldClient,
  backoffMs,
  parseEnvelope,
  type BackendConfig,
  type PendingApproval,
  type WireDecision,
} from "../lib/client";
import { buildContextMessage, classify, type PageContext } from "../lib/context";
import { getCurrentSession, loadConfig, setCurrentSession } from "../lib/storage";
import type { BgRequest, BgStatus } from "../lib/messages";

const ALARM = "openshield-poll";
const PING_MS = 20000; // keeps the MV3 worker alive while the socket is open
const NOTIF_PREFIX = "approval:";
const IS_FIREFOX = import.meta.env.FIREFOX;

export default defineBackground(() => {
  let config: BackendConfig | null = null;
  let client: OpenShieldClient | null = null;
  let ws: WebSocket | null = null;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  const notified = new Set<string>();
  const status: BgStatus = {
    state: "unconfigured",
    ws: "closed",
    error: null,
    approvals: [],
    currentSession: null,
  };

  function broadcast() {
    browser.runtime.sendMessage({ type: "statusChanged", status }).catch(() => {});
    const n = status.approvals.length;
    browser.action?.setBadgeText?.({ text: n ? String(n) : "" }).catch?.(() => {});
    browser.action?.setBadgeBackgroundColor?.({ color: "#C1121F" }).catch?.(() => {});
  }

  async function refresh(): Promise<void> {
    config = await loadConfig();
    status.currentSession = await getCurrentSession();
    if (!config.token) {
      status.state = "unconfigured";
      client = null;
      closeSocket();
      broadcast();
      return;
    }
    client = new OpenShieldClient(config);
    status.state = status.state === "connected" ? "connected" : "connecting";
    const h = await client.health();
    if (h.success) {
      status.state = "connected";
      status.error = null;
      status.version = h.data.version;
      await pollApprovals();
      openSocket();
    } else {
      status.state = h.status === 401 ? "unauthorized" : "disconnected";
      status.error = h.error;
    }
    broadcast();
  }

  async function pollApprovals() {
    if (!client) return;
    const r = await client.approvals();
    if (!r.success) return;
    status.approvals = r.data;
    const live = new Set(r.data.map((a) => a.id));
    for (const a of r.data) if (!notified.has(a.id)) await notify(a);
    for (const id of [...notified]) {
      if (!live.has(id)) {
        notified.delete(id);
        browser.notifications.clear(NOTIF_PREFIX + id).catch(() => {});
      }
    }
  }

  async function notify(a: PendingApproval) {
    notified.add(a.id);
    const opts: Record<string, unknown> = {
      type: "basic",
      iconUrl: browser.runtime.getURL("/icon/128.png"),
      title: `OpenShield: approve ${a.tool}? (${a.risk})`,
      message: (a.reason || JSON.stringify(a.args)).slice(0, 200),
    };
    // Firefox notifications have no buttons; clicking opens the approval popup instead.
    if (!IS_FIREFOX) {
      opts.buttons = [{ title: "Approve" }, { title: "Deny" }];
      opts.requireInteraction = true;
    }
    await browser.notifications
      .create(NOTIF_PREFIX + a.id, opts as unknown as browser.Notifications.CreateNotificationOptions)
      .catch(() => {});
  }

  async function resolve(id: string, decision: WireDecision) {
    if (!client) return { success: false, error: "Not connected" };
    const r = await client.resolveApproval(id, decision);
    browser.notifications.clear(NOTIF_PREFIX + id).catch(() => {});
    await pollApprovals();
    broadcast();
    return r;
  }

  function closeSocket() {
    clearInterval(pingTimer);
    clearTimeout(reconnectTimer);
    if (ws) {
      ws.onclose = null;
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    }
    ws = null;
    status.ws = "closed";
  }

  function openSocket(): Promise<boolean> {
    if (!client) return Promise.resolve(false);
    if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve(true);
    if (ws && ws.readyState === WebSocket.CONNECTING) return waitOpen(ws);
    let sock: WebSocket;
    try {
      sock = new WebSocket(client.chatSocketUrl());
    } catch {
      scheduleReconnect();
      return Promise.resolve(false);
    }
    ws = sock;
    sock.onopen = () => {
      attempt = 0;
      status.ws = "open";
      clearInterval(pingTimer);
      pingTimer = setInterval(() => sock.readyState === WebSocket.OPEN && sock.send('{"type":"ping"}'), PING_MS);
      broadcast();
    };
    sock.onmessage = (ev) => {
      const env = parseEnvelope(ev.data);
      if (!env) return;
      if (env.type === "approval_req" || env.type === "approval_res") void pollApprovals().then(broadcast);
      if (env.type === "turn_done" || env.type === "error") broadcast();
    };
    sock.onclose = () => {
      clearInterval(pingTimer);
      status.ws = "closed";
      ws = null;
      broadcast();
      scheduleReconnect();
    };
    return waitOpen(sock);
  }

  function waitOpen(sock: WebSocket, ms = 3000): Promise<boolean> {
    return new Promise((res) => {
      if (sock.readyState === WebSocket.OPEN) return res(true);
      const t = setTimeout(() => res(false), ms);
      sock.addEventListener("open", () => (clearTimeout(t), res(true)), { once: true });
      sock.addEventListener("close", () => (clearTimeout(t), res(false)), { once: true });
    });
  }

  function scheduleReconnect() {
    if (status.state !== "connected") return; // the poll alarm retries health first
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => void openSocket(), backoffMs(attempt++));
  }

  async function sendContext(ctx: PageContext, newSession: boolean) {
    await refresh();
    if (!client || status.state !== "connected") {
      return toast("Not connected", status.error ?? "Open the extension settings to pair with OpenShield.");
    }
    let session = newSession ? null : status.currentSession;
    if (!session) {
      const s = await client.createSession();
      if (!s.success) return toast("Could not create a session", s.error);
      session = s.data.id;
      await setCurrentSession(session);
      status.currentSession = session;
    }
    if (!(await openSocket()) || !ws) return toast("Send failed", "The chat socket is not open.");
    ws.send(JSON.stringify({ type: "chat", session, message: buildContextMessage(ctx) }));
    broadcast();
    toast("Sent to OpenShield", `${ctx.kind} → session ${session.slice(0, 8)}`);
  }

  function toast(title: string, message: string) {
    browser.notifications
      .create({ type: "basic", iconUrl: browser.runtime.getURL("/icon/128.png"), title, message })
      .catch(() => {});
  }

  async function pageText(tabId: number): Promise<string> {
    try {
      const [res] = await browser.scripting.executeScript({
        target: { tabId },
        func: () => document.body?.innerText ?? "",
      });
      return String(res?.result ?? "");
    } catch {
      return "";
    }
  }

  // ── Context menus ──────────────────────────────────────────────────────
  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.removeAll().then(() => {
      for (const [ctx, label] of [
        ["selection", "Send selection to OpenShield"],
        ["page", "Send page to OpenShield"],
      ] as const) {
        browser.contextMenus.create({ id: `${ctx}`, title: label, contexts: [ctx] });
        browser.contextMenus.create({ id: `${ctx}:current`, parentId: ctx, title: "Current session", contexts: [ctx] });
        browser.contextMenus.create({ id: `${ctx}:new`, parentId: ctx, title: "New session", contexts: [ctx] });
      }
    });
  });

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    const [ctx, target] = String(info.menuItemId).split(":");
    if (!target || !tab) return;
    const url = info.pageUrl ?? tab.url ?? "";
    const selection = ctx === "selection" ? (info.selectionText ?? "") : "";
    const text = selection || (tab.id !== undefined ? await pageText(tab.id) : "");
    await sendContext({ kind: classify(url, !!selection), url, title: tab.title ?? "", text }, target === "new");
  });

  // ── Notifications ──────────────────────────────────────────────────────
  browser.notifications.onButtonClicked?.addListener((nid, idx) => {
    if (!nid.startsWith(NOTIF_PREFIX)) return;
    void resolve(nid.slice(NOTIF_PREFIX.length), idx === 0 ? "approve" : "reject");
  });
  browser.notifications.onClicked.addListener((nid) => {
    if (!nid.startsWith(NOTIF_PREFIX)) return;
    void browser.windows.create({ url: browser.runtime.getURL("/popup.html"), type: "popup", width: 380, height: 560 });
  });

  // ── Messages from popup/options ─────────────────────────────────────────
  browser.runtime.onMessage.addListener((raw: unknown) => {
    const msg = raw as BgRequest;
    switch (msg?.type) {
      case "status":
        return Promise.resolve(status);
      case "reconnect":
        closeSocket();
        return refresh().then(() => status);
      case "resolve":
        return resolve(msg.id, msg.decision);
      case "setSession":
        return setCurrentSession(msg.id).then(() => {
          status.currentSession = msg.id;
          broadcast();
          return status;
        });
    }
    return undefined;
  });

  // Workers sleep; the alarm wakes us to re-check health, approvals and the socket.
  browser.alarms.create(ALARM, { periodInMinutes: 1 });
  browser.alarms.onAlarm.addListener((a) => a.name === ALARM && void refresh());
  browser.storage.onChanged.addListener((changes) => {
    if ("openshield.connection" in changes) {
      closeSocket();
      void refresh();
    }
  });
  void refresh();
});
