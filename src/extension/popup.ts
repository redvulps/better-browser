import type { Entry } from './store.js';
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const endpoint = element<HTMLInputElement>('endpoint');
const nickname = element<HTMLInputElement>('nickname');
const token = element<HTMLInputElement>('token');
const pause = element<HTMLButtonElement>('pause');
const error = element('error');
const { getMessage } = chrome.i18n;
document.documentElement.lang = getMessage('languageTag');
for (const label of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
  label.textContent = getMessage(label.dataset.i18n!);
}
token.setAttribute('aria-label', getMessage('tokenLabel'));

// Pause and resume entries from older versions contain their Portuguese labels.
const historyActions = new Map(Object.entries({
  screenshot: 'actionScreenshot', record_start: 'actionRecordStart', record_stop: 'actionRecordStop',
  open: 'actionOpen', navigate: 'actionNavigate', select: 'actionSelect', close: 'actionClose',
  read: 'actionRead', click: 'actionClick', pause: 'paused', resume: 'resumed',
  'Controle pausado': 'paused', 'Controle retomado': 'resumed'
}));
function historyAction(action: string) {
  const count = /^fill \((\d+)\)$/.exec(action)?.[1];
  if (count) return getMessage('actionFill', count);
  const key = historyActions.get(action);
  return key ? getMessage(key) : action;
}
async function send(type: string, data: object = {}) {
  const result = await chrome.runtime.sendMessage({ type, ...data });
  if (result.error) throw new Error(result.error);
  return result;
}
async function refresh() {
  const state = await send('state');
  element('status').textContent = state.notice;
  if (!endpoint.value && document.activeElement !== endpoint) endpoint.value = state.endpoint;
  if (!nickname.value && document.activeElement !== nickname) nickname.value = state.browser.name;
  element('browser-id').textContent = 'ID: ' + state.browser.id;
  pause.textContent = getMessage(state.paused ? 'resume' : 'pause');
  pause.dataset.command = state.paused ? 'resume' : 'pause';
  element('history').replaceChildren(...state.history.map((row: Entry) => {
    const li = document.createElement('li');
    const origin = row.origin && row.origin !== 'Grupo Agy' ? row.origin : getMessage('groupLabel');
    li.textContent = [new Date(row.time).toLocaleString(), origin, historyAction(row.action), row.ok ? '' : getMessage('failed')].filter(Boolean).join(' · ');
    return li;
  }));
}
function onClick(id: string, fn: () => Promise<void>) {
  element(id).onclick = async () => {
    error.textContent = '';
    try { await fn(); await refresh(); } catch (e) { error.textContent = (e as Error).message; }
  };
}
onClick('save', async () => { await send('configure', { endpoint: endpoint.value, name: nickname.value }); });
onClick('pause', async () => { await send(pause.dataset.command || 'pause'); });
onClick('reveal', async () => {
  token.hidden = !token.hidden;
  token.value = token.hidden ? '' : (await send('token')).token;
  element('reveal').textContent = getMessage(token.hidden ? 'showToken' : 'hideToken');
  if (!token.hidden) token.select();
});
onClick('rotate', async () => {
  if (!confirm(getMessage('rotateConfirmation'))) return;
  await send('rotate');
  token.value = '';
  token.hidden = true;
  element('reveal').textContent = getMessage('showToken');
});
void refresh().catch(e => { error.textContent = e.message; });
setInterval(() => { void refresh().catch(e => { error.textContent = e.message; }); }, 1000);
