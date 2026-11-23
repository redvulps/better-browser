import { timingSafeEqual } from 'node:crypto';
import type { WebSocket } from 'ws';
import { proof, randomKey, tokenPattern } from '../shared/protocol.js';
import type { Action, Reply } from '../shared/protocol.js';
import { Commands } from './commands.js';

export function equalSecret(a: string, b: string): boolean {
  return tokenPattern.test(a) && tokenPattern.test(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export class BrowserSession {
  private active?: { socket: WebSocket; token: string; commands: Commands };


  attach(socket: WebSocket, token: string) {
    const serverNonce = randomKey();
    let clientNonce = '';
    let stage: 'hello' | 'checking' | 'proof' | 'active' = 'hello';
    const deadline = setTimeout(() => socket.terminate(), 5000);
    socket.on('error', () => socket.terminate());
    socket.on('close', () => {
      clearTimeout(deadline);
      if (this.active?.socket !== socket) return;
      this.active.commands.disconnect();
      this.active = undefined;
    });
    socket.on('message', async raw => {
      try {
        const msg = JSON.parse(raw.toString());
        if (stage === 'hello' && msg.type === 'hello' && tokenPattern.test(msg.nonce)) {
          stage = 'checking';
          clientNonce = msg.nonce;
          const signature = await proof(token, 'agent', clientNonce, serverNonce);
          stage = 'proof';
          socket.send(JSON.stringify({ type: 'challenge', nonce: serverNonce, signature }));
        } else if (stage === 'proof' && msg.type === 'proof') {
          stage = 'checking';
          const expected = await proof(token, 'browser', clientNonce, serverNonce);
          if (!equalSecret(expected, msg.signature) || this.active || socket.readyState !== socket.OPEN) return socket.close(1008);
          clearTimeout(deadline);
          stage = 'active';
          this.active = { socket, token, commands: new Commands(socket) };
          socket.send(JSON.stringify({ type: 'ready' }));
        } else if (stage === 'active' && msg.type === 'heartbeat') {
          socket.send(JSON.stringify({ type: 'alive' }));
        } else if (stage === 'active' && msg.type === 'result') {
          if (!this.active?.commands.accept(msg.id, msg.result)) socket.close(1008);
        } else {
          socket.close(1008);
        }
      } catch { socket.terminate(); }
    });
  }

  async run(command: Action, token: string): Promise<Reply> {
    if (this.active && !equalSecret(this.active.token, token)) this.active.socket.terminate();
    if (!this.active || this.active.socket.readyState !== this.active.socket.OPEN) {
      return { ok: command.action === 'status', text: 'Nenhuma aba compartilhada.' };
    }
    return this.active.commands.run(command);
  }
}
