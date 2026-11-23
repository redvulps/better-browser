import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { listedBrowsers, reply, validEndpoint, type Action, type SessionCommand } from '../shared/protocol.js';

const configured = process.env.BETTER_BROWSER_URL;
export const base = validEndpoint(configured || 'http://127.0.0.1:8717', 'http');
let starting: Promise<void> | undefined;
let discoveryGraceUntil = 0;
async function launchLocal() {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./bridge.js', import.meta.url))], {
    detached: true, stdio: 'ignore', env: { ...process.env, BETTER_BROWSER_HOST: '127.0.0.1', BETTER_BROWSER_PORT: '8717', BETTER_BROWSER_CERT: '', BETTER_BROWSER_KEY: '' }
  });
  child.unref();
  for (let i = 0; i < 20; i++) {
    await delay(100);
    try {
      const res = await fetch(new URL('/browsers', base), { redirect: 'error', signal: AbortSignal.timeout(500) });
      await res.body?.cancel();
      discoveryGraceUntil = Date.now() + 3000;
      return;
    } catch { /* Bridge is still starting. */ }
  }
}
async function request(path: string, init: RequestInit = {}) {
  const send = () => fetch(new URL(path, base), { ...init, redirect: 'error', signal: AbortSignal.timeout(17000) });
  try { return await send(); }
  catch (error) {
    if (configured || (error as { cause?: NodeJS.ErrnoException }).cause?.code !== 'ECONNREFUSED') {
      throw new Error('Ponte inacessível. Confira o endereço configurado e se a ponte está em execução.');
    }
    starting ??= launchLocal().finally(() => { starting = undefined; });
    await starting;
    return send();
  }
}
export async function discover() {
  // After cold start, allow one reconnect interval for a running extension.
  for (;;) {
    const response = await request('/browsers');
    if (!response.ok) throw new Error('A ponte não oferece descoberta. Reinicie a ponte com a versão atualizada.');
    const peers = listedBrowsers.parse(await response.json());
    if (peers.length || Date.now() >= discoveryGraceUntil) return peers;
    await delay(250);
  }
}
export async function call(path: string, token: string, command?: Action | SessionCommand) {
  const response = await request(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: command ? JSON.stringify(command) : undefined
  });
  if (command && 'sessionId' in command && response.status === 404) {
    throw new Error('Reinicie a ponte Better Browser com a versão 0.3 ou superior para usar os grupos BetterBrowser.');
  }
  return reply.parse(await response.json());
}
