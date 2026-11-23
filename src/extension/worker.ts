import { identity, randomKey, validEndpoint } from '../shared/protocol.js';
import { AgentChannel } from './channel.js';
import { runInGroup, trackChild, forgetTab, rememberPointer, restoreTabPointer } from './groups.js';
import { activeNotice, onIndicatorReady, updateIndicator } from './indicator.js';
import { record, settings } from './store.js';

let channel: AgentChannel | undefined;
let listed = false;
let retry: ReturnType<typeof setTimeout> | undefined;
let management = Promise.resolve();
function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const result = management.then(work);
  management = result.then(() => {}, () => {});
  return result;
}
function refreshIndicator() { void enqueue(() => updateIndicator(listed)); }
onIndicatorReady((tabId, documentId) => {
  void enqueue(async () => {
    if (listed && activeNotice() && !(await chrome.storage.local.get('paused')).paused) await restoreTabPointer(tabId, documentId);
  }).catch(() => {}); // Navigation may have already replaced that document.
});
chrome.storage.onChanged.addListener((changes, area) => {
  if ((area === 'session' && changes.groups) || (area === 'local' && changes.paused)) refreshIndicator();
});
function disconnect() {
  clearTimeout(retry);
  const old = channel;
  channel = undefined;
  listed = false;
  old?.close();
  refreshIndicator();
}
async function announce() {
  if (channel) return;
  const { endpoint, browser, token } = await settings();
  const next: AgentChannel = new AgentChannel(endpoint, browser, token, request => enqueue(async () => {
    if (next !== channel) return { ok: false, text: 'Ponte desconectada.' };
    if ((await chrome.storage.local.get('paused')).paused) return { ok: false, text: 'Controle pausado. Use Retomar na extensão.' };
    return runInGroup(request);
  }), () => {
    if (channel === next) {
      listed = true;
      refreshIndicator();
    }
  }, () => {
    if (channel !== next) return;
    disconnect();
    retry = setTimeout(() => { void enqueue(announce); }, 2500);
  });
  channel = next;
}
async function configure(endpoint: string, name?: string) {
  const url = validEndpoint(endpoint, 'ws');
  if (url.pathname !== '/browser') throw new Error('Use o caminho /browser na URL da ponte.');
  const cfg = await settings();
  const browser = identity.parse({ ...cfg.browser, name: name?.trim() || cfg.browser.name });
  if (cfg.endpoint !== url.href || cfg.browser.name !== browser.name) {
    if (cfg.endpoint !== url.href) await chrome.storage.session.remove('groups');
    disconnect();
    await chrome.storage.local.set({ endpoint: url.href, browser });
  }
  await announce();
}
chrome.tabs.onRemoved.addListener(id => { void enqueue(() => forgetTab(id)); });
chrome.tabs.onUpdated.addListener((id, change) => {
  if (change.groupId !== undefined) void enqueue(() => forgetTab(id, change.groupId));
});
chrome.webNavigation.onCreatedNavigationTarget.addListener(({ sourceTabId, tabId }) => {
  void enqueue(async () => {
    if (!(await chrome.storage.local.get('paused')).paused) await trackChild(sourceTabId, tabId);
  }).catch(() => {}); // Either tab can close while the event is in flight.
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'presence') void enqueue(announce);
});
function wake() { void enqueue(announce); }
chrome.runtime.onInstalled.addListener(wake);
chrome.runtime.onStartup.addListener(wake);
void chrome.alarms.create('presence', { periodInMinutes: 1 });
refreshIndicator();
void enqueue(announce);
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg.type === 'verifyInteraction' && sender.id === chrome.runtime.id && sender.tab?.id !== undefined && sender.frameId === 0) {
    const tabId = sender.tab.id;
    // The in-flight command owns the management queue. Persist before replying
    // because the following DOM click can immediately replace this document.
    void (async () => {
      if (!listed || (await chrome.storage.local.get('paused')).paused) return false;
      const owned = await rememberPointer(msg.sessionId, tabId, msg.point);
      return owned && listed && !(await chrome.storage.local.get('paused')).paused;
    })().then(respond, () => respond(false));
    return true;
  }
  if (sender.url !== chrome.runtime.getURL('popup.html')) return;
  // A pause must take effect even if the current command is animating a batch of fields.
  const pausing = msg.type === 'pause' ? chrome.storage.local.set({ paused: true }) : undefined;
  void enqueue(async () => {
    if (pausing) {
      await pausing;
      await record('Grupo Agy', 'Controle pausado');
    }
    if (msg.type === 'resume') {
      await chrome.storage.local.set({ paused: false });
      await record('Grupo Agy', 'Controle retomado');
    }
    if (msg.type === 'rotate') {
      await chrome.storage.session.remove('groups');
      disconnect();
      await chrome.storage.local.set({ token: randomKey() });
      await announce();
    }
    if (msg.type === 'configure') await configure(msg.endpoint.trim(), msg.name);
    const { token, browser, endpoint } = await settings();
    if (msg.type === 'token') return { token };
    const { history = [], paused = false } = await chrome.storage.local.get(['history', 'paused']);
    const notice = paused ? 'Controle pausado' : listed ? activeNotice() ?? 'Disponível · grupo Agy' : 'Aguardando ponte';
    return { notice, paused, endpoint, browser, history };
  }).then(respond, () => respond({ error: 'Confira o endereço, o nome do navegador e a aba selecionada.' }));
  return true;
});
