import { randomUUID } from 'node:crypto';
import { mkdir, open, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { mediaChunkSize, type Reply, type SessionCommand } from '../shared/protocol.js';

export async function receiveMedia(info: NonNullable<Reply['media']>, request: (command: SessionCommand['command']) => Promise<Reply>) {
  const dir = resolve(process.env.BETTER_BROWSER_ARTIFACT_DIR || join(homedir(), 'Downloads', 'BetterBrowser'));
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const isImage = info.mimeType === 'image/png';
  const path = join(dir, randomUUID() + (isImage ? '.png' : '.webm'));
  const file = await open(path, 'wx', 0o600);
  const image: string[] = [];
  try {
    if (info.length % 4 !== 0) throw new Error('Invalid media length.');
    for (let offset = 0; offset < info.length; offset += mediaChunkSize) {
      const part = await request({ action: 'media_chunk', id: info.id, offset });
      if (!part.ok) throw new Error(part.text);
      const last = offset + mediaChunkSize >= info.length;
      if (part.text.length !== Math.min(mediaChunkSize, info.length - offset) ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(part.text) || (!last && part.text.includes('='))) {
        throw new Error('Incomplete media transfer.');
      }
      await file.writeFile(Buffer.from(part.text, 'base64'));
      if (isImage) image.push(part.text);
    }
    await file.close();
  } catch (error) {
    await file.close().catch(() => {});
    await unlink(path).catch(() => {});
    throw error;
  }
  await request({ action: 'media_release', id: info.id }).catch(() => {});
  return { path, image: isImage ? image.join('') : undefined };
}
