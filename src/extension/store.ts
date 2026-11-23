import { randomKey, type Identity } from '../shared/protocol.js';

export interface Entry { time: number; origin: string; action: string; ok: boolean }
export const defaultEndpoint = 'ws://127.0.0.1:8717/browser';
export const initialized = (async () => {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const { token, browser } = await chrome.storage.local.get(['token', 'browser']);
  if (!token) await chrome.storage.local.set({ token: randomKey() });
  if (!browser) {
    const nav = navigator as Navigator & { brave?: { isBrave(): Promise<boolean> } };
    const name = (await nav.brave?.isBrave()) ? 'Brave' : 'Chrome - Chromium';
    await chrome.storage.local.set({ browser: { id: crypto.randomUUID(), name } });
  }
})();
export async function settings() {
  await initialized;
  const values = await chrome.storage.local.get(['token', 'browser', 'endpoint']);
  return { token: values.token as string, browser: values.browser as Identity, endpoint: (values.endpoint as string) || defaultEndpoint };
}
let writes = Promise.resolve();
export function record(origin: string, action: string, ok = true) {
  writes = writes.catch(() => {}).then(async () => {
    const { history } = await chrome.storage.local.get('history');
    const entry: Entry = { time: Date.now(), origin, action, ok };
    await chrome.storage.local.set({ history: [entry, ...(Array.isArray(history) ? history : [])].slice(0, 200) });
  });
  return writes;
}
