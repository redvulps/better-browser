import type { WebSocket } from 'ws';
import { identity, proof, randomKey, tokenPattern, type Action, type Identity, type Reply } from '../shared/protocol.js';
import { equalSecret } from './session.js';
import { Commands } from './commands.js';

interface Peer {
  identity: Identity;
  groups: boolean;
  socket: WebSocket;
  clientNonce: string;
  serverNonce: string;
  browserProof: string;
  commands: Commands;
}
export class Directory {
  private peers = new Map<string, Peer>();

  list() { return [...this.peers.values()].map(peer => peer.identity); }

  attach(socket: WebSocket, hello: { browser: unknown; nonce: string; groups?: boolean }) {
    const browser = identity.parse(hello.browser);
    if (!tokenPattern.test(hello.nonce)) return socket.close(1008);
    const peer: Peer = { identity: browser, groups: hello.groups === true, socket, clientNonce: hello.nonce, serverNonce: randomKey(),
      browserProof: '', commands: new Commands(socket) };
    const deadline = setTimeout(() => socket.terminate(), 5000);
    socket.on('close', () => {
      clearTimeout(deadline);
      peer.commands.disconnect();
      if (this.peers.get(browser.id) === peer) this.peers.delete(browser.id);
    });
    socket.on('message', raw => {
      try {
        const msg = JSON.parse(raw.toString());
        if (!peer.browserProof && msg.type === 'advertise' && tokenPattern.test(msg.signature)) {
          if (this.peers.has(browser.id)) return socket.close(1008);
          peer.browserProof = msg.signature;
          this.peers.set(browser.id, peer);
          clearTimeout(deadline);
          socket.send(JSON.stringify({ type: 'listed' }));
        } else if (peer.browserProof && msg.type === 'heartbeat') {
          socket.send(JSON.stringify({ type: 'alive' }));
        } else if (!(peer.browserProof && msg.type === 'result' && peer.commands.accept(msg.id, msg.result))) {
          socket.close(1008);
        }
      } catch { socket.close(1008); }
    });
    socket.send(JSON.stringify({ type: 'discover', nonce: peer.serverNonce }));
  }

  async request(id: string, token: string, command?: Action, sessionId?: string): Promise<Reply> {
    const peer = this.peers.get(id);
    if (!peer) return { ok: false, text: 'O navegador saiu da lista. Liste novamente.' };
    const expected = await proof(token, 'browser', peer.clientNonce, peer.serverNonce);
    if (!equalSecret(peer.browserProof, expected)) return { ok: false, text: 'Token incorreto para este navegador.' };
    const signature = await proof(token, 'agent', peer.clientNonce, peer.serverNonce);
    if (this.peers.get(id) !== peer || peer.socket.readyState !== peer.socket.OPEN) {
      return { ok: false, text: 'Navegador desconectado.' };
    }
    if (sessionId && !peer.groups) return { ok: false, text: 'Recarregue a extensão Better Browser 0.3 ou superior para habilitar o grupo BetterBrowser.' };
    if (command) return peer.commands.run(command, signature, sessionId);
    return { ok: true, text: 'Token verificado para o navegador ' + id + '.' };
  }
}
