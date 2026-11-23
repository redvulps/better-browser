import { createServer as http, type RequestListener } from 'node:http';
import { createServer as https } from 'node:https';
import { readFileSync } from 'node:fs';
import { WebSocketServer } from 'ws';
import { actions, browserId, sessionCommand, tokenPattern } from '../shared/protocol.js';
import { credential } from '../agent/credential.js';
import { BrowserSession, equalSecret } from './session.js';
import { Directory } from './directory.js';

const browser = new BrowserSession(); // Compatibility with v1 extensions.
const directory = new Directory();
const answer: RequestListener = async (req, res) => {
  function send(status: number, ok: boolean, text: string) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok, text }));
  }
  if (req.headers.origin) return send(403, false, 'Origem recusada.');
  if (req.method === 'GET' && req.url === '/browsers') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(directory.list()));
    return;
  }
  const target = /^\/browsers\/([^/]+)\/(pair|command|session)$/.exec(req.url || '');
  if (req.method !== 'POST' || (!target && req.url !== '/command')) return send(404, false, 'Rota desconhecida.');
  try {
    const token = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.authorization || '')?.[1] || '';
    if (!tokenPattern.test(token)) return send(403, false, 'Credencial recusada.');
    if (target && !browserId.safeParse(target[1]).success) return send(400, false, 'Identificador inválido.');
    if (target?.[2] === 'pair') {
      const result = await directory.request(target[1], token);
      return send(result.ok ? 200 : 403, result.ok, result.text);
    }
    if (!target && !equalSecret(token, credential())) return send(403, false, 'Credencial recusada.');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 150000) return send(413, false, 'Comando excede o limite.');
      chunks.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (target?.[2] === 'session') {
      const { sessionId, command } = sessionCommand.parse(body);
      const result = await directory.request(target[1], token, command, sessionId);
      return send(200, result.ok, result.text);
    }
    const command = actions.parse(body);
    const result = target ? await directory.request(target[1], token, command) : await browser.run(command, token);
    send(200, result.ok, result.text);
  } catch { send(400, false, 'Comando inválido ou token ainda não configurado.'); }
};

const host = process.env.BETTER_BROWSER_HOST || '127.0.0.1';
const port = Number(process.env.BETTER_BROWSER_PORT || 8717);
const cert = process.env.BETTER_BROWSER_CERT;
const key = process.env.BETTER_BROWSER_KEY;
if (Boolean(cert) !== Boolean(key)) throw new Error('Forneça o certificado TLS e sua chave.');
if (!cert && !['127.0.0.1', '::1'].includes(host)) throw new Error('TLS obrigatório fora do loopback.');
const listener = cert && key ? https({ cert: readFileSync(cert), key: readFileSync(key) }, answer) : http(answer);
const sockets = new WebSocketServer({ noServer: true, maxPayload: 300000, perMessageDeflate: false });
listener.on('upgrade', (req, socket, head) => {
  if (req.url !== '/browser' || !/^chrome-extension:\/\/[a-p]{32}$/.test(req.headers.origin || '')) return socket.destroy();
  if (sockets.clients.size >= 128) return socket.destroy();
  sockets.handleUpgrade(req, socket, head, ws => {
    ws.on('error', () => ws.terminate());
    const deadline = setTimeout(() => ws.terminate(), 5000);
    ws.once('close', () => clearTimeout(deadline));
    ws.once('message', raw => {
      clearTimeout(deadline);
      try {
        const hello = JSON.parse(raw.toString());
        if (hello.type !== 'hello') return ws.close(1008);
        if (hello.browser) return directory.attach(ws, hello);
        browser.attach(ws, credential());
        ws.emit('message', raw);
      } catch { ws.close(1008); }
    });
  });
});
const unresponsive = new WeakSet<import('ws').WebSocket>();
const ping = setInterval(() => {
  for (const socket of sockets.clients) {
    if (unresponsive.has(socket)) { socket.terminate(); continue; }
    unresponsive.add(socket);
    socket.once('pong', () => unresponsive.delete(socket));
    socket.ping();
  }
}, 30000);
listener.on('close', () => clearInterval(ping));
listener.listen(port, host, () => console.log('Better Browser pronto na porta', (listener.address() as {port: number}).port));
