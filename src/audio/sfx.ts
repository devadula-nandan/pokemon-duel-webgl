/**
 * Procedural Web Audio — subtle SFX.
 * No external asset files. Music is handled separately via SoundCloud.
 */

const LS_SFX_VOL = 'duel-sfx-volume';
const LS_SFX = 'duel-sfx-muted';
const LS_LEGACY = 'duel-audio-muted';

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let sfxGain: GainNode | null = null;

function readInitialSfxVolume(): number {
  const raw = localStorage.getItem(LS_SFX_VOL);
  if (raw != null) {
    const n = Number(raw);
    if (Number.isFinite(n)) return Math.max(0, Math.min(100, n));
  }
  if (localStorage.getItem(LS_SFX) === '1' || localStorage.getItem(LS_LEGACY) === '1') {
    return 0;
  }
  return 80;
}

let sfxVolume = readInitialSfxVolume();

/** Base bus level so procedural SFX sit above BGM at matched UI %. */
const SFX_BUS = 1.15;
/** Master gain at slider 100%. */
const SFX_OUTPUT_MAX = 1.35;
const SFX_CURVE = 0.85;

function ensureGraph() {
  if (!audioCtx) {
    audioCtx = new AudioContext();
    masterGain = audioCtx.createGain();
    sfxGain = audioCtx.createGain();
    sfxGain.gain.value = SFX_BUS;
    sfxGain.connect(masterGain);
    masterGain.connect(audioCtx.destination);
    applySfxVolume();
  }
  if (audioCtx.state === 'suspended') void audioCtx.resume();
  return { ac: audioCtx, sfx: sfxGain! };
}

function mapSfxUiToGain(ui: number): number {
  const clamped = Math.max(0, Math.min(100, ui));
  if (clamped <= 0) return 0;
  const t = clamped / 100;
  // Slight ease-out so mid/high slider values feel punchy.
  return Math.pow(t, SFX_CURVE) * SFX_OUTPUT_MAX;
}

function applySfxVolume() {
  if (!masterGain || !audioCtx) return;
  const v = mapSfxUiToGain(sfxVolume);
  if (v <= 0) {
    masterGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.05);
    return;
  }
  masterGain.gain.setTargetAtTime(v, audioCtx.currentTime, 0.05);
}

export function getSfxVolume(): number {
  return sfxVolume;
}

export function setSfxVolume(next: number) {
  sfxVolume = Math.max(0, Math.min(100, Math.round(next)));
  localStorage.setItem(LS_SFX_VOL, String(sfxVolume));
  ensureGraph();
  applySfxVolume();
}

export function isSfxMuted(): boolean {
  return sfxVolume <= 0;
}

/** @deprecated use isSfxMuted */
export function isMuted(): boolean {
  return isSfxMuted();
}

export function setSfxMuted(next: boolean) {
  setSfxVolume(next ? 0 : sfxVolume > 0 ? sfxVolume : 80);
}

export function toggleSfxMute(): boolean {
  setSfxMuted(!isSfxMuted());
  return isSfxMuted();
}

function noiseBuffer(ac: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function tone(
  freq: number,
  dur: number,
  type: OscillatorType = 'sine',
  peak = 0.06,
  when = 0,
) {
  const { ac, sfx } = ensureGraph();
  const t0 = ac.currentTime + when;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(sfx);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** Soft UI tap */
export function playUiTap() {
  tone(520, 0.06, 'sine', 0.035);
}

/** Figure / menu select */
export function playSelect() {
  tone(660, 0.07, 'triangle', 0.04);
  tone(880, 0.09, 'sine', 0.025, 0.04);
}

/** Piece move / enter field */
export function playMove() {
  tone(300, 0.1, 'sine', 0.045);
  tone(420, 0.12, 'triangle', 0.03, 0.05);
}

/** Hop takeoff */
export function playHop() {
  tone(480, 0.055, 'sine', 0.03);
  tone(620, 0.06, 'triangle', 0.02, 0.02);
}

/** Land on a node */
export function playLand() {
  const { ac, sfx } = ensureGraph();
  const t0 = ac.currentTime;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(220, t0);
  osc.frequency.exponentialRampToValueAtTime(110, t0 + 0.08);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.055, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1);
  osc.connect(g);
  g.connect(sfx);
  osc.start(t0);
  osc.stop(t0 + 0.12);
}

/** Heavy goal stomp */
export function playStomp() {
  const { ac, sfx } = ensureGraph();
  const t0 = ac.currentTime;

  const boom = ac.createOscillator();
  const bg = ac.createGain();
  boom.type = 'sine';
  boom.frequency.setValueAtTime(90, t0);
  boom.frequency.exponentialRampToValueAtTime(38, t0 + 0.28);
  bg.gain.setValueAtTime(0.0001, t0);
  bg.gain.exponentialRampToValueAtTime(0.16, t0 + 0.012);
  bg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
  boom.connect(bg);
  bg.connect(sfx);
  boom.start(t0);
  boom.stop(t0 + 0.34);

  const body = ac.createOscillator();
  const bodG = ac.createGain();
  body.type = 'triangle';
  body.frequency.setValueAtTime(160, t0);
  body.frequency.exponentialRampToValueAtTime(55, t0 + 0.18);
  bodG.gain.setValueAtTime(0.0001, t0);
  bodG.gain.exponentialRampToValueAtTime(0.09, t0 + 0.008);
  bodG.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
  body.connect(bodG);
  bodG.connect(sfx);
  body.start(t0);
  body.stop(t0 + 0.22);

  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac, 0.16);
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 520;
  const ng = ac.createGain();
  ng.gain.setValueAtTime(0.0001, t0);
  ng.gain.exponentialRampToValueAtTime(0.14, t0 + 0.006);
  ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
  src.connect(lp);
  lp.connect(ng);
  ng.connect(sfx);
  src.start(t0);
  src.stop(t0 + 0.16);
}

/** Figure surrounded → PC */
export function playSurround() {
  const { ac, sfx } = ensureGraph();
  const t0 = ac.currentTime;

  // Tight “trap” noise sweep
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac, 0.22);
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(2400, t0);
  bp.frequency.exponentialRampToValueAtTime(280, t0 + 0.2);
  bp.Q.value = 3.2;
  const ng = ac.createGain();
  ng.gain.setValueAtTime(0.0001, t0);
  ng.gain.exponentialRampToValueAtTime(0.09, t0 + 0.02);
  ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
  src.connect(bp);
  bp.connect(ng);
  ng.connect(sfx);
  src.start(t0);
  src.stop(t0 + 0.22);

  // Descending catch sting
  tone(420, 0.12, 'triangle', 0.055);
  tone(280, 0.16, 'sine', 0.05, 0.07);
  tone(160, 0.22, 'triangle', 0.045, 0.14);
}

/** Battle begins */
export function playBattleStart() {
  tone(220, 0.18, 'sine', 0.05);
  tone(330, 0.2, 'triangle', 0.035, 0.08);
}

/** Match wheel CSS cubic-bezier(0.1, 0.7, 0.08, 1) closely enough for tick timing. */
function wheelSpinEaseInverse(p: number): number {
  const x = Math.min(0.9999, Math.max(0, p));
  // Inverse of strong ease-out (≈ easeOutQuint)
  return 1 - Math.pow(1 - x, 0.2);
}

/** One mechanical detent click — noise transient + short body. */
function scheduleRatchetTick(
  ac: AudioContext,
  sfx: GainNode,
  at: number,
  intensity: number,
) {
  const i = Math.max(0.15, Math.min(1, intensity));
  const noiseDur = 0.012 + i * 0.012;

  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac, noiseDur);
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 700 + i * 500;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1400 + i * 1600;
  bp.Q.value = 5.5;
  const ng = ac.createGain();
  const nPeak = 0.055 + i * 0.09;
  ng.gain.setValueAtTime(0.0001, at);
  ng.gain.exponentialRampToValueAtTime(nPeak, at + 0.0012);
  ng.gain.exponentialRampToValueAtTime(0.0001, at + noiseDur);
  src.connect(hp);
  hp.connect(bp);
  bp.connect(ng);
  ng.connect(sfx);
  src.start(at);
  src.stop(at + noiseDur + 0.01);

  // Hard plastic/metal “tick” body
  const osc = ac.createOscillator();
  const og = ac.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(1100 + i * 500, at);
  osc.frequency.exponentialRampToValueAtTime(140 + i * 40, at + 0.028);
  og.gain.setValueAtTime(0.0001, at);
  og.gain.exponentialRampToValueAtTime(0.028 + i * 0.04, at + 0.001);
  og.gain.exponentialRampToValueAtTime(0.0001, at + 0.032);
  osc.connect(og);
  og.connect(sfx);
  osc.start(at);
  osc.stop(at + 0.04);
}

/**
 * Tactile spinner: dense ratchet ticks that decelerate with the wheel,
 * plus a soft bearing whir and a final seat clack.
 */
export function playWheelSpin(durationSec = 2.6) {
  const { ac, sfx } = ensureGraph();
  const t0 = ac.currentTime;

  // Quiet bearing whir under the clicks
  const whir = ac.createBufferSource();
  whir.buffer = noiseBuffer(ac, durationSec + 0.1);
  const whirBp = ac.createBiquadFilter();
  whirBp.type = 'bandpass';
  whirBp.frequency.setValueAtTime(1200, t0);
  whirBp.frequency.exponentialRampToValueAtTime(280, t0 + durationSec);
  whirBp.Q.value = 1.6;
  const whirG = ac.createGain();
  whirG.gain.setValueAtTime(0.0001, t0);
  whirG.gain.exponentialRampToValueAtTime(0.035, t0 + 0.08);
  whirG.gain.exponentialRampToValueAtTime(0.012, t0 + durationSec * 0.7);
  whirG.gain.exponentialRampToValueAtTime(0.0001, t0 + durationSec);
  whir.connect(whirBp);
  whirBp.connect(whirG);
  whirG.connect(sfx);
  whir.start(t0);
  whir.stop(t0 + durationSec + 0.05);

  // Detents along ~6 revolutions (matches animateWheelSpin’s +360*6)
  const totalDeg = 360 * 6.15;
  const tickDeg = 12;
  const n = Math.floor(totalDeg / tickDeg);
  let lastT = 0;

  for (let i = 0; i < n; i++) {
    const p = (i + 1) / n;
    const u = wheelSpinEaseInverse(p);
    const t = u * durationSec;
    // Skip if two ticks would land in the same audio frame near the stop
    if (t - lastT < 0.014 && i < n - 1) continue;
    const dt = Math.max(0.012, t - lastT);
    // Faster angular steps → brighter/louder tick
    const intensity = Math.min(1, 0.22 / dt);
    scheduleRatchetTick(ac, sfx, t0 + t, intensity);
    lastT = t;
  }

  // Final seat into the pointer
  const clackAt = t0 + durationSec - 0.02;
  const clackNoise = ac.createBufferSource();
  clackNoise.buffer = noiseBuffer(ac, 0.05);
  const clackHp = ac.createBiquadFilter();
  clackHp.type = 'lowpass';
  clackHp.frequency.value = 900;
  const clackG = ac.createGain();
  clackG.gain.setValueAtTime(0.0001, clackAt);
  clackG.gain.exponentialRampToValueAtTime(0.11, clackAt + 0.004);
  clackG.gain.exponentialRampToValueAtTime(0.0001, clackAt + 0.08);
  clackNoise.connect(clackHp);
  clackHp.connect(clackG);
  clackG.connect(sfx);
  clackNoise.start(clackAt);
  clackNoise.stop(clackAt + 0.09);

  const thunk = ac.createOscillator();
  const tg = ac.createGain();
  thunk.type = 'triangle';
  thunk.frequency.setValueAtTime(220, clackAt);
  thunk.frequency.exponentialRampToValueAtTime(70, clackAt + 0.12);
  tg.gain.setValueAtTime(0.0001, clackAt);
  tg.gain.exponentialRampToValueAtTime(0.08, clackAt + 0.006);
  tg.gain.exponentialRampToValueAtTime(0.0001, clackAt + 0.14);
  thunk.connect(tg);
  tg.connect(sfx);
  thunk.start(clackAt);
  thunk.stop(clackAt + 0.16);
}

export function playCountdownTick(n: number) {
  tone(n === 1 ? 520 : 380 + (3 - n) * 40, 0.12, 'sine', 0.045);
}

/** Player-favorable spin */
export function playSpinWin() {
  tone(523, 0.14, 'sine', 0.05);
  tone(659, 0.16, 'sine', 0.04, 0.08);
  tone(784, 0.22, 'triangle', 0.035, 0.16);
}

/** Player-unfavorable spin */
export function playSpinLose() {
  tone(392, 0.16, 'sine', 0.045);
  tone(311, 0.22, 'triangle', 0.04, 0.1);
}

/** Neutral / draw / blue */
export function playSpinDraw() {
  tone(440, 0.12, 'sine', 0.04);
  tone(440, 0.14, 'triangle', 0.025, 0.1);
}

export function playHeal() {
  tone(520, 0.1, 'sine', 0.04);
  tone(780, 0.18, 'sine', 0.035, 0.07);
}

export function playTurnChange() {
  tone(280, 0.1, 'sine', 0.035);
  tone(360, 0.12, 'triangle', 0.025, 0.06);
}

export function playVictory() {
  [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.28, 'sine', 0.05, i * 0.12));
}

export function playDefeat() {
  tone(330, 0.25, 'sine', 0.05);
  tone(262, 0.35, 'triangle', 0.04, 0.15);
  tone(196, 0.45, 'sine', 0.035, 0.32);
}

export function playMatchStart() {
  tone(392, 0.12, 'sine', 0.04);
  tone(523, 0.16, 'triangle', 0.035, 0.1);
  tone(659, 0.2, 'sine', 0.03, 0.2);
}
