import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, cp, readFile, writeFile, rm, stat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

for (const locale of ['en', 'pt-BR']) {
  test(`MCP controls localized BetterBrowser groups (${locale})`, { timeout: 50000 }, t => exerciseBrowser(t, locale));
}

async function exerciseBrowser(t, locale) {
  const tmp = await mkdtemp(join(tmpdir(), 'better-browser-test-'));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const ext = join(tmp, 'extension');
  await cp(resolve('dist/extension'), ext, { recursive: true });
  // Register before the worker's imports are initialized so startup violations are visible.
  const workerFile = join(ext, 'worker.js');
  const workerSource = await readFile(workerFile, 'utf8');
  const observeCsp = `globalThis.cspViolations = [];
self.addEventListener('securitypolicyviolation', e => cspViolations.push([e.effectiveDirective, e.blockedURI]));\n`;
  const fixture = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<title>Pedido</title><label>Cliente<input></label><a href="/detalhes" target="_blank">Detalhes</a>
      <button onclick="document.title='Salvo'">Salvar</button>
      <a href="/proxima" onclick="sessionStorage.visitas=Number(sessionStorage.visitas || 0)+1">Avançar</a>`);
  });
  fixture.listen(0, '127.0.0.1');
  await once(fixture, 'listening');
  t.after(() => fixture.close());
  const origin = 'http://127.0.0.1:' + fixture.address().port;
  // Keep both temporary profiles off the user's default bridge before configuration.
  const defaultEndpoint = 'ws://127.0.0.1:8717/browser';
  assert.ok(workerSource.includes(defaultEndpoint));
  await writeFile(workerFile, observeCsp + workerSource.replace(defaultEndpoint, origin.replace('http:', 'ws:') + '/browser'));
  function launchProfile(profile, uiLanguage = locale) {
    const language = uiLanguage === 'en' ? 'en_US' : uiLanguage.replace('-', '_');
    return chromium.launchPersistentContext(join(tmp, profile), {
      executablePath: chromium.executablePath(), headless: false, locale: uiLanguage,
      env: { ...process.env, LANGUAGE: language, LANG: language + '.UTF-8', LC_ALL: language + '.UTF-8' },
      args: ['--lang=' + uiLanguage, '--disable-extensions-except=' + ext, '--load-extension=' + ext, '--no-first-run']
    });
  }
  const browser = await launchProfile('profile');
  t.after(() => browser.close());
  const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  const manager = await browser.newPage();
  await manager.goto(new URL('popup.html', worker.url()).href);
  assert.equal(await manager.locator('html').getAttribute('lang'), locale);
  assert.equal(await manager.locator('#save').textContent(), locale === 'en' ? 'Save' : 'Salvar');
  const translated = (key, value) => manager.evaluate(([key, value]) => chrome.i18n.getMessage(key, value), [key, value ?? []]);
  await manager.evaluate(() => chrome.storage.local.set({ history: [
    { time: 1, origin: 'Grupo Agy', action: 'Controle retomado', ok: true }
  ] }));
  await manager.waitForFunction(() => document.querySelector('#history')?.textContent.includes(chrome.i18n.getMessage('resumed')));
  assert.ok((await manager.locator('#history').textContent()).includes('BetterBrowser'));
  const message = (type, data = {}) => manager.evaluate(msg => chrome.runtime.sendMessage(msg), { type, ...data });
  const { token } = await message('token');
  const tokenFile = join(tmp, 'token');

  const bridge = spawn(process.execPath, ['dist/bridge.js'], { env: { ...process.env, BETTER_BROWSER_TOKEN: '', BETTER_BROWSER_TOKEN_FILE: tokenFile, BETTER_BROWSER_PORT: '0', BETTER_BROWSER_HOST: '127.0.0.1' } });
  t.after(() => bridge.kill());
  const [line] = await once(bridge.stdout, 'data');
  const port = Number(line.toString().trim().split(' ').pop());
  const base = 'http://127.0.0.1:' + port;
  const client = new Client({ name: 'smoke', version: '1' });
  const stdio = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/mcp.js')], env: { BETTER_BROWSER_TOKEN_FILE: tokenFile, BETTER_BROWSER_URL: base } });
  await client.connect(stdio);
  t.after(() => client.close());
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(tool => tool.name).sort(), ['browser', 'list_browsers', 'pair_browser']);
  const invoke = async (name, args = {}) => {
    const response = await client.callTool({ name, arguments: args });
    return { ok: !response.isError, text: response.content[0].text };
  };
  assert.match((await invoke('list_browsers')).text, /Nenhum navegador/);
  const endpoint = 'ws://127.0.0.1:' + port + '/browser';
  assert.ok(!(await message('configure', { endpoint, name: 'Brave do teste' })).error);
  const waitForAvailable = popup => popup.waitForFunction(
    () => document.querySelector('#status').textContent === chrome.i18n.getMessage('available'),
    undefined, { timeout: 6000 });
  await waitForAvailable(manager);
  const [{ id, name, tokenSalvo }] = JSON.parse((await invoke('list_browsers')).text);
  assert.equal(name, 'Brave do teste');
  assert.equal(tokenSalvo, false);
  const otherBrowser = await launchProfile('profile2', 'fr-FR');
  t.after(() => otherBrowser.close());
  const otherWorker = otherBrowser.serviceWorkers()[0] || await otherBrowser.waitForEvent('serviceworker');
  const otherManager = await otherBrowser.newPage();
  await otherManager.goto(new URL('popup.html', otherWorker.url()).href);
  assert.match(await otherManager.evaluate(() => chrome.i18n.getUILanguage()), /^fr\b/);
  assert.equal(await otherManager.locator('html').getAttribute('lang'), 'en');
  assert.equal(await otherManager.locator('#save').textContent(), 'Save');
  await otherManager.evaluate(endpoint => chrome.runtime.sendMessage({ type: 'configure', endpoint, name: 'Segundo navegador' }), endpoint);
  await waitForAvailable(otherManager);
  const peers = JSON.parse((await invoke('list_browsers')).text);
  assert.equal(peers.length, 2);
  assert.ok(!JSON.stringify(peers).includes(token));
  const other = peers.find(row => row.id !== id);
  const blocked = await invoke('browser', { browserId: id, command: { action: 'read' } });
  assert.equal(blocked.ok, false);
  const mismatch = await invoke('pair_browser', { browserId: other.id, token });
  assert.equal(mismatch.ok, false);
  const paired = await invoke('pair_browser', { browserId: id, token });
  assert.ok(paired.ok);
  assert.ok(!paired.text.includes(token));
  const resumed = new Client({ name: 'resumed', version: '1' });
  await resumed.connect(new StdioClientTransport({ command: process.execPath, args: [resolve('dist/mcp.js')], env: { BETTER_BROWSER_TOKEN_FILE: tokenFile, BETTER_BROWSER_URL: base } }));
  t.after(() => resumed.close());
  const restored = await resumed.callTool({ name: 'browser', arguments: { command: { action: 'status' } } });
  assert.ok(!restored.isError);
  assert.ok(restored.content[0].text.endsWith(await translated('readyToOpen')));
  const [scope] = await readdir(tokenFile + '.d');
  const stored = join(tokenFile + '.d', scope, id);
  assert.equal((await stat(stored)).mode & 0o777, 0o600);
  assert.equal((await readFile(stored, 'utf8')).trim() === token, true);
  assert.deepEqual(JSON.parse((await invoke('list_browsers')).text).map(r => r.tokenSalvo).sort(), [false, true]);
  assert.equal((await invoke('browser', { browserId: other.id, command: { action: 'read' } })).ok, false);
  const personal = await browser.newPage();
  await personal.goto(origin + '/pessoal');
  const notice = locale === 'en' ? 'BetterBrowser is controlling this browser' : 'BetterBrowser está controlando este navegador';
  const banner = page => page.locator('[data-agy-control-notice]');
  assert.equal(await banner(personal).count(), 0);
  assert.equal(await worker.evaluate(() => chrome.action.getBadgeText({})), '');
  const personalId = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id);
  const opening = browser.waitForEvent('page');
  const first = await invoke('browser', { browserId: id, command: { action: 'navigate', url: origin } });
  assert.ok(first.ok, first.text);
  const sessionId = first.text.match(/^sessionId: ([0-9a-f-]+)/)[1];
  const act = async command => (await invoke('browser', { browserId: id, sessionId, command })).text;
  const [main] = JSON.parse(await act({ action: 'tabs' }));
  const getTab = tabId => worker.evaluate(id => chrome.tabs.get(id), tabId);
  const { groupId } = await getTab(main.tabId);
  assert.equal(await worker.evaluate(async id => (await chrome.tabGroups.get(id)).title, groupId), 'BetterBrowser');
  assert.notEqual((await getTab(personalId)).groupId, groupId);
  const target = await opening;
  await target.waitForURL(origin + '/', { waitUntil: 'load' });
  await banner(target).waitFor();
  await personal.bringToFront();
  await banner(personal).waitFor();
  await personal.reload();
  await banner(personal).waitFor();
  const badge = await worker.evaluate(async tabId => {
    const [frame] = await chrome.scripting.executeScript({ target: { tabId }, func: () => {
      const host = document.querySelector('[data-agy-control-notice]');
      return chrome.dom.openOrClosedShadowRoot(host).textContent;
    } });
    return [frame.result, await chrome.action.getBadgeText({}), await chrome.action.getTitle({})];
  }, personalId);
  assert.deepEqual(badge, [notice, 'BB', notice]);
  const internal = await browser.newPage();
  await internal.goto('chrome://version');
  const internalBadge = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return chrome.action.getBadgeText({ tabId: tab.id });
  });
  assert.equal(internalBadge, 'BB');
  await internal.close();
  const restoredGroup = await resumed.callTool({ name: 'browser', arguments: { browserId: id,
    command: { action: 'open', url: origin + '/segunda-sessao' } } });
  const otherSession = restoredGroup.content[0].text.match(/^sessionId: ([0-9a-f-]+)/)[1];
  assert.notEqual(otherSession, sessionId);
  const otherTabs = await resumed.callTool({ name: 'browser', arguments: { sessionId: otherSession, command: { action: 'tabs' } } });
  const [otherTab] = JSON.parse(otherTabs.content[0].text);
  assert.notEqual((await getTab(otherTab.tabId)).groupId, groupId);
  // A personal tab manually placed in the group is still outside the session.
  await worker.evaluate(({ groupId, personalId }) => chrome.tabs.group({ groupId, tabIds: personalId }), { groupId, personalId });
  assert.deepEqual(JSON.parse(await act({ action: 'tabs' })).map(tab => tab.tabId), [main.tabId]);
  for (const tabId of [otherTab.tabId, personalId]) {
    assert.equal(await act({ action: 'select', tabId }), await translated('notSessionTab'));
    assert.equal(await act({ action: 'close', tabId }), await translated('notSessionTab'));
  }
  const initial = await act({ action: 'read' });
  const ref = (tag, text) => {
    const line = initial.split('\n').find(line => line.includes(' ' + tag + ' ' + text));
    assert.ok(line, 'Elemento ausente no snapshot: ' + tag + '; retorno: ' + initial);
    return line.split(' ')[0];
  };
  const field = ref('input', 'Cliente');
  await target.bringToFront();
  assert.equal(await act({ action: 'fill', fields: [{ ref: field, value: 'teste-privado' }] }), await translated('fieldsFilled', '1'));
  assert.equal(await target.locator('input').inputValue(), 'teste-privado');
  await worker.evaluate(id => chrome.scripting.executeScript({ target: { tabId: id }, func: () => {
    const host = document.querySelector('[data-agy-pointer]');
    const position = chrome.dom.openOrClosedShadowRoot(host).querySelector('.position');
    const trace = globalThis.pointerTrace = { movement: [], clicks: 0 };
    new MutationObserver(() => {
      const motion = position.getAnimations()[0];
      if (motion) trace.movement = motion.effect.getKeyframes().map(frame => frame.transform);
    }).observe(position, { attributes: true, attributeFilter: ['style'] });
    document.addEventListener('click', event => {
      trace.clicks++;
      const arrow = position.getBoundingClientRect();
      const button = event.target.getBoundingClientRect();
      trace.onTarget = Math.abs(arrow.x - (button.left + button.width / 2)) < 1 &&
        Math.abs(arrow.y - (button.top + button.height / 2)) < 1;
      trace.receivesClicks = document.elementFromPoint(arrow.x, arrow.y) === event.target;
    });
  } }), main.tabId);
  await act({ action: 'click', ref: ref('button', 'Salvar') });
  assert.equal(await target.title(), 'Salvo');
  const trace = await worker.evaluate(async id => (await chrome.scripting.executeScript({
    target: { tabId: id }, func: () => globalThis.pointerTrace
  }))[0].result, main.tabId);
  assert.equal(trace.clicks, 1);
  assert.ok(trace.onTarget && trace.receivesClicks);
  assert.equal(trace.movement.length, 2);
  assert.notEqual(trace.movement[0], trace.movement[1]);
  const pointer = target.locator('[data-agy-pointer]');
  const tip = async () => {
    await pointer.waitFor({ state: 'attached' });
    return worker.evaluate(async tabId => (await chrome.scripting.executeScript({ target: { tabId }, func: () => {
      const host = document.querySelector('[data-agy-pointer]');
      const path = chrome.dom.openOrClosedShadowRoot(host).querySelector('.arrow path');
      const point = path.getPointAtLength(0).matrixTransform(path.getScreenCTM());
      return [Math.round(point.x), Math.round(point.y)];
    } }))[0].result, main.tabId);
  };
  const center = locator => locator.evaluate(el => {
    const rect = el.getBoundingClientRect();
    return [Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 2)];
  });
  assert.deepEqual(await tip(), await center(target.getByText('Salvar')));
  assert.equal(await personal.locator('[data-agy-pointer]').count(), 0);
  await target.emulateMedia({ reducedMotion: 'reduce' });
  await worker.evaluate(id => chrome.scripting.executeScript({ target: { tabId: id }, func: () => {
    globalThis.pointerTrace.movement = [];
    document.querySelector('input').style.marginTop = '120vh';
  } }), main.tabId);
  assert.equal(await act({ action: 'fill', fields: [{ ref: field, value: 'campo distante' }] }), await translated('fieldsFilled', '1'));
  assert.equal(await target.locator('input').inputValue(), 'campo distante');
  const reduced = await worker.evaluate(async id => (await chrome.scripting.executeScript({
    target: { tabId: id }, func: () => {
      const rect = document.querySelector('input').getBoundingClientRect();
      return [globalThis.pointerTrace.movement.length, rect.top >= 0 && rect.bottom <= innerHeight];
    }
  }))[0].result, main.tabId);
  assert.deepEqual(reduced, [0, true]);
  await target.emulateMedia({ reducedMotion: 'no-preference' });
  assert.equal(await act({ action: 'navigate', url: 'file:///tmp/private' }), await translated('invalidDestination'));
  assert.match(await act({ action: 'read' }), /Salvo/);
  assert.equal(await act({ action: 'click', ref: field }), await translated('expiredReference'));
  const history = (await message('state')).history;
  assert.ok(history.some(entry => entry.action === 'fill (1)'));
  assert.ok(!JSON.stringify(history).includes('teste-privado'));
  const denied = await fetch(base + '/browsers/' + id + '/pair', { method: 'POST', headers: { Authorization: 'Bearer ' + '0'.repeat(64) }, body: '{"action":"read"}' });
  assert.equal(denied.status, 403);
  const lastField = await tip();
  // The previous implementation removed the cursor after 1.6 s of inactivity.
  await new Promise(resolve => setTimeout(resolve, 1800));
  assert.equal(await pointer.count(), 1);
  await target.reload();
  assert.deepEqual(await tip(), lastField);
  assert.equal(await target.title(), 'Pedido');
  const afterReload = await act({ action: 'read' });
  const nextRef = afterReload.split('\n').find(line => line.includes(' a Avançar')).split(' ')[0];
  const linkTip = await center(target.getByText('Avançar'));
  await act({ action: 'click', ref: nextRef });
  await target.waitForURL(origin + '/proxima');
  assert.deepEqual(await tip(), linkTip);
  assert.equal(await pointer.count(), 1);
  assert.deepEqual(await tip(), linkTip);
  assert.equal(await target.evaluate(() => sessionStorage.visitas), '1');
  const beforeLink = await act({ action: 'read' });
  const linkRef = beforeLink.split('\n').find(line => line.includes(' a Detalhes')).split(' ')[0];
  assert.equal(await act({ action: 'click', ref: linkRef }), await translated('clickSent'));
  await manager.waitForFunction(async gid => (await chrome.tabs.query({ groupId: gid })).some(t => t.url?.endsWith('/detalhes')), groupId);
  const afterLink = JSON.parse(await act({ action: 'tabs' }));
  assert.equal(afterLink.length, 2);
  const child = afterLink.find(tab => tab.tabId !== main.tabId);
  assert.ok(child.selected);
  const childPage = browser.pages().find(page => page.url() === origin + '/detalhes');
  await banner(childPage).waitFor();
  assert.equal(await childPage.locator('[data-agy-pointer]').count(), 0);
  await act({ action: 'select', tabId: main.tabId });
  const beforeOriginChange = await tip();
  const otherOrigin = origin.replace('127.0.0.1', 'localhost');
  assert.equal(await act({ action: 'navigate', url: otherOrigin + '/login' }), await translated('tabNavigating', String(main.tabId)));
  await target.waitForURL(otherOrigin + '/login', { waitUntil: 'load' });
  assert.deepEqual(await tip(), beforeOriginChange);
  assert.match(await act({ action: 'read' }), /localhost/);
  await act({ action: 'close', tabId: child.tabId });
  assert.equal(JSON.parse(await act({ action: 'tabs' })).length, 1);
  await message('pause');
  await banner(personal).waitFor({ state: 'detached' });
  await banner(target).waitFor({ state: 'detached' });
  assert.equal(await pointer.count(), 0);
  assert.equal(await worker.evaluate(() => chrome.action.getBadgeText({})), '');
  assert.equal(await act({ action: 'open', url: origin }), await translated('controlPaused'));
  await message('resume');
  await banner(personal).waitFor();
  assert.deepEqual(await tip(), beforeOriginChange);
  assert.match(await act({ action: 'read' }), /localhost/);
  await worker.evaluate(tabId => chrome.tabs.ungroup(tabId), main.tabId);
  await pointer.waitFor({ state: 'detached' });
  await target.reload();
  await banner(target).waitFor();
  assert.equal(await pointer.count(), 0);
  assert.equal(await act({ action: 'read' }), await translated('notSessionTab'));
  const opened = await act({ action: 'open', url: origin });
  const [newTab] = JSON.parse(await act({ action: 'tabs' }));
  assert.equal(opened, await translated('tabOpened', String(newTab.tabId)));
  assert.notEqual((await getTab(newTab.tabId)).groupId, groupId);
  await message('rotate');
  assert.notEqual((await message('token')).token, token);
  await waitForAvailable(manager);
  assert.equal((await invoke('pair_browser', { browserId: id, token })).ok, false);
  assert.match(await act({ action: 'read' }), /Token incorreto/);
  const rotated = (await message('token')).token;
  assert.ok((await invoke('pair_browser', { browserId: id, token: rotated })).ok);
  assert.equal(await act({ action: 'tabs' }), await translated('readyToOpen'));
  await banner(personal).waitFor({ state: 'detached' });
  await act({ action: 'open', url: origin });
  await banner(personal).waitFor();
  const [last] = JSON.parse(await act({ action: 'tabs' }));
  await act({ action: 'close', tabId: last.tabId });
  await banner(personal).waitFor({ state: 'detached' });
  await act({ action: 'open', url: origin });
  await banner(personal).waitFor();
  bridge.kill();
  await banner(personal).waitFor({ state: 'detached' });
  assert.equal(personal.url(), origin + '/pessoal');
  // Updating an unpacked extension in place preserves chrome.storage.local.
  assert.deepEqual(await worker.evaluate(() => globalThis.cspViolations), []);
  await browser.close();
  const reopened = await launchProfile('profile');
  t.after(() => reopened.close());
  const restartedWorker = reopened.serviceWorkers()[0] || await reopened.waitForEvent('serviceworker');
  const popup = await reopened.newPage();
  await popup.goto(new URL('popup.html', restartedWorker.url()).href);
  const retained = await popup.evaluate(async () => {
    const state = await chrome.runtime.sendMessage({ type: 'state' });
    return { id: state.browser.id, token: (await chrome.runtime.sendMessage({ type: 'token' })).token };
  });
  assert.equal(retained.id, id);
  assert.ok(retained.token === rotated);
  assert.deepEqual(await restartedWorker.evaluate(() => globalThis.cspViolations), []);
}
