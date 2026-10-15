import { describe, expect, it } from "vitest";
import {
  OpenShieldClient,
  PAIR_RATE_LIMIT_ERROR,
  TOKEN_REQUIRED_ERROR,
  UNAUTHORIZED_ERROR,
  backoffMs,
  isPrivateHost,
  originPattern,
  parseEnvelope,
  unwrapList,
  validateConfig,
  type FetchLike,
} from "../src/lib/client";

const cfg = { host: "127.0.0.1", port: 9310, token: "tok" };

function fakeFetch(status: number, body: unknown, seen: { url?: string; init?: RequestInit }[] = []): FetchLike {
  return async (url, init) => {
    seen.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
}

describe("validateConfig", () => {
  it("accepts loopback and LAN", () => {
    expect(validateConfig({ ...cfg, token: " t " })).toEqual({ success: true, data: { ...cfg, token: "t" } });
    expect(validateConfig({ ...cfg, host: "192.168.1.20" }).success).toBe(true);
    expect(validateConfig({ ...cfg, host: "[::1]" }).success).toBe(true);
  });
  it("rejects public hosts, bad ports, empty tokens", () => {
    expect(validateConfig({ ...cfg, host: "8.8.8.8" }).success).toBe(false);
    expect(validateConfig({ ...cfg, host: "example.com" }).success).toBe(false);
    expect(validateConfig({ ...cfg, host: "a b" }).success).toBe(false);
    expect(validateConfig({ ...cfg, port: 70000 }).success).toBe(false);
    expect(validateConfig({ ...cfg, token: "  " })).toEqual({ success: false, error: TOKEN_REQUIRED_ERROR });
  });
  it("classifies private ranges", () => {
    for (const h of ["10.0.0.1", "172.16.0.1", "172.31.9.9", "169.254.1.1", "box.local", "localhost"])
      expect(isPrivateHost(h)).toBe(true);
    for (const h of ["172.32.0.1", "11.0.0.1", "github.com"]) expect(isPrivateHost(h)).toBe(false);
  });
});

describe("OpenShieldClient", () => {
  it("sends the bearer token on every request", async () => {
    const seen: { url?: string; init?: RequestInit }[] = [];
    const c = new OpenShieldClient(cfg, fakeFetch(200, { version: "1.1.1" }, seen));
    const r = await c.health();
    expect(r).toEqual({ success: true, data: { version: "1.1.1" } });
    expect(seen[0].url).toBe("http://127.0.0.1:9310/api/v1/health");
    expect((seen[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });
  it("refuses to call without a token", async () => {
    const c = new OpenShieldClient({ ...cfg, token: "" }, fakeFetch(200, {}));
    expect(await c.health()).toEqual({ success: false, error: TOKEN_REQUIRED_ERROR });
  });
  it("maps 401 and 429", async () => {
    expect(await new OpenShieldClient(cfg, fakeFetch(401, {})).health()).toMatchObject({ error: UNAUTHORIZED_ERROR, status: 401 });
    expect(await new OpenShieldClient(cfg, fakeFetch(429, {})).health()).toMatchObject({ error: PAIR_RATE_LIMIT_ERROR });
    expect(await new OpenShieldClient(cfg, fakeFetch(500, {})).health()).toMatchObject({ success: false, status: 500 });
  });
  it("reports network errors as results", async () => {
    const c = new OpenShieldClient(cfg, async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(await c.health()).toEqual({ success: false, error: "ECONNREFUSED" });
  });
  it("unwraps sessions, messages and approvals", async () => {
    expect(await new OpenShieldClient(cfg, fakeFetch(200, { sessions: [{ id: "a" }] })).sessions()).toEqual({ success: true, data: [{ id: "a" }] });
    expect(await new OpenShieldClient(cfg, fakeFetch(200, { messages: [{ role: "user", content: "x" }] })).messages("a")).toMatchObject({ data: [{ role: "user" }] });
    expect(await new OpenShieldClient(cfg, fakeFetch(200, [{ id: "p1" }])).approvals()).toMatchObject({ data: [{ id: "p1" }] });
  });
  it("posts approval decisions", async () => {
    const seen: { url?: string; init?: RequestInit }[] = [];
    await new OpenShieldClient(cfg, fakeFetch(200, { ok: true }, seen)).resolveApproval("id/1", "reject");
    expect(seen[0].url).toBe("http://127.0.0.1:9310/api/v1/approvals/id%2F1");
    expect(seen[0].init?.method).toBe("POST");
    expect(JSON.parse(String(seen[0].init?.body))).toEqual({ decision: "reject" });
  });
  it("builds the chat socket URL with ?token=", () => {
    expect(new OpenShieldClient({ ...cfg, token: "a b" }).chatSocketUrl()).toBe("ws://127.0.0.1:9310/ws/v1/chat?token=a%20b");
  });
});

describe("helpers", () => {
  it("unwrapList tolerates junk", () => {
    expect(unwrapList(null, "x")).toEqual([]);
    expect(unwrapList({ x: 1 }, "x")).toEqual([]);
  });
  it("parseEnvelope", () => {
    expect(parseEnvelope('{"type":"approval_req","session":"s"}')).toEqual({ type: "approval_req", session: "s" });
    expect(parseEnvelope("nope")).toBeNull();
    expect(parseEnvelope('{"no":"type"}')).toBeNull();
  });
  it("backoff is capped", () => {
    expect(backoffMs(0)).toBe(1000);
    expect(backoffMs(3)).toBe(8000);
    expect(backoffMs(20)).toBe(30000);
  });
  it("originPattern", () => expect(originPattern({ host: "192.168.1.5" })).toBe("http://192.168.1.5/*"));
});
