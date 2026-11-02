import type { Engine } from '../engine/engine';
import { settings, saveSettings, PRESETS, Quality, BINDING_LABELS, DEFAULT_BINDINGS } from '../settings';
import { audio } from '../audio';

/** In-game menu: Graphics (Low/Medium/High/Ultra + scale/FOV/time-of-day photo mode), Audio, Controls (rebind). */
export function openSettings(engine: Engine, onClose: () => void, extra?: { onLogout?: () => void }) {
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="panel"><span class="crn tr"></span><span class="crn bl"></span><h2>Settings</h2><div class="rule"></div>
    <div class="tabs"><button data-t="g" class="on">Graphics</button><button data-t="a">Audio</button><button data-t="c">Controls</button></div>
    <div class="body"></div>
    <div style="display:flex;gap:10px;justify-content:center;margin-top:18px"><button class="btn" data-close>Resume</button>${extra?.onLogout ? '<button class="btn ghost" data-logout>Log out</button>' : ''}</div></div>`;
  document.getElementById('ui')!.appendChild(m);
  const body = m.querySelector('.body') as HTMLElement;
  const row = (label: string, ctrl: string) => `<div class="set-row"><span>${label}</span><div>${ctrl}</div></div>`;
  const seg = (key: string, opts: [string, string][], cur: string) => `<div class="seg" data-seg="${key}">${opts.map(([v, l]) => `<button data-v="${v}" class="${v === cur ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const range = (key: string, min: number, max: number, step: number, val: number) => `<input type="range" data-r="${key}" min="${min}" max="${max}" step="${step}" value="${val}">`;
  const render = (tab: string) => {
    if (tab === 'g') {
      const q = PRESETS[settings.quality];
      body.innerHTML = row('Quality preset', seg('quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']], settings.quality)) +
        `<div style="font-size:12px;color:var(--ink-dim);margin:4px 0 6px">Shadows ${q.shadows ? q.shadowSize + 'px' : 'off'} · ambient occlusion ${q.ao ? 'on' : 'off'} · god rays ${q.godrays ? 'on' : 'off'} · bloom ${q.bloom ? 'on' : 'off'} · grass ${q.grass.toLocaleString()} · spell light shadows ${q.spellShadows ? 'on' : 'off'}. Terrain/grass density applies after reload.</div>` +
        row('Render scale', range('renderScale', 0.5, 1.5, 0.05, settings.renderScale)) +
        row('Field of view', range('fov', 50, 90, 1, settings.fov)) +
        row('Show FPS', `<input type="checkbox" data-c="showFps" ${settings.showFps ? 'checked' : ''}>`) +
        row('Photo mode: time of day', `${range('timeOverride', -1, 24, 0.25, settings.timeOverride ?? -1)}<div style="font-size:12px;color:var(--ink-dim)" data-tlabel>${settings.timeOverride === null ? 'Follows the world clock' : settings.timeOverride.toFixed(2) + ' h (local only)'}</div>`);
    } else if (tab === 'a') {
      body.innerHTML = row('Master', range('master', 0, 1, 0.01, settings.master)) + row('Music', range('music', 0, 1, 0.01, settings.music)) + row('Effects & ambience', range('sfx', 0, 1, 0.01, settings.sfx)) + row('Incantation voice', range('voice', 0, 1, 0.01, settings.voice)) + row('Speak incantations aloud', `<input type="checkbox" data-c="chantVoice" ${settings.chantVoice ? 'checked' : ''}>`);
    } else {
      body.innerHTML = row('Mouse sensitivity', range('sensitivity', 0.3, 2.5, 0.05, settings.sensitivity)) + row('Invert Y', `<input type="checkbox" data-c="invertY" ${settings.invertY ? 'checked' : ''}>`) +
        Object.keys(BINDING_LABELS).map((k) => row(BINDING_LABELS[k], `<button class="keybtn" data-bind="${k}">${settings.bindings[k].replace(/^Key|^Digit/, '')}</button>`)).join('') +
        `<div style="text-align:center;margin-top:12px"><button class="btn ghost" data-reset>Reset bindings</button></div>`;
    }
  };
  render('g');
  m.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    audio.uiClick();
    if (t.dataset.t) { m.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b === t)); render(t.dataset.t); return; }
    const sg = t.closest('[data-seg]') as HTMLElement | null;
    if (sg && t.dataset.v) { (settings as any)[sg.dataset.seg!] = t.dataset.v; if (sg.dataset.seg === 'quality') engine.setQuality(t.dataset.v as Quality); saveSettings(settings); render('g'); return; }
    if (t.dataset.bind) {
      const k = t.dataset.bind; t.classList.add('wait'); t.textContent = 'Press a key…';
      const h = (ev: KeyboardEvent) => { ev.preventDefault(); ev.stopPropagation(); settings.bindings[k] = ev.code; saveSettings(settings); window.removeEventListener('keydown', h, true); render('c'); };
      window.addEventListener('keydown', h, true); return;
    }
    if (t.dataset.reset !== undefined) { settings.bindings = { ...DEFAULT_BINDINGS }; saveSettings(settings); render('c'); return; }
    if (t.dataset.close !== undefined || t === m) { m.remove(); saveSettings(settings); onClose(); return; }
    if (t.dataset.logout !== undefined) { m.remove(); extra?.onLogout?.(); }
  });
  m.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.r) {
      const v = parseFloat(t.value);
      if (t.dataset.r === 'timeOverride') { settings.timeOverride = v < 0 ? null : v; const l = m.querySelector('[data-tlabel]'); if (l) l.textContent = v < 0 ? 'Follows the world clock' : v.toFixed(2) + ' h (local only)'; }
      else (settings as any)[t.dataset.r] = v;
      if (t.dataset.r === 'renderScale' || t.dataset.r === 'fov') engine.resize();
      audio.applyVolumes();
    }
    if (t.dataset.c) (settings as any)[t.dataset.c] = t.checked;
    saveSettings(settings);
  });
  m.addEventListener('keydown', (e) => { if (e.key === 'Escape') { m.remove(); saveSettings(settings); onClose(); } });
}
