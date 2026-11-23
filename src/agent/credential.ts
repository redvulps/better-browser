import { readFileSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { browserId, tokenPattern } from '../shared/protocol.js';

export const tokenFile = process.env.BETTER_BROWSER_TOKEN_FILE || join(homedir(), '.config', 'agy-better-browser', 'token');
function readStored(file: string): string {
  try { return readFileSync(file, 'utf8').trim(); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw e; }
}
export function writePrivate(file: string, value: string) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + '.' + randomUUID();
  writeFileSync(temporary, value + '\n', { flag: 'wx', mode: 0o600 });
  renameSync(temporary, file);
}
export function defaultCredential(): string {
  const token = (process.env.BETTER_BROWSER_TOKEN ?? readStored(tokenFile)).trim();
  return tokenPattern.test(token) ? token : '';
}
export function credential(): string {
  const token = defaultCredential();
  if (!token) throw new Error('Liste os navegadores e pareie o escolhido com o token da extensão.');
  return token;
}
export class Pairings {
  private directory: string;
  constructor(origin: string) {
    const scope = createHash('sha256').update(origin).digest('hex');
    this.directory = join(tokenFile + '.d', scope);
  }
  stored(id: string) { return readStored(join(this.directory, browserId.parse(id))); }
  selected() { return readStored(join(this.directory, 'selected')); }
  save(id: string, token: string) {
    writePrivate(join(this.directory, browserId.parse(id)), token);
    writePrivate(join(this.directory, 'selected'), id);
  }
}
