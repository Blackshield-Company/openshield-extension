import browser from "webextension-polyfill";
import { defaultConfig, type BackendConfig } from "./client";

// storage.local only (never storage.sync): the token must not leave this browser profile.
const KEY = "openshield.connection";
const SESSION_KEY = "openshield.currentSession";

export async function loadConfig(): Promise<BackendConfig> {
  const got = await browser.storage.local.get(KEY);
  return { ...defaultConfig(), ...((got[KEY] as Partial<BackendConfig>) ?? {}) };
}

export async function saveConfig(c: BackendConfig): Promise<void> {
  await browser.storage.local.set({ [KEY]: c });
}

export async function clearConfig(): Promise<void> {
  await browser.storage.local.remove([KEY, SESSION_KEY]);
}

export async function getCurrentSession(): Promise<string | null> {
  const got = await browser.storage.local.get(SESSION_KEY);
  return (got[SESSION_KEY] as string) ?? null;
}

export async function setCurrentSession(id: string | null): Promise<void> {
  if (id) await browser.storage.local.set({ [SESSION_KEY]: id });
  else await browser.storage.local.remove(SESSION_KEY);
}
