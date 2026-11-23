import { tokenFile, writePrivate } from './credential.js';
import { tokenPattern } from '../shared/protocol.js';

// Read from a pipe; never put the token in command-line arguments or shell history.
if (process.stdin.isTTY) {
  console.error('Use: systemd-ask-password "Token Better Browser" | npm run --silent pair');
  process.exit(1);
}
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 256) break;
}
if (!tokenPattern.test(input.trim())) throw new Error('Token inválido.');
writePrivate(tokenFile, input.trim());
console.log('Token salvo.');
