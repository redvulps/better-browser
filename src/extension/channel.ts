import { sessionCommand, proof, randomKey, tokenPattern, type SessionCommand, type Identity, type Reply } from '../shared/protocol.js';

export class AgentChannel {
  private readonly socket: WebSocket;
  private closed = false;
  constructor(endpoint: string, browser: Identity, token: string, execute: (request: SessionCommand) => Promise<Reply>,
    onListed: () => void, onClose: () => void) {
    const client = randomKey();
    const socket = this.socket = new WebSocket(endpoint);
    const timeout = setTimeout(() => this.close(), 7000);
    let heartbeat: ReturnType<typeof setInterval>;
    let expected = '';
    let listed = false;
    let busy = false;
    socket.onopen = () => this.send({ type: 'hello', browser, nonce: client, groups: true });
    socket.onclose = () => {
      this.closed = true;
      clearTimeout(timeout);
      clearInterval(heartbeat);
      onClose();
    };
    socket.onmessage = async event => {
      try {
        const msg = JSON.parse(event.data);
        if (!expected && msg.type === 'discover' && tokenPattern.test(msg.nonce)) {
          expected = await proof(token, 'agent', client, msg.nonce);
          this.send({ type: 'advertise', signature: await proof(token, 'browser', client, msg.nonce) });
        } else if (expected && !listed && msg.type === 'listed') {
          listed = true;
          clearTimeout(timeout);
          heartbeat = setInterval(() => this.send({ type: 'heartbeat' }), 20000);
          onListed();
        } else if (!this.closed && listed && msg.type === 'command' && msg.signature === expected && !busy && typeof msg.id === 'string') {
          busy = true;
          const result = msg.sessionId ? await execute(sessionCommand.parse(msg)) :
            { ok: false, text: 'Abra uma nova sessão do agy para carregar as ferramentas do grupo Agy.' };
          busy = false;
          this.send({ type: 'result', id: msg.id, result });
        } else if (msg.type !== 'alive') this.close();
      } catch { this.close(); }
    };
  }
  private send(message: object) {
    if (!this.closed && this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }
  close() {
    this.closed = true;
    this.socket.close();
  }
}
