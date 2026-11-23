import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import { reply, type Action, type Reply } from '../shared/protocol.js';

// Each browser has a single in-flight action. Disconnects and timeouts never retry it.
export class Commands {
  private pending?: { id: string; finish: (result: Reply) => void };
  constructor(private socket: WebSocket) {}
  accept(id: string, result: unknown) {
    if (!this.pending || this.pending.id !== id) return false;
    this.pending.finish(reply.parse(result));
    return true;
  }
  disconnect() {
    this.pending?.finish({ ok: false, text: 'A aba foi desconectada. Confira o resultado antes de repetir.' });
  }
  run(command: Action, signature?: string, sessionId?: string): Promise<Reply> {
    if (this.pending) return Promise.resolve({ ok: false, text: 'A aba está executando outra ação.' });
    const id = randomUUID();
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.socket.terminate();
        this.pending?.finish({ ok: false, text: 'Tempo esgotado. Confira o resultado antes de repetir.' });
      }, 12000);
      this.pending = { id, finish: result => {
        clearTimeout(timer);
        this.pending = undefined;
        resolve(result);
      } };
      this.socket.send(JSON.stringify({ type: 'command', id, command, signature, sessionId }), error => {
        if (error) this.socket.terminate();
      });
    });
  }
}
