/**
 * Minimal UI beep SFX (procedural Web Audio).
 */

const LS_SFX_VOL = 'duel-sfx-volume';
const LS_SFX = 'duel-sfx-muted';
const LS_LEGACY = 'duel-audio-muted';

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;

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

function mapVolume(ui: number): number {
  const clamped = Math.max(0, Math.min(100, ui));
  if (clamped <= 0) return 0;
  return Math.pow(clamped / 100, 0.7) * 0.2;
}

async function ensureReady() {
  if (!audioCtx) {
    audioCtx = new AudioContext();
    masterGain = audioCtx.createGain();
    masterGain.connect(audioCtx.destination);
    applyVolume();
  }
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  return { ac: audioCtx, master: masterGain! };
}

function applyVolume() {
  if (!masterGain || !audioCtx) return;
  masterGain.gain.setTargetAtTime(mapVolume(sfxVolume), audioCtx.currentTime, 0.03);
}

export function getSfxVolume(): number {
  return sfxVolume;
}

export function setSfxVolume(next: number) {
  sfxVolume = Math.max(0, Math.min(100, Math.round(next)));
  localStorage.setItem(LS_SFX_VOL, String(sfxVolume));
  void ensureReady().then(applyVolume);
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

/** Short square beep — used for every SFX. */
function beep(freq = 880, dur = 0.05) {
  if (sfxVolume <= 0) return;
  void (async () => {
    try {
      const { ac, master } = await ensureReady();
      const t0 = ac.currentTime;
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(1, t0 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g);
      g.connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    } catch {
      /* ignore */
    }
  })();
}

export function playUiTap() {
  beep();
}
export function playSelect() {
  beep();
}
export function playCry(_seed = 0) {
  /* no cries */
}
export function playMove() {
  beep();
}
export function playHop() {
  beep();
}
export function playLand() {
  beep();
}
export function playStomp() {
  beep();
}
export function playBattleStart() {
  beep();
}
export function playHit() {
  beep();
}
export function playMiss() {
  beep();
}
export function playStatusHit() {
  beep();
}
export function playGuard() {
  beep();
}
export function playSurround() {
  beep();
}
export function playHeal() {
  beep();
}
export function playPlateUse() {
  beep();
}
export function playTurnChange() {
  beep();
}
export function playMatchStart() {
  beep();
}
export function playVictory() {
  beep();
}
export function playDefeat() {
  beep();
}
export function playWheelSpin(_durationSec = 2.6) {
  beep();
}
export function playCountdownTick(_n: number) {
  beep();
}
export function playSpinWin() {
  beep();
}
export function playSpinLose() {
  beep();
}
export function playSpinDraw() {
  beep();
}

export function preloadSfx() {
  void ensureReady();
}

let gestureArmed = false;
function armUnlock() {
  if (gestureArmed) return;
  gestureArmed = true;
  const unlock = () => void ensureReady();
  addEventListener('pointerdown', unlock, { once: true, capture: true });
  addEventListener('keydown', unlock, { once: true, capture: true });
}
armUnlock();
