import { maxMediaLength, mediaChunkSize, type Reply, type SessionCommand } from '../shared/protocol.js';
import type { PointerWorld } from './pointer.js';

type MediaInfo = NonNullable<Reply['media']>;
type Target = { tabId: number; groupId: number; documentId: string };
type SelectTab = () => Promise<Target | undefined>;
type Recording = { sessionId: string; select: SelectTab; started: number; timer?: ReturnType<typeof setTimeout>; result?: Reply };
const captures = new Map<string, { sessionId: string; data: string; expires: number }>();
let current: Recording | undefined;
let attached: number | undefined;
let generation = 0;
let queue = Promise.resolve();
const msg = (name: string) => chrome.i18n.getMessage(name);
export function isRecording() { return Boolean(current && !current.result); }
function serial<T>(fn: () => Promise<T>) {
  const next = queue.then(fn);
  queue = next.then(() => {}, () => {});
  return next;
}
function prune() {
  for (const [id, file] of captures) if (file.expires <= Date.now()) captures.delete(id);
}
function artifact(sessionId: string, mimeType: MediaInfo['mimeType'], data: string): Reply {
  prune();
  if (!data) throw new Error(msg('recorderUnavailable'));
  if (data.length > maxMediaLength) throw new Error(msg('captureTooLarge'));
  let held = 0;
  for (const file of captures.values()) held += file.data.length;
  if (captures.size >= 64 || held + data.length > 2 * maxMediaLength) throw new Error(msg('captureStorageFull'));
  const id = crypto.randomUUID();
  captures.set(id, { sessionId, data, expires: Date.now() + 5 * 60000 });
  setTimeout(prune, 5 * 60000 + 1);
  return { ok: true, text: msg(mimeType === 'image/png' ? 'screenshotReady' : 'videoReady'),
    media: { id, length: data.length, mimeType } };
}
export function transfer(sessionId: string, command: Extract<SessionCommand['command'], { action: 'media_chunk' | 'media_release' }>): Reply {
  prune();
  const file = captures.get(command.id);
  if (file?.sessionId !== sessionId) return { ok: false, text: msg('expiredMedia') };
  if (command.action === 'media_release') {
    captures.delete(command.id);
    if (current?.result?.media?.id === command.id) {
      clearTimeout(current.timer);
      current = undefined;
    }
    return { ok: true, text: '' };
  }
  return { ok: true, text: file.data.slice(command.offset, command.offset + mediaChunkSize) };
}
async function clearBadge(tabId: number) {
  // Chrome treats null as "use the global badge again". @types/chrome only lists string.
  // @ts-expect-error The documented nullable value is missing from BadgeTextDetails.
  await chrome.action.setBadgeText({ tabId, text: null }).catch(() => {});
}
async function detach() {
  const tabId = attached;
  attached = undefined;
  if (tabId === undefined) return;
  await Promise.allSettled([chrome.debugger.detach({ tabId }), clearBadge(tabId)]);
}
async function attach(tabId: number) {
  if (attached === tabId) return;
  await detach();
  await chrome.debugger.attach({ tabId }, '1.3');
  attached = tabId;
}
async function recorder(type: string, data?: string): Promise<{ data?: string; ended?: boolean }> {
  const result = await chrome.runtime.sendMessage({ target: 'media-recorder', type, data });
  if (!result || result.error) throw new Error(result?.error || msg('recorderUnavailable'));
  return result;
}
async function closeEncoder() {
  await chrome.offscreen.closeDocument().catch(() => {});
}
async function finalize(rec: Recording) {
  if (rec.result || current !== rec) return;
  clearTimeout(rec.timer);
  await detach();
  try {
    const result = await recorder('stop');
    rec.result = artifact(rec.sessionId, 'video/webm', result.data ?? '');
  } catch (error) {
    rec.result = { ok: false, text: (error as Error).message };
  } finally {
    await closeEncoder();
  }
  // A finished clip can still be collected by record_stop after its last tab closes.
  rec.timer = setTimeout(() => { if (current === rec) current = undefined; }, 5 * 60000);
}

async function unchanged(target: Target, select: SelectTab, epoch: number) {
  const next = await select();
  if (epoch !== generation || next?.documentId !== target.documentId || next.tabId !== target.tabId ||
      next.groupId !== target.groupId) throw new Error(msg('interactionChanged'));
}
async function pixels(target: Target, format: 'png' | 'jpeg', fullPage = false) {
  const handle = { tabId: target.tabId };
  const options: Record<string, unknown> = { format, fromSurface: true, captureBeyondViewport: fullPage };
  if (format === 'jpeg') options.quality = 75;
  if (fullPage) {
    const { cssContentSize } = await chrome.debugger.sendCommand(handle, 'Page.getLayoutMetrics') as {
      cssContentSize: { x: number; y: number; width: number; height: number }
    };
    const [frame] = await chrome.scripting.executeScript({ target: { ...handle, documentIds: [target.documentId] },
      func: () => devicePixelRatio });
    const dpr = frame.result || 1;
    const w = Math.ceil(cssContentSize.width), h = Math.ceil(cssContentSize.height);
    if (w * h * dpr ** 2 > 32_000_000 || Math.max(w, h) * dpr > 16384) throw new Error(msg('captureTooLarge'));
    options.clip = { x: 0, y: 0, width: w, height: h, scale: 1 };
  }
  const { data } = await chrome.debugger.sendCommand(handle, 'Page.captureScreenshot', options) as { data: string };
  return data;
}

// The pointer and its click halo share a single container in the extension's closed shadow root.
function maskPointer(hidden: boolean) {
  (globalThis as PointerWorld).agyPointer?.forScreenshot(hidden);
}
export function screenshot(sessionId: string, select: SelectTab, fullPage: boolean) {
  const epoch = generation;
  return serial(async () => {
    const target = await select();
    if (!target) throw new Error(msg('navigateToPage'));
    const injection = { tabId: target.tabId, documentIds: [target.documentId] };
    try {
      await attach(target.tabId);
      await chrome.scripting.executeScript({ target: injection, func: maskPointer, args: [true] });
      const data = await pixels(target, 'png', fullPage);
      await unchanged(target, select, epoch);
      return artifact(sessionId, 'image/png', data);
    } finally {
      await chrome.scripting.executeScript({ target: injection, func: maskPointer, args: [false] }).catch(() => {});
      if (!current || current.result || current.sessionId !== sessionId) await detach();
    }
  });
}

async function videoFrame(rec: Recording, first: boolean) {
  const epoch = generation;
  const target = await rec.select();
  if (!target) {
    await detach();
    if (first) throw new Error(msg('navigateToPage'));
    return;
  }
  await attach(target.tabId);
  const data = await pixels(target, 'jpeg');
  await unchanged(target, rec.select, epoch);
  if (attached !== target.tabId || current !== rec) throw new Error(msg('interactionChanged'));
  await chrome.action.setBadgeText({ tabId: target.tabId, text: 'REC' });
  const state = await recorder(first ? 'start' : 'frame', data);
  if (state.ended) await finalize(rec);
}
function schedule(rec: Recording) {
  rec.timer = setTimeout(() => { void serial(async () => {
    if (current !== rec || rec.result) return;
    if (Date.now() - rec.started >= 5 * 60000) return finalize(rec);
    try { await videoFrame(rec, false); } catch { await detach(); }
    if (current === rec && !rec.result) schedule(rec);
  }); }, 80);
}
export function startRecording(sessionId: string, select: SelectTab) {
  return serial(async () => {
    if (current) throw new Error(msg('recorderBusy'));
    const rec: Recording = { sessionId, select, started: Date.now() };
    current = rec;
    try {
      await closeEncoder(); // Clean up an encoder left by an interrupted service worker.
      await chrome.offscreen.createDocument({ url: 'recorder.html', reasons: [chrome.offscreen.Reason.BLOBS],
        justification: 'Encode the WebM video requested by the paired agent.' });
      await videoFrame(rec, true);
      schedule(rec);
      return { ok: true, text: msg('recording') };
    } catch (error) {
      current = undefined;
      await detach();
      await closeEncoder();
      throw error;
    }
  });
}
export function stopRecording(sessionId: string) {
  return serial(async () => {
    const rec = current;
    if (!rec || rec.sessionId !== sessionId) throw new Error(msg('noRecording'));
    if (!rec.result) await videoFrame(rec, false).catch(() => {});
    await finalize(rec);
    if (!rec.result?.ok) {
      clearTimeout(rec.timer);
      current = undefined;
    }
    return rec.result!;
  });
}
export function cancelMedia() {
  generation++;
  void serial(async () => {
    clearTimeout(current?.timer);
    current = undefined;
    captures.clear();
    await detach();
    await closeEncoder();
  });
}
export function stopOnPause() {
  generation++;
  void serial(async () => { if (current) await finalize(current); });
}
chrome.debugger.onDetach.addListener(({ tabId }, reason) => {
  if (tabId === undefined || attached !== tabId) return;
  attached = undefined;
  void clearBadge(tabId);
  if (reason === 'canceled_by_user') stopOnPause();
});
