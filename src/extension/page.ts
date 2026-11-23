import type { PageAction, Reply } from '../shared/protocol.js';
import type { PointerWorld } from './pointer.js';

// Injected into the extension's isolated world in the top frame. All document
// state lives here so identifiers expire naturally when the document changes.
export async function actOnPage(command: PageAction, origin: string, sessionId: string): Promise<Reply> {
  if (location.origin !== origin) return { ok: false, text: chrome.i18n.getMessage('pageChanged') };
  const world = globalThis as PointerWorld & { betterBrowserRefs?: Map<string, HTMLElement> };
  const description = (el: HTMLElement) => {
    const label = el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement
      ? el.labels?.[0]?.textContent : '';
    return (el.getAttribute('aria-label') || label || (el.tagName === 'TEXTAREA' ? '' : el.innerText) || el.getAttribute('placeholder') || el.title || el.tagName)
      .trim().replace(/\s+/g, ' ').slice(0, 120);
  };
  if (command.action === 'read') {
    if (!document.body) return { ok: false, text: chrome.i18n.getMessage('pageLoading') };
    const refs = new Map<string, HTMLElement>();
    world.betterBrowserRefs = refs;
    const prefix = Array.from(crypto.getRandomValues(new Uint32Array(2)), word => word.toString(16)).join('-');
    const lines = [document.title.slice(0, 250), origin, document.body?.innerText.slice(0, 6500) ?? ''];
    let size = lines.join('\n').length;
    for (const el of document.querySelectorAll<HTMLElement>('a[href],button,input:not([type="hidden"]),select,textarea,[role="button"],[role="link"]')) {
      if (!el.getClientRects().length || el.matches(':disabled,[aria-disabled="true"]') || getComputedStyle(el).visibility !== 'visible') continue;
      const ref = prefix + '-' + refs.size;
      refs.set(ref, el);
      lines.push(ref + ' ' + el.tagName.toLowerCase() + ' ' + description(el));
      size += lines[lines.length - 1].length;
      if (el instanceof HTMLSelectElement) {
        const options = Array.from(el.options).slice(0, 15).map(option => [option.value.slice(0, 40), option.label.slice(0, 40)]);
        lines.push('  ' + chrome.i18n.getMessage('selectOptions') + ': ' + JSON.stringify(options));
        size += lines[lines.length - 1].length;
      }
      if (refs.size >= 180 || size > 30000) break;
    }
    return { ok: true, text: lines.join('\n') };
  }
  function element(ref: string) {
    const el = world.betterBrowserRefs?.get(ref);
    if (!el?.isConnected || !el.getClientRects().length || el.matches(':disabled,[aria-disabled="true"]')) throw new Error(chrome.i18n.getMessage('expiredReference'));
    return el;
  }
  async function pointAt(ref: string, target: HTMLElement, duration: number) {
    const point = await world.agyPointer?.pointAt(target, duration);
    const allowed = await chrome.runtime.sendMessage({ type: 'verifyInteraction', sessionId, point });
    if (!allowed || location.origin !== origin || element(ref) !== target) {
      world.agyPointer?.hide();
      throw new Error(chrome.i18n.getMessage('interactionChanged'));
    }
  }
  try {
    if (command.action === 'click') {
      const target = element(command.ref);
      await pointAt(command.ref, target, 250);
      target.click();
      return { ok: true, text: chrome.i18n.getMessage('clickSent') };
    }
    const fields = command.fields.map(({ ref, value }) => {
      const el = element(ref);
      if (el instanceof HTMLInputElement && !['text', 'search', 'email', 'tel', 'url', 'number', 'date', 'time', 'password'].includes(el.type)) throw new Error(chrome.i18n.getMessage('unsupportedField'));
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) || ('readOnly' in el && el.readOnly)) throw new Error(chrome.i18n.getMessage('readOnlyField'));
      if (el instanceof HTMLSelectElement && !Array.from(el.options).some(option => option.value === value)) throw new Error(chrome.i18n.getMessage('invalidOption'));
      return { el, ref, value };
    });
    for (const { el, ref, value } of fields) {
      if (!el.isConnected) return { ok: false, text: chrome.i18n.getMessage('formChanged') };
      await pointAt(ref, el, Math.min(220, 1200 / fields.length));
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return { ok: true, text: chrome.i18n.getMessage('fieldsFilled', String(fields.length)) };
  } catch (error) {
    return { ok: false, text: (error as Error).message };
  }
}
