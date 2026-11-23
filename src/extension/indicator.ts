import type { PointerWorld } from './pointer.js';

const noticeText = chrome.i18n.getMessage('controlNotice');
const ports = new Set<chrome.runtime.Port>();
let visible: boolean | undefined;

export function activeNotice() { return visible ? noticeText : undefined; }

// Runs in the top document's isolated world. The port ties the element's
// lifetime to the extension even when the worker or extension is reloaded.
function attachIndicator() {
  const world = globalThis as PointerWorld & { agyIndicatorPort?: chrome.runtime.Port };
  if (world.agyIndicatorPort) return;
  const port = chrome.runtime.connect({ name: 'agy-control-indicator' });
  world.agyIndicatorPort = port;
  const host = document.createElement('div');
  host.lang = chrome.i18n.getMessage('languageTag');
  host.setAttribute('role', 'status');
  host.setAttribute('data-agy-control-notice', '');
  const root = host.attachShadow({ mode: 'closed' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    :host {
      all: initial !important;
      display: block !important;
      position: fixed !important;
      top: 10px !important;
      left: 50% !important;
      transform: translateX(-50%) !important;
      z-index: 2147483647 !important;
      max-width: calc(100vw - 24px) !important;
      width: max-content !important;
      pointer-events: none !important;
      user-select: none !important;
    }
    span {
      display: block; box-sizing: border-box; padding: 7px 14px; border-radius: 20px;
      background: #173543; color: #fff; border: 1px solid #95cfcf;
      box-shadow: 0 2px 8px #00192140; font: 600 13px/1.4 system-ui, sans-serif;
      text-align: center;
    }
  `);
  root.adoptedStyleSheets = [sheet];
  const label = document.createElement('span');
  root.append(label);
  function mount() {
    (document.fullscreenElement ?? document.documentElement)?.append(host);
  }
  function unmount() {
    void chrome.runtime.lastError;
    if (world.agyIndicatorPort !== port) return;
    removeEventListener('pagehide', leave);
    document.removeEventListener('DOMContentLoaded', mount);
    document.removeEventListener('fullscreenchange', mount);
    host.remove();
    world.agyPointer?.hide();
    delete world.agyIndicatorPort;
  }
  function leave() {
    unmount();
    port.disconnect();
  }
  addEventListener('pagehide', leave, { once: true });
  port.onDisconnect.addListener(unmount);
  port.onMessage.addListener((text: string) => {
    label.textContent = text;
    if (document.documentElement) mount();
    else document.addEventListener('DOMContentLoaded', mount, { once: true });
    document.addEventListener('fullscreenchange', mount);
  });
}

async function showInTab(tabId: number) {
  if (!visible) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: attachIndicator, injectImmediately: true });
  } catch { /* Browser-protected pages and closed tabs can only show the toolbar badge. */ }
}

export function onIndicatorReady(ready: (tabId: number, documentId: string) => void) {
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== 'agy-control-indicator') return;
    const sender = port.sender;
    if (!visible || sender?.id !== chrome.runtime.id || sender.frameId !== 0 || sender.tab?.id === undefined || !sender.documentId) {
      port.disconnect();
      return;
    }
    ports.add(port);
    port.onDisconnect.addListener(() => ports.delete(port));
    port.postMessage(noticeText);
    ready(sender.tab.id, sender.documentId);
  });
}

chrome.webNavigation.onCommitted.addListener(({ tabId, frameId }) => {
  if (frameId === 0) void showInTab(tabId);
}, { url: [{ schemes: ['http', 'https'] }] });

chrome.tabs.onActivated.addListener(({ tabId }) => { void showInTab(tabId); });

export async function updateIndicator(connected: boolean) {
  const [{ groups }, { paused }] = await Promise.all([
    chrome.storage.session.get('groups'), chrome.storage.local.get('paused')
  ]);
  const active = connected && !paused && Object.keys(groups ?? {}).length > 0;
  if (visible === active) return;
  visible = active;
  if (!active) {
    for (const port of ports) port.disconnect();
    ports.clear();
  }
  await Promise.all([
    chrome.action.setBadgeBackgroundColor({ color: '#17505C' }),
    chrome.action.setBadgeText({ text: active ? 'BB' : '' }),
    chrome.action.setTitle({ title: active ? noticeText : 'Better Browser' })
  ]);
  if (active) {
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'], discarded: false });
    for (const tab of tabs) {
      if (tab.id !== undefined && !tab.frozen) void showInTab(tab.id);
    }
  }
}
