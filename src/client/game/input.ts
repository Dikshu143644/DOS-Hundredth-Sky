import { settings } from '../settings';

/** Keyboard + mouse (pointer lock) + touch (virtual stick, buttons, drag-to-look). */
export class Input {
  keys = new Set<string>();
  pressed = new Set<string>();       // edge-triggered this frame (by action name)
  mouseDX = 0; mouseDY = 0; wheel = 0;
  stick = { x: 0, y: 0 };
  touchJump = false;
  enabled = true;
  locked = false;
  walkToggle = false;
  typing = false;
  touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  onAction?: (a: string) => void;
  private actionByCode = new Map<string, string>();

  constructor(public canvas: HTMLCanvasElement) {
    this.rebind();
    window.addEventListener('keydown', (e) => {
      if (this.typing) return;
      const a = this.actionByCode.get(e.code);
      if (a && ['jump', 'target', 'menu'].includes(a)) e.preventDefault();
      if (!this.keys.has(e.code) && a) { this.pressed.add(a); this.onAction?.(a); if (a === 'walk') this.walkToggle = !this.walkToggle; }
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (e.button === 0 && this.locked) { this.pressed.add('attack'); this.onAction?.('attack'); }
      if (!this.locked && !this.touch) canvas.requestPointerLock?.();
    });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; });
    window.addEventListener('mousemove', (e) => {
      if (this.locked) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; }
      else if (e.buttons & 2) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; }
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
    // touch look: drag anywhere on the right part of the screen
    let lookId: number | null = null, lx = 0, ly = 0;
    canvas.addEventListener('touchstart', (e) => {
      for (const t of Array.from(e.changedTouches)) if (t.clientX > innerWidth * 0.35 && lookId === null) { lookId = t.identifier; lx = t.clientX; ly = t.clientY; }
    }, { passive: true });
    canvas.addEventListener('touchmove', (e) => {
      for (const t of Array.from(e.changedTouches)) if (t.identifier === lookId) { this.mouseDX += (t.clientX - lx) * 1.6; this.mouseDY += (t.clientY - ly) * 1.6; lx = t.clientX; ly = t.clientY; }
    }, { passive: true });
    canvas.addEventListener('touchend', (e) => { for (const t of Array.from(e.changedTouches)) if (t.identifier === lookId) lookId = null; });
  }
  rebind() { this.actionByCode.clear(); for (const [a, c] of Object.entries(settings.bindings)) this.actionByCode.set(c, a); }
  down(action: string) { return this.keys.has(settings.bindings[action]); }
  axes() {
    if (!this.enabled || this.typing) return { mx: 0, mz: 0 };
    let mx = (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0);
    let mz = (this.down('forward') ? 1 : 0) - (this.down('back') ? 1 : 0);
    if (this.stick.x || this.stick.y) { mx = this.stick.x; mz = -this.stick.y; }
    return { mx, mz };
  }
  consumeLook() { const s = settings.sensitivity * 0.0024; const r = { dx: this.mouseDX * s, dy: this.mouseDY * s * (settings.invertY ? -1 : 1) }; this.mouseDX = this.mouseDY = 0; return r; }
  endFrame() { this.pressed.clear(); this.wheel = 0; this.touchJump = false; }

  mountTouch(root: HTMLElement, onBtn: (a: string) => void) {
    if (!this.touch) return;
    const stick = document.createElement('div'); stick.className = 'stick'; stick.innerHTML = '<i></i>';
    root.appendChild(stick);
    const knob = stick.firstElementChild as HTMLElement;
    let id: number | null = null;
    const upd = (t: Touch) => {
      const r = stick.getBoundingClientRect(); let x = (t.clientX - r.left - r.width / 2) / (r.width / 2), y = (t.clientY - r.top - r.height / 2) / (r.height / 2);
      const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
      this.stick.x = x; this.stick.y = y; knob.style.transform = `translate(${x * 38}px, ${y * 38}px)`;
    };
    stick.addEventListener('touchstart', (e) => { e.preventDefault(); id = e.changedTouches[0].identifier; upd(e.changedTouches[0]); });
    stick.addEventListener('touchmove', (e) => { e.preventDefault(); for (const t of Array.from(e.changedTouches)) if (t.identifier === id) upd(t); });
    const end = () => { id = null; this.stick.x = this.stick.y = 0; knob.style.transform = ''; };
    stick.addEventListener('touchend', end); stick.addEventListener('touchcancel', end);
    const b = document.createElement('div'); b.className = 'tbtns';
    for (const [a, label] of [['spell1', '1'], ['spell2', '2'], ['spell3', '3'], ['spell4', '4'], ['ult', 'ULT'], ['attack', 'ATK'], ['dodge', 'ROLL'], ['parry', 'PARRY'], ['jump', 'JUMP'], ['interact', 'TALK']]) {
      const bt = document.createElement('button'); bt.textContent = label;
      bt.addEventListener('touchstart', (e) => { e.preventDefault(); if (a === 'jump') this.touchJump = true; else onBtn(a); });
      b.appendChild(bt);
    }
    root.appendChild(b);
  }
}
