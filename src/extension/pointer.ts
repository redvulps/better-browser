// Viewport fractions, so a restored hotspot also fits a resized window.
export type PointerPosition = { x: number; y: number };
export type PointerWorld = typeof globalThis & {
  agyPointer?: {
    pointAt(element: HTMLElement, duration: number): Promise<PointerPosition>;
    restore(point: PointerPosition): void;
    hide(): void;
  };
};

// Self-contained for chrome.scripting.executeScript in a managed document's isolated world.
export function installPointer(saved?: PointerPosition) {
  const world = globalThis as PointerWorld;
  if (world.agyPointer) {
    if (saved) world.agyPointer.restore(saved);
    return;
  }
  const host = document.createElement('div');
  host.setAttribute('data-agy-pointer', '');
  host.setAttribute('aria-hidden', 'true');
  const root = host.attachShadow({ mode: 'closed' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    :host {
      all: initial !important; display: block !important; position: fixed !important;
      inset: 0 auto auto 0 !important; width: 0 !important; height: 0 !important;
      overflow: visible !important; pointer-events: none !important;
      user-select: none !important; z-index: 2147483647 !important;
    }
    .position { position: absolute; top: 0; left: 0; pointer-events: none; }
    .arrow {
      position: absolute; left: -2px; top: -2px; width: 22px; height: 28px;
      filter: drop-shadow(0 1px 1px #173543);
    }
    .ring {
      position: absolute; left: -11px; top: -11px; width: 18px; height: 18px;
      border: 2px solid #0f9f94; border-radius: 50%; opacity: 0;
    }
  `);
  root.adoptedStyleSheets = [sheet];
  const position = document.createElement('div');
  position.className = 'position';
  const svg = 'http://www.w3.org/2000/svg';
  const arrow = document.createElementNS(svg, 'svg');
  arrow.setAttribute('class', 'arrow');
  arrow.setAttribute('viewBox', '0 0 22 28');
  const shape = document.createElementNS(svg, 'path');
  shape.setAttribute('d', 'M2 2 V22 L7.5 16.5 L12 26 L16 24 L11.5 14.5 H20 Z');
  shape.setAttribute('fill', '#119e8c');
  shape.setAttribute('stroke', 'white');
  shape.setAttribute('stroke-width', '1.6');
  shape.setAttribute('stroke-linejoin', 'round');
  arrow.append(shape);
  const ring = document.createElement('div');
  ring.className = 'ring';
  position.append(ring, arrow);
  root.append(position);
  let previous: PointerPosition | undefined;
  let motion: Animation | undefined;
  function transform(point: PointerPosition) {
    return `translate(${point.x * innerWidth}px, ${point.y * innerHeight}px)`;
  }
  function reposition() {
    if (previous) position.style.transform = transform(previous);
  }
  function mount() {
    const parent = document.fullscreenElement ?? document.documentElement;
    if (parent && host.parentElement !== parent) parent.append(host);
  }
  function hide() {
    motion?.cancel();
    previous = undefined;
    removeEventListener('resize', reposition);
    document.removeEventListener('DOMContentLoaded', mount);
    document.removeEventListener('fullscreenchange', mount);
    host.remove();
  }
  function show(point: PointerPosition) {
    previous = point;
    reposition();
    addEventListener('resize', reposition);
    if (document.documentElement) mount();
    else document.addEventListener('DOMContentLoaded', mount, { once: true });
    document.addEventListener('fullscreenchange', mount);
  }
  function restore(point: PointerPosition) {
    if (!previous) show(point);
  }
  addEventListener('pagehide', hide);
  world.agyPointer = { hide, restore, async pointAt(element, duration) {
    // Do not wait for a paint or a throttled animation in a background tab.
    const moving = !document.hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    let rect = element.getBoundingClientRect();
    if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth) {
      element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      rect = element.getBoundingClientRect();
    }
    const x = (Math.max(0, rect.left) + Math.min(innerWidth, rect.right)) / 2;
    const y = (Math.max(0, rect.top) + Math.min(innerHeight, rect.bottom)) / 2;
    const point = {
      x: Math.max(0, Math.min(1, x / Math.max(1, innerWidth))),
      y: Math.max(0, Math.min(1, y / Math.max(1, innerHeight)))
    };
    const to = transform(point);
    const from = previous ? transform(previous) : `translate(${Math.max(0, x - 38)}px, ${Math.max(0, y - 24)}px)`;
    motion?.cancel();
    show(point);
    if (moving && from !== to) {
      motion = position.animate([{ transform: from }, { transform: to }], { duration, easing: 'ease-in-out' });
      await new Promise<void>(resolve => {
        const finish = () => {
          clearTimeout(deadline);
          document.removeEventListener('visibilitychange', finish);
          resolve();
        };
        const deadline = setTimeout(finish, duration + 40);
        document.addEventListener('visibilitychange', finish, { once: true });
        motion!.finished.then(finish, finish);
      });
      motion.cancel();
    }
    if (moving && host.isConnected) {
      ring.animate([{ opacity: 1, transform: 'scale(.5)' }, { opacity: 0, transform: 'scale(1.65)' }], 300);
    }
    return point;
  } };
  if (saved) restore(saved);
}
