import type { Entry } from './store.js';
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const endpoint = element<HTMLInputElement>('endpoint');
const nickname = element<HTMLInputElement>('nickname');
const token = element<HTMLInputElement>('token');
const pause = element<HTMLButtonElement>('pause');
const error = element('error');
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
  pause.textContent = state.paused ? 'Retomar' : 'Pausar';
  pause.dataset.command = state.paused ? 'resume' : 'pause';
  element('history').replaceChildren(...state.history.map((row: Entry) => {
    const li = document.createElement('li');
    li.textContent = [new Date(row.time).toLocaleString(), row.origin, row.action, row.ok ? '' : 'falhou'].filter(Boolean).join(' · ');
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
  element('reveal').textContent = token.hidden ? 'Mostrar token' : 'Ocultar token';
  if (!token.hidden) token.select();
});
onClick('rotate', async () => {
  if (!confirm('Renovar o token e encerrar o acesso atual?')) return;
  await send('rotate');
  token.value = '';
  token.hidden = true;
  element('reveal').textContent = 'Mostrar token';
});
void refresh().catch(e => { error.textContent = e.message; });
setInterval(() => { void refresh().catch(e => { error.textContent = e.message; }); }, 1000);
