import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';
import WebSocket from 'ws';

test('ponte exige TLS fora do loopback e prova de posse do token em cada conexão', { timeout: 12000 }, async t => {
  const env = { ...process.env, BETTER_BROWSER_HOST: '0.0.0.0', BETTER_BROWSER_PORT: '0' };
  delete env.BETTER_BROWSER_CERT;
  delete env.BETTER_BROWSER_KEY;
  const rejected = spawnSync(process.execPath, ['dist/bridge.js'], { env, encoding: 'utf8', timeout: 2000 });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /TLS obrigatório/);
  const tmp = await mkdtemp(join(tmpdir(), 'better-browser-tls-'));
  const cert = join(tmp, 'cert.pem');
  const key = join(tmp, 'key.pem');
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=IP:127.0.0.1', '-days', '1', '-keyout', key, '-out', cert], { stdio: 'ignore' });
    const token = randomBytes(32).toString('hex');
    const proc = spawn(process.execPath, ['dist/bridge.js'], { env: {
      ...env, BETTER_BROWSER_HOST: '127.0.0.1', BETTER_BROWSER_CERT: cert, BETTER_BROWSER_KEY: key, BETTER_BROWSER_TOKEN: token
    } });
    t.after(() => proc.kill());
    const [line] = await once(proc.stdout, 'data');
    const port = Number(line.toString().trim().split(' ').pop());
    const ca = await readFile(cert);
    async function open() {
      const ws = new WebSocket('wss://127.0.0.1:' + port + '/browser', { ca, origin: 'chrome-extension://' + 'a'.repeat(32) });
      await once(ws, 'open');
      return ws;
    }
    const client = randomBytes(32).toString('hex');
    const sign = (role, nonce) => createHmac('sha256', token).update(['better-browser-v1', role, client, nonce].join(':')).digest('hex');
    async function hello(ws) {
      ws.send(JSON.stringify({ type: 'hello', nonce: client }));
      const [raw] = await once(ws, 'message');
      const { signature, nonce } = JSON.parse(raw);
      assert.equal(signature, sign('agent', nonce));
      return sign('browser', nonce);
    }
    const ws = await open();
    const first = await hello(ws);
    ws.send(JSON.stringify({ type: 'proof', signature: first }));
    assert.equal(JSON.parse((await once(ws, 'message'))[0]).type, 'ready');
    ws.close();
    await once(ws, 'close');
    const replay = await open();
    assert.notEqual(await hello(replay), first);
    replay.send(JSON.stringify({ type: 'proof', signature: first }));
    assert.equal((await once(replay, 'close'))[0], 1008);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
