// Optional smoke test against a real `openshield serve`.
// Run: OPENSHIELD_URL=http://127.0.0.1:9310 OPENSHIELD_TOKEN=... npm test
import { describe, expect, it } from "vitest";
import { OpenShieldClient } from "../src/lib/client";
import { buildContextMessage } from "../src/lib/context";

const url = process.env.OPENSHIELD_URL;
const token = process.env.OPENSHIELD_TOKEN;

describe.skipIf(!url || !token)("live openshield serve", () => {
  const u = new URL(url ?? "http://127.0.0.1:9310");
  const client = new OpenShieldClient({ host: u.hostname, port: Number(u.port || 9310), token: token ?? "" });

  it("health, sessions, approvals", async () => {
    expect((await client.health()).success).toBe(true);
    expect((await new OpenShieldClient({ ...client.config, token: "wrong" }).health())).toMatchObject({ status: 401 });
    const s = await client.createSession();
    expect(s.success).toBe(true);
    expect((await client.sessions()).success).toBe(true);
    expect((await client.approvals()).success).toBe(true);
  });

  it.skipIf(typeof WebSocket === "undefined")("chat socket accepts a context frame", async () => {
    const s = await client.createSession();
    if (!s.success) throw new Error(s.error);
    const ws = new WebSocket(client.chatSocketUrl());
    await new Promise<void>((res, rej) => ((ws.onopen = () => res()), (ws.onerror = () => rej(new Error("ws error")))));
    const frames: string[] = [];
    ws.onmessage = (e) => frames.push(String(e.data));
    ws.send(JSON.stringify({ type: "chat", session: s.data.id, message: buildContextMessage({ kind: "page", url: "https://example.com", title: "t", text: "hi" }) }));
    await new Promise((r) => setTimeout(r, 3000));
    ws.close();
    expect(frames.length).toBeGreaterThan(0);
  }, 10000);
});
