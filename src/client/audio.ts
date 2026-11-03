import { settings } from './settings';

/** All audio is synthesised live with Web Audio — no audio files, nothing to license:
 *  a generative ambient score (pads, harp, choir), forest ambience that follows day/night and
 *  rain, and every sound effect. Incantations can also be voiced with the browser's speech engine. */
export class Audio {
  ctx: AudioContext | null = null;
  master!: GainNode; music!: GainNode; sfx!: GainNode; amb!: GainNode;
  reverb!: ConvolverNode;
  private noiseBuf!: AudioBuffer;
  private rainGain!: GainNode; private windGain!: GainNode; private nightGain!: GainNode;
  private musicTimer = 0;
  private step = 0;
  private intensity = 0;
  started = false;

  start() {
    if (this.started) { void this.ctx?.resume(); return; }
    this.started = true;
    const ctx = (this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)());
    this.master = ctx.createGain(); this.master.connect(ctx.destination);
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3;
    comp.connect(this.master);
    this.music = ctx.createGain(); this.sfx = ctx.createGain(); this.amb = ctx.createGain();
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.2, 2.4);
    const rv = ctx.createGain(); rv.gain.value = 0.55;
    this.reverb.connect(rv); rv.connect(comp);
    for (const g of [this.music, this.sfx, this.amb]) g.connect(comp);
    this.music.connect(this.reverb);
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b0 = 0.997 * b0 + w * 0.029; b1 = 0.985 * b1 + w * 0.032; b2 = 0.95 * b2 + w * 0.048; d[i] = (b0 + b1 + b2 + w * 0.02) * 0.6; }
    this.windGain = this.loopNoise(400, 0.6, this.amb);
    this.rainGain = this.loopNoise(2400, 0.4, this.amb, 'highpass');
    this.nightGain = ctx.createGain(); this.nightGain.gain.value = 0; this.nightGain.connect(this.amb);
    this.applyVolumes();
    this.musicTimer = window.setInterval(() => this.musicTick(), 500);
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(settings.master, t, 0.1);
    this.music.gain.setTargetAtTime(settings.music * 0.5, t, 0.3);
    this.sfx.gain.setTargetAtTime(settings.sfx, t, 0.1);
    this.amb.gain.setTargetAtTime(settings.sfx * 0.6, t, 0.3);
  }

  private impulse(sec: number, decay: number) {
    const ctx = this.ctx!, len = ctx.sampleRate * sec, b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
    return b;
  }
  private loopNoise(freq: number, q: number, out: AudioNode, type: BiquadFilterType = 'lowpass') {
    const ctx = this.ctx!, src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(out); src.start();
    return g;
  }

  /** Called every frame-ish with world state. */
  setWorld(o: { night: number; rain: number; wind: number; combat: number }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(0.18 + o.wind * 0.25, t, 1);
    this.rainGain.gain.setTargetAtTime(o.rain * 0.55, t, 1.5);
    this.intensity += (o.combat - this.intensity) * 0.05;
    if (Math.random() < 0.012 * (1 - o.night) * (1 - o.rain)) this.bird();
    if (Math.random() < 0.05 * o.night * (1 - o.rain)) this.cricket();
  }

  // ---------------------------------------------------------------- generative score
  private chords = [[50, 57, 62, 65], [46, 53, 58, 62], [41, 48, 53, 57], [48, 55, 60, 64], [45, 52, 57, 60], [46, 53, 58, 65]];
  private musicTick() {
    const ctx = this.ctx!;
    if (!ctx || ctx.state !== 'running') return;
    const bar = Math.floor(this.step / 16), pos = this.step % 16;
    const ch = this.chords[bar % this.chords.length];
    if (pos === 0) { for (const n of ch) this.pad(n, 8.4); this.choir(ch[2] + 12, 8); }
    const arp = [0, 2, 1, 3, 2, 1, 3, 0];
    if (pos % 2 === 0 && Math.random() < 0.8) this.harp(ch[arp[(pos / 2) % 8]] + 24, 0.18);
    if (pos === 8 && Math.random() < 0.5) this.harp(ch[3] + 31, 0.12);
    if (this.intensity > 0.3 && pos % 4 === 0) this.drum(0.25 * this.intensity);
    this.step++;
  }
  private mtof(m: number) { return 440 * Math.pow(2, (m - 69) / 12); }
  private pad(note: number, dur: number) {
    const ctx = this.ctx!, t = ctx.currentTime;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 2.5); g.gain.linearRampToValueAtTime(0, t + dur);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900; f.Q.value = 0.5;
    for (const det of [-7, 7]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = this.mtof(note); o.detune.value = det; o.connect(f); o.start(t); o.stop(t + dur + 0.1); }
    f.connect(g); g.connect(this.music);
  }
  private choir(note: number, dur: number) {
    const ctx = this.ctx!, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = this.mtof(note);
    const vib = ctx.createOscillator(); vib.frequency.value = 5; const vg = ctx.createGain(); vg.gain.value = 3; vib.connect(vg); vg.connect(o.detune);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.03, t + 3); g.gain.linearRampToValueAtTime(0, t + dur);
    for (const [fr, q, a] of [[700, 8, 1], [1150, 10, 0.6], [2600, 12, 0.25]]) { const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fr; bp.Q.value = q; const ga = ctx.createGain(); ga.gain.value = a; o.connect(bp); bp.connect(ga); ga.connect(g); }
    g.connect(this.music); o.start(t); vib.start(t); o.stop(t + dur); vib.stop(t + dur);
  }
  private harp(note: number, vol: number) {
    const ctx = this.ctx!, t = ctx.currentTime + Math.random() * 0.02;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = this.mtof(note);
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = this.mtof(note) * 2;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol * 0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    const g2 = ctx.createGain(); g2.gain.value = 0.25;
    o.connect(g); o2.connect(g2); g2.connect(g); g.connect(this.music);
    o.start(t); o2.start(t); o.stop(t + 2.3); o2.stop(t + 2.3);
  }
  private drum(vol: number) {
    const ctx = this.ctx!, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.4);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.connect(g); g.connect(this.music); o.start(t); o.stop(t + 0.5);
  }

  // ---------------------------------------------------------------- sfx
  private noise(dur: number, freq: number, type: BiquadFilterType, vol: number, out: AudioNode = this.sfx, sweepTo?: number, delay = 0) {
    const ctx = this.ctx!; if (!ctx) return;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.playbackRate.value = 1 + Math.random() * 0.3;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f); f.connect(g); g.connect(out); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  private tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', to?: number, delay = 0, out: AudioNode = this.sfx) {
    const ctx = this.ctx!; if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05);
  }
  footstep(wet: boolean) { if (!this.ctx) return; this.noise(0.09, wet ? 900 : 350, 'lowpass', wet ? 0.12 : 0.18); }
  swing() { this.noise(0.25, 1800, 'bandpass', 0.25, this.sfx, 500); }
  hit(crit = false) { this.noise(0.12, 500, 'lowpass', 0.45); this.tone(crit ? 180 : 120, 0.15, 0.3, 'square', 50); }
  uiHover() { this.tone(1400, 0.06, 0.03, 'sine'); }
  uiClick() { this.tone(660, 0.09, 0.06, 'triangle', 880); this.tone(990, 0.12, 0.03, 'sine', undefined, 0.04); }
  castCharge(spell: string, dur: number) {
    if (!this.ctx) return;
    if (spell === 'ignis') { this.noise(dur, 300, 'lowpass', 0.25, this.sfx, 1600); this.tone(80, dur, 0.12, 'sawtooth', 160); }
    else if (spell === 'fulgur') { this.noise(dur, 3000, 'highpass', 0.1); this.tone(220, dur, 0.06, 'square', 880); }
    else { for (let i = 0; i < 4; i++) this.tone(880 * [1, 1.25, 1.5, 2][i], 1.2, 0.05, 'sine', undefined, i * dur / 5); }
  }
  spell(spell: string) {
    if (spell === 'ignis') { this.noise(0.9, 1200, 'lowpass', 0.5, this.sfx, 200); }
    else if (spell === 'fulgur') { this.noise(0.25, 6000, 'highpass', 0.6); this.noise(1.6, 200, 'lowpass', 0.6, this.sfx, 50, 0.05); }
    else { for (let i = 0; i < 6; i++) this.tone(523 * [1, 1.25, 1.5, 2, 2.5, 3][i], 1.6, 0.07, 'sine', undefined, i * 0.06); }
  }
  explosion() { this.noise(1.4, 900, 'lowpass', 0.8, this.sfx, 60); this.tone(70, 0.8, 0.5, 'sine', 30); }
  thunder(delay: number, strength: number) { this.noise(3.5, 300, 'lowpass', 0.9 * strength, this.amb, 40, delay); this.noise(0.3, 4000, 'highpass', 0.2 * strength, this.amb, undefined, delay * 0.2); }
  levelUp() { [0, 4, 7, 12, 16].forEach((n, i) => this.tone(this.mtof(72 + n), 0.9, 0.08, 'triangle', undefined, i * 0.09)); }
  horn() { this.tone(330, 1.1, 0.25, 'sawtooth'); this.tone(415, 1.1, 0.2, 'sawtooth'); this.noise(1.2, 2500, 'bandpass', 0.25, this.sfx, 4000, 0.3); }
  crash() { this.noise(1.8, 1200, 'lowpass', 1.0, this.sfx, 80); this.tone(60, 1.2, 0.6, 'sine', 25); }
  voidChime() { [0, 7, 12, 19, 24].forEach((n, i) => this.tone(this.mtof(60 + n), 4, 0.05, 'sine', undefined, i * 0.35)); this.noise(5, 6000, 'bandpass', 0.04); }
  goddess() { [0, 4, 7].forEach((n, i) => this.tone(this.mtof(76 + n), 1.6, 0.04, 'sine', undefined, i * 0.12)); }
  loot() { this.tone(1320, 0.2, 0.06, 'triangle'); this.tone(1760, 0.3, 0.05, 'triangle', undefined, 0.08); }
  death() { this.tone(220, 1.6, 0.15, 'sawtooth', 55); }
  questReveal() { this.tone(this.mtof(62), 2.5, 0.08, 'sine'); this.tone(this.mtof(69), 2.5, 0.06, 'sine', undefined, 0.3); this.tone(this.mtof(74), 3, 0.06, 'sine', undefined, 0.6); this.noise(2.5, 4000, 'bandpass', 0.05); }
  bird() { if (!this.ctx) return; const f = 2500 + Math.random() * 2000; for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) this.tone(f, 0.08, 0.025, 'sine', f * (1.2 + Math.random() * 0.3), i * 0.12, this.amb); }
  cricket() { if (!this.ctx) return; for (let i = 0; i < 3; i++) this.tone(4200, 0.03, 0.012, 'square', undefined, i * 0.05, this.amb); }

  /** Voice the incantation (browser speech engine; optional). */
  chant(text: string) {
    if (!settings.chantVoice || !('speechSynthesis' in window)) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.92; u.pitch = 0.7; u.volume = settings.voice * settings.master;
      const v = speechSynthesis.getVoices().find((x) => /en-GB|en_GB/.test(x.lang)) || speechSynthesis.getVoices().find((x) => /^en/.test(x.lang));
      if (v) u.voice = v;
      speechSynthesis.speak(u);
    } catch { /* speech not available */ }
  }
}
export const audio = new Audio();
