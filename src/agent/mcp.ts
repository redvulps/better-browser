import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/mini';
import { actions, browserId, tokenPattern, type Reply } from '../shared/protocol.js';
import { credential, defaultCredential, Pairings } from './credential.js';
import { base, call, discover } from './bridge.js';

const server = new McpServer({ name: 'better-browser', version: '0.3.2' });
const pairs = new Pairings(base.origin);
let selection = pairs.selected();
async function tool(run: () => Promise<Reply>) {
  let result: Reply;
  try { result = await run(); }
  catch (error) { result = { ok: false, text: error instanceof Error ? error.message : 'Falha na ponte.' }; }
  return { isError: !result.ok, content: [{ type: 'text' as const, text: result.text }] };
}

server.registerTool('list_browsers', {
  description: 'List online Better Browser extensions before pairing. This requires no token and reads no page.',
  inputSchema: {}
}, () => tool(async () => {
  const peers = await discover();
  const tokenPadraoCadastrado = Boolean(defaultCredential());
  return { ok: true, text: peers.length ? JSON.stringify(peers.map(peer => ({
    ...peer, tokenSalvo: Boolean(pairs.stored(peer.id)), tokenPadraoCadastrado
  }))) : 'Nenhum navegador anunciado. Abra a extensão e confira o endereço da ponte.' };
}));
server.registerTool('pair_browser', {
  description: 'Verify the token supplied by the user for the selected browser and remember it on this agent. Never repeat the token in your reply.',
  inputSchema: { browserId, token: z.string().check(z.regex(tokenPattern, 'Use o token da extensão (64 caracteres hexadecimais).')) }
}, ({ browserId: id, token }) => tool(async () => {
  const result = await call('/browsers/' + id + '/pair', token);
  if (result.ok) { pairs.save(id, token); selection = id; }
  return result;
}));
server.registerTool('browser', {
  description: 'Operate this conversation’s Agy tab group in the paired browser. Start with open or navigate and a URL. Pass the returned sessionId on every subsequent call in this conversation. open adds a tab, tabs lists up to 20 tabs starting at offset (default 0), select and close take a tabId. read, click, fill and navigate use the selected tab. No manual sharing is required.',
  inputSchema: { browserId: z.optional(browserId), sessionId: z.optional(z.uuid()), command: actions }
}, ({ browserId: explicit, sessionId, command }) => tool(async () => {
  let id = explicit || selection;
  if (!id) {
    const peers = await discover();
    if (peers.length > 1) return { ok: false, text: 'Escolha um navegador da lista e informe browserId.' };
    id = peers[0]?.id;
  }
  if (!id) return { ok: false, text: 'Nenhum navegador anunciado para abrir o grupo Agy. Confira a ponte e a extensão.' };
  const token = pairs.stored(id) || credential();
  if (!sessionId && !['open', 'navigate', 'status', 'tabs'].includes(command.action)) {
    return { ok: false, text: 'Use o sessionId desta conversa ou abra a primeira aba com open e uma URL.' };
  }
  const key = sessionId ?? crypto.randomUUID();
  const result = await call('/browsers/' + id + '/session', token, { sessionId: key, command });
  if (result.ok && !sessionId) result.text = 'sessionId: ' + key + '\n' + result.text;
  return result;
}));
await server.connect(new StdioServerTransport());
