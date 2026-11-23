// Mini validates objects without dynamic code generation in the MV3 worker.
import * as z from 'zod/mini';

const ref = z.string().check(z.minLength(1), z.maxLength(100));
const field = z.object({ ref, value: z.string().check(z.maxLength(4000)) });
const url = z.url().check(z.maxLength(4000));
const tabId = z.int().check(z.minimum(0));
export const actions = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status') }),
  z.object({ action: z.literal('open'), url: z.optional(url) }),
  z.object({ action: z.literal('tabs'), offset: z.optional(z.int().check(z.minimum(0))) }),
  z.object({ action: z.literal('select'), tabId }),
  z.object({ action: z.literal('close'), tabId }),
  z.object({ action: z.literal('read') }),
  z.object({ action: z.literal('click'), ref }),
  z.object({ action: z.literal('fill'), fields: z.array(field).check(z.minLength(1), z.maxLength(30)) }),
  z.object({ action: z.literal('navigate'), url })
]);
export type Action = z.infer<typeof actions>;
export type PageAction = Extract<Action, { action: 'read' | 'click' | 'fill' }>;
export const sessionCommand = z.object({ sessionId: z.uuid(), command: actions });
export type SessionCommand = z.infer<typeof sessionCommand>;
export const reply = z.object({ ok: z.boolean(), text: z.string().check(z.maxLength(65000)) });
export type Reply = z.infer<typeof reply>;
export const tokenPattern = /^[a-f0-9]{64}$/;
export function randomKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function proof(token: string, role: 'agent' | 'browser', client: string, server: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = await crypto.subtle.sign('HMAC', key, encoder.encode(['better-browser-v1', role, client, server].join(':')));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function validEndpoint(raw: string, transport: 'http' | 'ws'): URL {
  const url = new URL(raw);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash ||
      !(url.protocol === transport + 's:' || (loopback && url.protocol === transport + ':'))) {
    throw new Error('Use TLS para hosts remotos e uma URL sem credenciais.');
  }
  return url;
}

export const browserId = z.uuid();
export const identity = z.object({
  id: browserId,
  name: z.string().check(z.trim(), z.minLength(1), z.maxLength(48), z.regex(/^[\p{L}\p{N} _().-]+$/u))
});
export type Identity = z.infer<typeof identity>;
export const listedBrowsers = z.array(identity);
