import type { Reply, SessionCommand } from '../shared/protocol.js';
import { actOnPage } from './page.js';
import { installPointer, type PointerPosition, type PointerWorld } from './pointer.js';
import { record } from './store.js';

interface Group {
  id: number;
  // Most recently selected first. Only tabs created for this session belong here.
  tabs: number[];
  pointers?: Record<number, PointerPosition>;
}
type Groups = Record<string, Group>;
async function load(): Promise<Groups> {
  const { groups } = await chrome.storage.session.get<{ groups?: Groups }>('groups');
  return groups ?? {};
}

function destination(raw: string) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error(chrome.i18n.getMessage('invalidDestination'));
  }
  return url;
}

type Tab = chrome.tabs.Tab & { id: number };
export async function rememberPointer(sessionId: string, tabId: number, point: PointerPosition) {
  const groups = await load();
  const group = groups[sessionId];
  if (!group?.tabs.includes(tabId) || (await chrome.tabs.get(tabId)).groupId !== group.id) return false;
  if (!point || ![point.x, point.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) return false;
  (group.pointers ??= {})[tabId] = { x: point.x, y: point.y };
  await chrome.storage.session.set({ groups });
  return true;
}

export async function restoreTabPointer(tabId: number, documentId: string) {
  const group = Object.values(await load()).find(item => item.tabs.includes(tabId));
  const point = group?.pointers?.[tabId];
  if (!group || !point || (await chrome.tabs.get(tabId)).groupId !== group.id) return;
  await chrome.scripting.executeScript({ target: { tabId, documentIds: [documentId] },
    injectImmediately: true, func: installPointer, args: [point] });
}

async function members(group?: Group): Promise<Tab[]> {
  if (!group) return [];
  const inGroup = await chrome.tabs.query({ groupId: group.id });
  const byId = new Map(inGroup.map(tab => [tab.id, tab]));
  return group.tabs.map(id => byId.get(id)).filter((tab): tab is Tab => tab?.id !== undefined);
}

async function open(groups: Groups, key: string, existing: Tab | undefined, url?: URL) {
  const tab = await chrome.tabs.create({ url: 'about:blank', active: true, windowId: existing?.windowId });
  if (tab.id === undefined) throw new Error(chrome.i18n.getMessage('missingTabId'));
  const tabId = tab.id;
  try {
    const id = await chrome.tabs.group({ tabIds: tabId, groupId: existing?.groupId });
    if (!existing) await chrome.tabGroups.update(id, { title: 'BetterBrowser', color: 'blue' });
    if (existing) groups[key].tabs.unshift(tabId);
    else groups[key] = { id, tabs: [tabId] };
    await chrome.storage.session.set({ groups });
    if (url) await chrome.tabs.update(tabId, { url: url.href });
    return { ok: true, text: chrome.i18n.getMessage('tabOpened', String(tabId)) };
  } catch (error) {
    await chrome.tabs.remove(tabId).catch(() => {});
    throw error;
  }
}

export async function runInGroup({ sessionId, command }: SessionCommand): Promise<Reply> {
  let origin = '';
  let result: Reply;
  try {
    const groups = await load();
    const group = groups[sessionId];
    const tabs = await members(group);
    const current = tabs[0];
    const url = 'url' in command && command.url !== undefined ? destination(command.url) : undefined;
    const target = 'tabId' in command ? tabs.find(tab => tab.id === command.tabId) : current;
    if (command.action === 'tabs' || command.action === 'status') {
      if (!current) return { ok: true, text: chrome.i18n.getMessage('readyToOpen') };
      if (command.action === 'status') return { ok: true, text: chrome.i18n.getMessage('groupStatus', [String(tabs.length), String(current.id)]) };
      const offset = command.offset ?? 0;
      const info = tabs.slice(offset, offset + 20).map(tab => ({ tabId: tab.id, selected: tab.id === current.id,
        title: tab.title?.slice(0, 160), url: tab.url?.slice(0, 1000) }));
      return { ok: true, text: JSON.stringify(info) };
    }
    origin = url?.origin || (target?.url && new URL(target.url).origin) || origin;
    if (command.action === 'open' || (command.action === 'navigate' && !current)) {
      result = await open(groups, sessionId, current, url);
    } else if (!target) {
      result = { ok: false, text: chrome.i18n.getMessage('notSessionTab') };
    } else if (command.action === 'select') {
      await chrome.tabs.update(target.id, { active: true });
      group.tabs = [target.id, ...tabs.map(tab => tab.id).filter(id => id !== target.id)];
      await chrome.storage.session.set({ groups });
      result = { ok: true, text: chrome.i18n.getMessage('tabSelected', String(target.id)) };
    } else if (command.action === 'close') {
      await chrome.tabs.remove(target.id);
      result = { ok: true, text: chrome.i18n.getMessage('tabClosed', String(target.id)) };
    } else if (command.action === 'navigate') {
      await chrome.tabs.update(target.id, { url: url!.href });
      result = { ok: true, text: chrome.i18n.getMessage('tabNavigating', String(target.id)) };
    } else if (target.pendingUrl || (!target.url && target.status === 'loading')) {
      result = { ok: false, text: chrome.i18n.getMessage('tabLoading') };
    } else if (!target.url || !/^https?:\/\//.test(target.url)) {
      result = { ok: false, text: chrome.i18n.getMessage('navigateToPage') };
    } else {
      const injection: chrome.scripting.InjectionTarget = { tabId: target.id };
      if (command.action !== 'read') {
        const point = group.pointers?.[target.id];
        const [doc] = await chrome.scripting.executeScript({ target: injection, injectImmediately: true,
          func: installPointer, args: point ? [point] : [] });
        injection.documentIds = [doc.documentId];
      }
      const [frame] = await chrome.scripting.executeScript({ target: injection, injectImmediately: true,
        func: actOnPage, args: [command, new URL(target.url).origin, sessionId] });
      result = frame?.result ?? { ok: false, text: chrome.i18n.getMessage('documentChanged') };
    }
  } catch (error) {
    result = { ok: false, text: (error as Error).message };
  }
  const action = command.action === 'fill' ? 'fill (' + command.fields.length + ')' : command.action;
  await record(origin, action, result.ok);
  return result;
}

// Browser-created navigation targets include target=_blank links with no opener in the DOM.
export async function trackChild(sourceId: number, tabId: number) {
  const groups = await load();
  const group = Object.values(groups).find(item => item.tabs.includes(sourceId));
  if (!group) return;
  const source = await chrome.tabs.get(sourceId);
  if (source.groupId !== group.id) return;
  const tab = await chrome.tabs.get(tabId);
  if (tab.groupId !== group.id && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) return;
  if (tab.windowId !== source.windowId) await chrome.tabs.move(tabId, { windowId: source.windowId, index: -1 });
  if (tab.groupId !== group.id) await chrome.tabs.group({ tabIds: tabId, groupId: group.id });
  group.tabs = [tabId, ...group.tabs.filter(id => id !== tabId)];
  await chrome.storage.session.set({ groups });
}

export async function forgetTab(tabId: number, currentGroup?: number) {
  const groups = await load();
  for (const [key, group] of Object.entries(groups)) {
    if (!group.tabs.includes(tabId) || currentGroup === group.id) continue;
    group.tabs = group.tabs.filter(id => id !== tabId);
    if (group.pointers) delete group.pointers[tabId];
    if (!group.tabs.length) delete groups[key];
    await chrome.storage.session.set({ groups });
    if (currentGroup !== undefined) {
      await chrome.scripting.executeScript({ target: { tabId }, func: () =>
        (globalThis as PointerWorld).agyPointer?.hide() }).catch(() => {});
    }
    return;
  }
}
