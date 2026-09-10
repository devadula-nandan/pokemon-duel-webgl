import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import figuresData from './data/figures.json';
import { DuelEngine } from './game/engine';
import { pickAiAction } from './game/ai';
import type { FigureDef } from './game/types';
import { BoardView, BOARD_TOP } from './render/BoardView';
import { animateWheelDamageBoost, animateWheelSpin, createWheelCanvas } from './render/wheel';
import { applyTurnBuffToWheel } from './game/combat';
import { pokemonArtUrl } from './render/pokemonArt';
import {
  entryNodes,
  goalNode,
  shortestPath,
  shortestPathFromBench,
} from './game/board';
import {
  DEFAULT_AI_PLATES,
  DEFAULT_PLAYER_PLATES,
  MAX_PLATE_COST,
  PLATES,
  PLATE_BY_ID,
  canUsePlateInstance,
  isValidPlateDeck,
  plateCost,
  validTargets,
} from './game/plates';
import { MatchNet } from './game/net';
import type { HudActionId } from './render/MatchHud3D';
import {
  getSfxVolume,
  isSfxMuted,
  playBattleStart,
  playDefeat,
  playHeal,
  playHop,
  playLand,
  playMatchStart,
  playMiss,
  playPlateUse,
  playSelect,
  playSpinDraw,
  playSpinLose,
  playSpinWin,
  playStomp,
  playSurround,
  playTurnChange,
  playUiTap,
  playVictory,
  playWheelSpin,
  setSfxVolume,
} from './audio/sfx';
import {
  getMusicVolume,
  getTrackLabel,
  isBgmPlaying,
  isBgmWanted,
  isMusicMuted,
  mountBgmInSettings,
  nextBgmTrack,
  pauseBgmSoft,
  prevBgmTrack,
  restartBgm,
  setMusicVolume,
  setPlayChangeListener,
  setTrackChangeListener,
  startBgm,
  toggleBgm,
} from './audio/bgm';

const figures = (figuresData as FigureDef[]).map((f) => {
  // Phase 2: seed sample abilities + types for demo figures
  const enrich: Partial<FigureDef> = {};
  if (f.name === 'Haunter' || f.name === 'Gengar') {
    enrich.ability = 'Cannot be surrounded.';
    enrich.types = ['Ghost', 'Poison'];
  }
  if (f.name === 'Pikachu') {
    enrich.ability = 'MP +1 when entering from bench.';
    enrich.types = ['Electric'];
  }
  if (f.name === 'Eevee') enrich.types = ['Normal'];
  if (f.name === 'Charmander' || f.name === 'Charizard') enrich.types = ['Fire'];
  if (f.name === 'Squirtle') enrich.types = ['Water'];
  if (f.name === 'Bulbasaur') enrich.types = ['Grass', 'Poison'];
  if (f.name === 'Rattata') enrich.types = ['Normal'];
  if (f.name === 'Salamence') enrich.types = ['Dragon', 'Flying'];
  if (f.name === 'Charizard' || f.name === 'Salamence') {
    enrich.megaWheel = f.wheel.map((w) =>
      w.color === 'white' || w.color === 'gold'
        ? { ...w, damage: w.damage + 30 }
        : { ...w },
    );
    enrich.megaMp = f.mp + 1;
  }
  return { ...f, ...enrich, ability: enrich.ability ?? f.ability ?? null };
});
const engine = new DuelEngine(figures);
const matchNet = new MatchNet(engine);
const ui = document.getElementById('ui')!;
const canvas = document.getElementById('c') as HTMLCanvasElement;

const plateHandScrim = document.createElement('div');
plateHandScrim.id = 'plate-hand-scrim';
plateHandScrim.className = 'plate-hand-scrim hidden';
plateHandScrim.setAttribute('aria-hidden', 'true');

const plateOverlayCanvas = document.createElement('canvas');
plateOverlayCanvas.id = 'plate-hand-overlay';
plateOverlayCanvas.className = 'plate-hand-overlay hidden';

document.getElementById('app')!.insertBefore(plateHandScrim, ui);
document.getElementById('app')!.insertBefore(plateOverlayCanvas, ui);

/** Filled by settings mount — refreshes battle log while the sheet is open. */
let syncSettingsLog = () => {};

type UiTheme = 'dark' | 'light';
const THEME_KEY = 'duel-field-theme';

function getStoredTheme(): UiTheme {
  const v = localStorage.getItem(THEME_KEY);
  return v === 'light' ? 'light' : 'dark';
}

function applyTheme(theme: UiTheme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  applyWorldTheme(theme);
}

/** Updated once the Three.js scene / lights exist. */
let applyWorldTheme: (theme: UiTheme) => void = () => {};

applyTheme(getStoredTheme());

function ensureAudioControls() {
  if (document.getElementById('settings-btn')) return;

  const settingsBtn = document.createElement('button');
  settingsBtn.id = 'settings-btn';
  settingsBtn.type = 'button';
  settingsBtn.className = 'settings-btn';
  settingsBtn.title = 'Settings';
  settingsBtn.setAttribute('aria-label', 'Settings');
  settingsBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`;

  const dialog = document.createElement('div');
  dialog.id = 'settings-dialog';
  dialog.className = 'settings-dialog hidden';
  dialog.innerHTML = `
    <div class="settings-sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div class="settings-top">
        <div class="settings-top-copy">
          <p class="settings-kicker">Duel Field</p>
          <h2 id="settings-title">Settings</h2>
        </div>
        <button type="button" class="settings-close" id="settings-close" aria-label="Close">✕</button>
      </div>
      <div class="settings-body">
        <section class="settings-section">
          <h3>Appearance</h3>
          <div class="theme-switch" role="group" aria-label="Color theme">
            <button type="button" class="theme-option" data-theme-opt="dark" id="theme-dark">
              <span class="theme-option-title">Arena night</span>
              <span class="theme-option-sub">Warm stone &amp; copper — match board</span>
              <span class="theme-swatches" aria-hidden="true">
                <i style="background:#140e0a"></i>
                <i style="background:#e8a860"></i>
                <i style="background:#ff6b35"></i>
              </span>
            </button>
            <button type="button" class="theme-option" data-theme-opt="light" id="theme-light">
              <span class="theme-option-title">Daylight</span>
              <span class="theme-option-sub">Paper cream &amp; clay accents</span>
              <span class="theme-swatches" aria-hidden="true">
                <i style="background:#f4ece3"></i>
                <i style="background:#c4783a"></i>
                <i style="background:#2a1c12"></i>
              </span>
            </button>
          </div>
        </section>
        <section class="settings-section">
          <h3>Camera</h3>
          <div class="settings-camera-row" role="group" aria-label="Camera controls">
            <button type="button" class="settings-chip bgm-icon-btn" id="camera-reset" title="Reset camera" aria-label="Reset camera">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>
              </svg>
            </button>
            <button type="button" class="settings-chip bgm-icon-btn" id="camera-lock" title="Lock camera" aria-label="Lock camera" aria-pressed="false">
              <svg class="cam-lock-open" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-1.8"/>
              </svg>
              <svg class="cam-lock-closed" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>
              </svg>
            </button>
          </div>
          <p class="settings-hint">Reset returns to the default match view. Lock freezes orbit so drag won't move the camera.</p>
        </section>
        <section class="settings-section">
          <h3>Audio</h3>
          <div class="settings-audio-row" id="audio-controls">
            <div class="bgm-transport" role="group" aria-label="Music controls">
              <button type="button" class="settings-chip bgm-icon-btn" id="bgm-prev" title="Previous" aria-label="Previous track">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 6h2v12H6V6zm3.5 6 8.5 6V6l-8.5 6z"/></svg>
              </button>
              <button type="button" class="settings-chip bgm-icon-btn" id="bgm-toggle" title="${isBgmPlaying() ? 'Pause' : 'Play'}" aria-label="${isBgmPlaying() ? 'Pause' : 'Play'}" aria-pressed="${isBgmPlaying() ? 'true' : 'false'}">
                <svg class="bgm-icon-play" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7L8 5z"/></svg>
                <svg class="bgm-icon-pause" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z"/></svg>
              </button>
              <button type="button" class="settings-chip bgm-icon-btn" id="bgm-restart" title="Restart" aria-label="Restart track">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>
              </button>
              <button type="button" class="settings-chip bgm-icon-btn" id="bgm-next" title="Next" aria-label="Next track">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 18l8.5-6L6 6v12zM16 6h2v12h-2V6z"/></svg>
              </button>
            </div>
            <div id="bgm-label" class="settings-chip bgm-label">${getTrackLabel()}</div>
          </div>
          <div class="settings-sliders">
            <label class="settings-slider">
              <span class="settings-slider-label">Music <em id="music-vol-val">${getMusicVolume()}%</em></span>
              <input id="music-volume" type="range" min="0" max="100" step="1" value="${getMusicVolume()}" />
            </label>
            <label class="settings-slider">
              <span class="settings-slider-label">Sounds <em id="sfx-vol-val">${getSfxVolume()}%</em></span>
              <input id="sfx-volume" type="range" min="0" max="100" step="1" value="${getSfxVolume()}" />
            </label>
          </div>
          <div id="sc-bgm-mount" class="sc-bgm-mount"></div>
          <p class="settings-hint">Music streams from SoundCloud (Pokémon Red/Blue Game Boy OST). Track and play state are saved.</p>
        </section>
        <section class="settings-section">
          <h3>Match</h3>
          <div class="settings-camera-row" role="group" aria-label="Match controls">
            <button type="button" class="settings-chip resign-btn" id="resign" title="Resign" aria-label="Resign" disabled>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </button>
          </div>
          <p class="settings-hint">Resign ends the match as a loss. Only available during a duel.</p>
        </section>
        <section class="settings-section">
          <h3>Battle log</h3>
          <div class="settings-log" id="settings-log"></div>
        </section>
      </div>
    </div>
  `;

  const musicSlider = () => dialog.querySelector('#music-volume') as HTMLInputElement;
  const sfxSlider = () => dialog.querySelector('#sfx-volume') as HTMLInputElement;
  const musicVal = () => dialog.querySelector('#music-vol-val') as HTMLElement;
  const sfxVal = () => dialog.querySelector('#sfx-vol-val') as HTMLElement;
  const trackLabel = () => dialog.querySelector('#bgm-label') as HTMLElement;
  const bgmToggle = () => dialog.querySelector('#bgm-toggle') as HTMLButtonElement;
  const bgmRestart = () => dialog.querySelector('#bgm-restart') as HTMLButtonElement;
  const bgmPrev = () => dialog.querySelector('#bgm-prev') as HTMLButtonElement;
  const bgmNext = () => dialog.querySelector('#bgm-next') as HTMLButtonElement;

  const paintTheme = () => {
    const theme = getStoredTheme();
    dialog.querySelectorAll<HTMLElement>('[data-theme-opt]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.themeOpt === theme);
    });
  };

  const paintBgmControls = () => {
    const playing = isBgmPlaying();
    const btn = bgmToggle();
    btn.classList.toggle('is-playing', playing);
    btn.classList.toggle('active', playing);
    btn.setAttribute('aria-pressed', playing ? 'true' : 'false');
    btn.title = playing ? 'Pause' : 'Play';
    btn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    trackLabel().textContent = getTrackLabel();
  };

  const paintAudio = () => {
    musicSlider().value = String(getMusicVolume());
    sfxSlider().value = String(getSfxVolume());
    musicVal().textContent = `${getMusicVolume()}%`;
    sfxVal().textContent = `${getSfxVolume()}%`;
    paintBgmControls();
  };

  const paintBattleLog = () => {
    const logEl = dialog.querySelector('#settings-log') as HTMLElement;
    const lines = engine.state.log;
    if (!lines.length) {
      logEl.innerHTML = `<p class="settings-log-empty">No events yet.</p>`;
      return;
    }
    logEl.innerHTML = lines.map((l) => `<div class="settings-log-line">${l}</div>`).join('');
  };

  const paintResign = () => {
    const btn = dialog.querySelector('#resign') as HTMLButtonElement;
    const canResign =
      engine.state.phase === 'playing' || engine.state.phase === 'battle';
    btn.disabled = !canResign;
  };

  const openSettings = () => {
    if (!isSfxMuted()) playUiTap();
    paintAudio();
    paintBattleLog();
    paintTheme();
    paintResign();
    trackLabel().textContent = getTrackLabel();
    dialog.classList.remove('hidden');
  };

  const closeSettings = () => {
    if (!isSfxMuted()) playUiTap();
    dialog.classList.add('hidden');
  };

  settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openSettings();
  });

  dialog.querySelector('#settings-close')!.addEventListener('click', (e) => {
    e.stopPropagation();
    closeSettings();
  });

  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) closeSettings();
  });

  dialog.querySelectorAll<HTMLElement>('[data-theme-opt]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const next = (btn.dataset.themeOpt === 'light' ? 'light' : 'dark') as UiTheme;
      applyTheme(next);
      paintTheme();
      kickRenderLoop();
      if (!isSfxMuted()) playUiTap();
    });
  });

  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !dialog.classList.contains('hidden')) closeSettings();
  });

  setTrackChangeListener((title) => {
    trackLabel().textContent = title;
  });

  setPlayChangeListener(() => {
    paintBgmControls();
  });

  musicSlider().addEventListener('input', () => {
    const v = Number(musicSlider().value);
    setMusicVolume(v);
    musicVal().textContent = `${v}%`;
    if (v > 0 && isBgmWanted()) void startBgm();
    paintBgmControls();
  });

  sfxSlider().addEventListener('input', () => {
    const v = Number(sfxSlider().value);
    setSfxVolume(v);
    sfxVal().textContent = `${v}%`;
  });

  bgmToggle().addEventListener('click', (e) => {
    e.stopPropagation();
    if (!isSfxMuted()) playUiTap();
    toggleBgm();
    paintBgmControls();
  });

  bgmRestart().addEventListener('click', (e) => {
    e.stopPropagation();
    if (!isSfxMuted()) playUiTap();
    void restartBgm();
    paintBgmControls();
  });

  bgmPrev().addEventListener('click', (e) => {
    e.stopPropagation();
    if (!isSfxMuted()) playUiTap();
    void prevBgmTrack().then(() => paintBgmControls());
  });

  bgmNext().addEventListener('click', (e) => {
    e.stopPropagation();
    if (!isSfxMuted()) playUiTap();
    void nextBgmTrack().then(() => paintBgmControls());
  });

  dialog.querySelector('#resign')!.addEventListener('click', (e) => {
    e.stopPropagation();
    if (engine.state.phase !== 'playing' && engine.state.phase !== 'battle') return;
    if (!isSfxMuted()) playUiTap();
    engine.state.phase = 'game-over';
    engine.state.winner = 'opponent';
    engine.state.winReason = 'You resigned.';
    matchNet.commit({
      seq: engine.state.actionSeq,
      type: 'resign',
      winner: 'opponent',
    });
    closeSettings();
    ui.innerHTML = '';
    scheduleMatchReport();
  });

  paintAudio();
  paintBattleLog();
  paintTheme();
  paintResign();
  syncSettingsLog = paintBattleLog;
  document.getElementById('app')!.append(settingsBtn, dialog);
  mountBgmInSettings();
  if (isBgmWanted() && !isMusicMuted()) void startBgm();
}

ensureAudioControls();

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.localClippingEnabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a0e0a);
scene.fog = new THREE.FogExp2(0x1a0e0a, 0.028);

const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 100);
// Portrait duel camera: high angle looking toward opponent (matches reference)
camera.position.set(0, 11.5, 8.6);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0, 0);
controls.enablePan = false;
controls.minDistance = 9;
controls.maxDistance = 18;
controls.minPolarAngle = Math.PI * 0.18;
controls.maxPolarAngle = Math.PI * 0.42;
controls.update();

// Snapshot after OrbitControls normalizes spherical coords
const CAM_DEFAULT_POS = camera.position.clone();
const CAM_DEFAULT_TARGET = controls.target.clone();
const CAM_DEFAULT_FOV = camera.fov;

const CAMERA_PREFS_KEY = 'duel-camera-view';

type CameraPrefs = {
  pos: [number, number, number];
  target: [number, number, number];
  fov: number;
  locked: boolean;
};

const resetCamBtn = document.getElementById('camera-reset') as HTMLButtonElement;
const lockCamBtn = document.getElementById('camera-lock') as HTMLButtonElement;

let cameraLocked = false;

function applyCameraLock() {
  if (goalCinematic || camTween) {
    controls.enabled = false;
    return;
  }
  controls.enabled = !cameraLocked;
}

function syncCameraLockBtn() {
  lockCamBtn.classList.toggle('active', cameraLocked);
  lockCamBtn.setAttribute('aria-pressed', cameraLocked ? 'true' : 'false');
  lockCamBtn.title = cameraLocked ? 'Unlock camera' : 'Lock camera';
  lockCamBtn.setAttribute('aria-label', cameraLocked ? 'Unlock camera' : 'Lock camera');
}

function cameraIsDefault() {
  return (
    camera.position.distanceToSquared(CAM_DEFAULT_POS) < 0.0025 &&
    controls.target.distanceToSquared(CAM_DEFAULT_TARGET) < 0.0025 &&
    Math.abs(camera.fov - CAM_DEFAULT_FOV) < 0.05
  );
}

function syncCameraResetBtn() {
  resetCamBtn.disabled = (cameraIsDefault() && !camTween) || goalCinematic;
}

function saveCameraPrefs() {
  if (goalCinematic || camTween) return;
  const prefs: CameraPrefs = {
    pos: [camera.position.x, camera.position.y, camera.position.z],
    target: [controls.target.x, controls.target.y, controls.target.z],
    fov: camera.fov,
    locked: cameraLocked,
  };
  localStorage.setItem(CAMERA_PREFS_KEY, JSON.stringify(prefs));
}

function readCameraPrefs(): CameraPrefs | null {
  try {
    const raw = localStorage.getItem(CAMERA_PREFS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as CameraPrefs;
    if (
      !Array.isArray(p.pos) ||
      p.pos.length !== 3 ||
      !Array.isArray(p.target) ||
      p.target.length !== 3 ||
      !Number.isFinite(p.fov) ||
      p.pos.some((n) => !Number.isFinite(n)) ||
      p.target.some((n) => !Number.isFinite(n))
    ) {
      return null;
    }
    return { pos: p.pos, target: p.target, fov: p.fov, locked: !!p.locked };
  } catch {
    return null;
  }
}

function applyCameraPrefs(prefs: CameraPrefs) {
  camera.position.set(prefs.pos[0], prefs.pos[1], prefs.pos[2]);
  controls.target.set(prefs.target[0], prefs.target[1], prefs.target[2]);
  camera.fov = prefs.fov;
  camera.updateProjectionMatrix();
  cameraLocked = prefs.locked;
  controls.update();
  applyCameraLock();
  syncCameraLockBtn();
  syncCameraResetBtn();
}

let goalCinematic = false;
let camTween: {
  t0: number;
  dur: number;
  fromPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toPos: THREE.Vector3;
  toTarget: THREE.Vector3;
  fromFov: number;
  toFov: number;
  resolve: (() => void) | null;
} | null = null;

function cancelCameraTween(restoreControls = true) {
  if (camTween?.resolve) camTween.resolve();
  camTween = null;
  if (restoreControls && !goalCinematic) applyCameraLock();
}

function tickCameraTween() {
  if (!camTween) return;
  const u = Math.min(1, (performance.now() - camTween.t0) / camTween.dur);
  const e = u * u * (3 - 2 * u); // smoothstep — subtle cinematic ease
  camera.position.lerpVectors(camTween.fromPos, camTween.toPos, e);
  controls.target.lerpVectors(camTween.fromTarget, camTween.toTarget, e);
  camera.fov = camTween.fromFov + (camTween.toFov - camTween.fromFov) * e;
  camera.updateProjectionMatrix();
  controls.update();
  if (u >= 1) {
    camera.position.copy(camTween.toPos);
    controls.target.copy(camTween.toTarget);
    camera.fov = camTween.toFov;
    camera.updateProjectionMatrix();
    controls.update();
    const resolve = camTween.resolve;
    camTween = null;
    if (!goalCinematic) applyCameraLock();
    resolve?.();
    syncCameraResetBtn();
  }
}

function animateCameraTo(
  toPos: THREE.Vector3,
  toTarget: THREE.Vector3,
  opts?: { dur?: number; fov?: number },
): Promise<void> {
  cancelCameraTween(false);
  controls.enabled = false;
  const dur = opts?.dur ?? 900;
  kickRenderLoop();
  return new Promise((resolve) => {
    camTween = {
      t0: performance.now(),
      dur,
      fromPos: camera.position.clone(),
      fromTarget: controls.target.clone(),
      toPos: toPos.clone(),
      toTarget: toTarget.clone(),
      fromFov: camera.fov,
      toFov: opts?.fov ?? camera.fov,
      resolve,
    };
  });
}

controls.addEventListener('change', syncCameraResetBtn);
controls.addEventListener('end', () => {
  syncCameraResetBtn();
  saveCameraPrefs();
});
controls.addEventListener('start', () => {
  cancelCameraTween();
  syncCameraResetBtn();
});

resetCamBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (resetCamBtn.disabled || (cameraIsDefault() && !camTween)) return;
  if (!isSfxMuted()) playUiTap();
  void animateCameraTo(CAM_DEFAULT_POS, CAM_DEFAULT_TARGET, {
    dur: 750,
    fov: CAM_DEFAULT_FOV,
  }).then(() => {
    syncCameraResetBtn();
    saveCameraPrefs();
  });
});

lockCamBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!isSfxMuted()) playUiTap();
  cameraLocked = !cameraLocked;
  applyCameraLock();
  syncCameraLockBtn();
  saveCameraPrefs();
});

{
  const saved = readCameraPrefs();
  if (saved) applyCameraPrefs(saved);
  else {
    syncCameraLockBtn();
    syncCameraResetBtn();
  }
}

const hemi = new THREE.HemisphereLight(0xffe0c0, 0x2a1510, 0.55);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xfff0e0, 1.2);
key.position.set(2, 14, 6);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 1;
key.shadow.camera.far = 40;
key.shadow.camera.left = -10;
key.shadow.camera.right = 10;
key.shadow.camera.top = 10;
key.shadow.camera.bottom = -10;
scene.add(key);
const fill = new THREE.DirectionalLight(0x4da3ff, 0.25);
fill.position.set(-5, 6, -2);
scene.add(fill);
const rimP = new THREE.PointLight(0x3d9bff, 35, 18);
rimP.position.set(0, 1.5, 4.5);
scene.add(rimP);
const rimO = new THREE.PointLight(0xff5252, 35, 18);
rimO.position.set(0, 1.5, -4.5);
scene.add(rimO);

const boardView = new BoardView(engine);
boardView.setCamera(camera);
scene.add(boardView.root);

const fog = scene.fog as THREE.FogExp2;
applyWorldTheme = (theme: UiTheme) => {
  const day = theme === 'light';
  const bg = day ? 0xe8dcc8 : 0x1a0e0a;
  scene.background = new THREE.Color(bg);
  fog.color.setHex(bg);
  fog.density = day ? 0.012 : 0.028;

  hemi.color.setHex(day ? 0xfff4e8 : 0xffe0c0);
  hemi.groundColor.setHex(day ? 0x8a7a62 : 0x2a1510);
  hemi.intensity = day ? 0.95 : 0.55;

  key.color.setHex(day ? 0xfffaf0 : 0xfff0e0);
  key.intensity = day ? 1.55 : 1.2;
  key.position.set(day ? 4 : 2, day ? 16 : 14, day ? 3 : 6);

  fill.color.setHex(day ? 0x9ec8ff : 0x4da3ff);
  fill.intensity = day ? 0.45 : 0.25;

  rimP.intensity = day ? 12 : 35;
  rimO.intensity = day ? 12 : 35;

  renderer.toneMappingExposure = day ? 1.28 : 1.15;
  boardView.setWorldTheme(theme);
};
applyWorldTheme(getStoredTheme());

const plateOverlayScene = new THREE.Scene();
const plateOverlayRenderer = new THREE.WebGLRenderer({
  canvas: plateOverlayCanvas,
  antialias: true,
  alpha: true,
});
plateOverlayRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
plateOverlayRenderer.setSize(innerWidth, innerHeight);
plateOverlayRenderer.setClearColor(0x000000, 0);

function setPlateHandBackdrop(open: boolean) {
  canvas.classList.toggle('is-plate-hand', open);
  plateHandScrim.classList.toggle('hidden', !open);
  plateHandScrim.setAttribute('aria-hidden', open ? 'false' : 'true');
  plateOverlayCanvas.classList.toggle('hidden', !open);
  if (open) {
    plateOverlayScene.add(boardView.matchHud.root);
    kickRenderLoop();
  } else {
    boardView.root.add(boardView.matchHud.root);
  }
}

boardView.matchHud.onHandChange = setPlateHandBackdrop;

const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let aiBusy = false;
let battleBusy = false;
let moveBusy = false;

function occupiedForPath(exceptUid: string): Set<string> {
  return new Set(
    engine.state.pieces
      .filter((p) => p.location === 'field' && p.nodeId && p.uid !== exceptUid && !p.removed)
      .map((p) => p.nodeId!),
  );
}

async function animatePieceMove(
  uid: string,
  waypoints: THREE.Vector3[],
  opts?: {
    hopMs?: number;
    hopHeight?: number;
    ease?: 'fall' | 'hop' | 'stomp';
    onHop?: () => void;
    onLand?: () => void;
  },
) {
  if (waypoints.length < 2) return;
  await boardView.animateAlongPath(uid, waypoints, {
    hopMs: opts?.hopMs ?? 260,
    hopHeight: opts?.hopHeight,
    ease: opts?.ease,
    onHop: opts?.onHop ?? (() => playHop()),
    onLand: opts?.onLand ?? (() => playLand()),
  });
}

async function cameraShake(magnitude = 0.07, ms = 260) {
  const origin = camera.position.clone();
  const t0 = performance.now();
  await new Promise<void>((resolve) => {
    const tick = () => {
      const u = Math.min(1, (performance.now() - t0) / ms);
      const damp = (1 - u) * (1 - u);
      camera.position.set(
        origin.x + (Math.random() - 0.5) * magnitude * damp,
        origin.y + (Math.random() - 0.5) * magnitude * 0.55 * damp,
        origin.z + (Math.random() - 0.5) * magnitude * damp,
      );
      controls.update();
      if (u >= 1) {
        camera.position.copy(origin);
        controls.update();
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** One hop from field → PC (same single-hop feel as node-to-node). */
function buildWorldHopWaypoints(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] {
  return [from.clone(), to.clone()];
}

/** Build hop waypoints before the engine mutates piece position. */
function buildMoveWaypoints(
  uid: string,
  fromNodeId: string | null,
  toNodeId: string,
  fromBench: boolean,
): THREE.Vector3[] {
  const piece = engine.piece(uid);
  if (!piece) return [];

  boardView.syncPieces(engine.state.pieces);
  const start =
    boardView.pieceWorldPos(uid) ??
    (fromNodeId
      ? (() => {
          const n = engine.board.nodes.get(fromNodeId)!;
          const w = boardView.world(n);
          w.y = BOARD_TOP;
          return w;
        })()
      : null);
  if (!start) return [];

  const occ = occupiedForPath(uid);
  let nodePath: string[] | null = null;
  if (fromBench || !fromNodeId) {
    const entries = entryNodes(engine.board.nodes, piece.owner);
    nodePath = shortestPathFromBench(engine.board.edges, entries, toNodeId, occ);
  } else {
    nodePath = shortestPath(engine.board.edges, fromNodeId, toNodeId, occ);
  }

  const waypoints: THREE.Vector3[] = [start.clone()];
  // Skip the origin field node — figure is already there (avoids hop-in-place).
  const nodes = (nodePath ?? [toNodeId]).filter((id) => id !== fromNodeId);

  for (const id of nodes) {
    const node = engine.board.nodes.get(id);
    if (!node) continue;
    const w = boardView.world(node);
    w.y = BOARD_TOP;
    const last = waypoints[waypoints.length - 1];
    if (last.distanceTo(w) < 0.08) continue;
    waypoints.push(w);
  }

  return waypoints;
}

/** Pin surrounded figures on their field node, then hop each to PC (one hop). */
async function animateSurroundsToPc(
  surrounds: { uid: string; fromNodeId: string }[],
  ejects: { uid: string; owner: 'player' | 'opponent'; fromSlot: number; causedByUid: string }[] = [],
  shifts: {
    uid: string;
    owner: 'player' | 'opponent';
    fromSlot: number;
    toSlot: number;
    causedByUid: string;
  }[] = [],
) {
  if (!surrounds.length) return;

  playSurround();

  const starts = new Map<string, THREE.Vector3>();
  for (const s of surrounds) {
    const node = engine.board.nodes.get(s.fromNodeId);
    const fromNode = node
      ? (() => {
          const w = boardView.world(node);
          w.y = BOARD_TOP;
          return w;
        })()
      : null;
    const w = boardView.pieceWorldPos(s.uid) ?? fromNode;
    if (!w) continue;
    starts.set(s.uid, w.clone());
    boardView.pinPiece(s.uid, w);
  }

  await new Promise((r) => setTimeout(r, 120));

  // Queue order: dequeue front → slide remaining forward → enqueue at back
  for (const s of surrounds) {
    const relatedEjects = ejects.filter((e) => e.causedByUid === s.uid);
    const relatedShifts = shifts.filter((sh) => sh.causedByUid === s.uid);
    if (relatedEjects.length) await animatePcEjectsToBench(relatedEjects);
    if (relatedShifts.length) await animatePcShifts(relatedShifts);

    const start = starts.get(s.uid);
    if (!start) continue;
    boardView.clearPin(s.uid);
    const dest = boardView.pcWorldForPiece(s.uid);
    if (!dest) continue;
    await animatePieceMove(s.uid, buildWorldHopWaypoints(start, dest), {
      hopMs: 420,
      hopHeight: 1.15,
    });
  }
}

/** Hop figures pushed out of a full PC back onto their bench pad (with Wait). */
async function animatePcEjectsToBench(
  ejects: {
    uid: string;
    owner: 'player' | 'opponent';
    fromSlot: number;
    causedByUid?: string;
  }[],
) {
  if (!ejects.length) return;

  for (const e of ejects) {
    const start = boardView.pcWorldSlot(e.owner, e.fromSlot);
    boardView.pinPiece(e.uid, start);
  }
  await new Promise((r) => setTimeout(r, 80));

  for (const e of ejects) {
    boardView.clearPin(e.uid);
    const start =
      boardView.pieceWorldPos(e.uid) ?? boardView.pcWorldSlot(e.owner, e.fromSlot);
    const dest = boardView.benchWorldForPiece(e.uid);
    if (!dest) continue;
    await animatePieceMove(e.uid, buildWorldHopWaypoints(start, dest), {
      hopMs: 400,
      hopHeight: 1.05,
    });
  }
}

/** Slide remaining PC figures forward after the front of the queue leaves. */
async function animatePcShifts(
  shifts: {
    uid: string;
    owner: 'player' | 'opponent';
    fromSlot: number;
    toSlot: number;
  }[],
) {
  if (!shifts.length) return;
  for (const sh of shifts) {
    const from = boardView.pcWorldSlot(sh.owner, sh.fromSlot);
    boardView.pinPiece(sh.uid, from);
  }
  await new Promise((r) => setTimeout(r, 40));
  for (const sh of shifts) {
    boardView.clearPin(sh.uid);
    const from =
      boardView.pieceWorldPos(sh.uid) ?? boardView.pcWorldSlot(sh.owner, sh.fromSlot);
    const to = boardView.pcWorldSlot(sh.owner, sh.toSlot);
    await animatePieceMove(sh.uid, buildWorldHopWaypoints(from, to), {
      hopMs: 280,
      hopHeight: 0.55,
    });
  }
}

async function tryMoveWithAnim(targetNodeId: string): Promise<boolean> {
  const uid = engine.state.selectedUid;
  if (!uid) return false;
  const piece = engine.piece(uid)!;
  const fromNodeId = piece.nodeId;
  const fromBench = piece.location === 'bench';
  const waypoints = buildMoveWaypoints(uid, fromNodeId, targetNodeId, fromBench);
  // Only the *opponent's* goal scores — standing on your own goal is defense
  const landingGoal = targetNodeId === goalNode(engine.board.nodes, piece.owner);
  if (!engine.tryMove(targetNodeId)) return false;

  // Hold surrounded figures on-field while the mover hops, then send them to PC.
  const surrounds = engine.takeLastSurrounds();
  const pcEjects = engine.takeLastPcEjects();
  const pcShifts = engine.takeLastPcShifts();
  for (const e of pcEjects) {
    boardView.pinPiece(e.uid, boardView.pcWorldSlot(e.owner, e.fromSlot));
  }
  for (const sh of pcShifts) {
    boardView.pinPiece(sh.uid, boardView.pcWorldSlot(sh.owner, sh.fromSlot));
  }
  for (const s of surrounds) {
    const node = engine.board.nodes.get(s.fromNodeId);
    if (!node) continue;
    const w = boardView.world(node);
    w.y = BOARD_TOP;
    boardView.pinPiece(s.uid, w);
  }

  moveBusy = true;
  // Engine already sits on the goal — pin so sync can't lerp there before the hop runs
  if (landingGoal && waypoints.length) {
    boardView.pinPiece(uid, waypoints[0].clone());
  }
  await presentMoveHops(uid, waypoints, landingGoal);
  boardView.clearPin(uid);
  if (!landingGoal) await animateSurroundsToPc(surrounds, pcEjects, pcShifts);
  moveBusy = false;
  return true;
}

/** Normal hops, or a snappy goal stomp with cinematic camera. */
async function presentMoveHops(
  uid: string,
  waypoints: THREE.Vector3[],
  landingGoal: boolean,
) {
  if (!landingGoal || waypoints.length < 2) {
    boardView.clearPin(uid);
    await animatePieceMove(uid, waypoints);
    return;
  }

  goalCinematic = true;
  controls.enabled = false;
  syncCameraResetBtn();

  const pre = waypoints.slice(0, -1);
  const landFrom = waypoints[waypoints.length - 2];
  const landTo = waypoints[waypoints.length - 1];

  if (pre.length >= 2) {
    boardView.clearPin(uid);
    await animatePieceMove(uid, pre);
    // Hold on the penultimate pad while the camera pushes in
    boardView.pinPiece(uid, landFrom.clone());
  } else {
    boardView.pinPiece(uid, landFrom.clone());
  }

  const cam = goalCameraFraming(landTo, engine.piece(uid)?.owner ?? 'player');
  const camP = animateCameraTo(cam.pos, cam.target, { dur: 620, fov: 27 });
  await new Promise((r) => setTimeout(r, 60));

  boardView.clearPin(uid);
  await animatePieceMove(uid, [landFrom, landTo], {
    hopMs: 720,
    hopHeight: 1.45,
    ease: 'stomp',
    onHop: () => playHop(),
    onLand: () => playStomp(),
  });
  await camP;
  // Freeze on the goal for the victory beat
  boardView.pinPiece(uid, landTo.clone());
  await cameraShake(0.085, 260);

  if (engine.state.winner === 'player') playVictory();
  else playDefeat();
  pauseBgmSoft();

  await new Promise((r) => setTimeout(r, 900));
  boardView.clearPin(uid);
  goalCinematic = false;
  applyCameraLock();
  syncCameraResetBtn();
  scheduleMatchReport(800);
}

/** Low, tight, off-axis shot looking at the scoring figure. */
function goalCameraFraming(at: THREE.Vector3, owner: 'player' | 'opponent') {
  const side = at.x >= 0 ? -1.55 : 1.55;
  // Approach from the scoring player's "near" side of the board
  const depth = owner === 'player' ? 2.35 : -2.35;
  const pos = new THREE.Vector3(at.x + side, at.y + 1.15, at.z + depth);
  const target = at.clone().add(new THREE.Vector3(0, 0.42, 0));
  return { pos, target };
}

const TURN_SECONDS = 60;
let turnDeadline = 0;
let turnTimerKey = '';

function syncTurnTimer() {
  if (engine.state.phase !== 'playing') return;
  const key = `${engine.state.turnNumber}:${engine.state.turn}`;
  if (key !== turnTimerKey) {
    turnTimerKey = key;
    turnDeadline = performance.now() + TURN_SECONDS * 1000;
  }
}

function formatTurnClock(msLeft: number) {
  const s = Math.max(0, Math.ceil(msLeft / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function updateTimerDom() {
  const el = document.getElementById('match-timer-chip') ?? document.getElementById('timer');
  syncTurnTimer();
  const playing = engine.state.phase === 'playing';
  const left = playing ? turnDeadline - performance.now() : 0;
  const frac = playing ? Math.max(0, Math.min(1, left / (TURN_SECONDS * 1000))) : 0;
  boardView.setTurnTimer(playing ? engine.state.turn : null, frac);
  if (!el || !playing) return;
  el.textContent = formatTurnClock(left);
  el.classList.toggle('urgent', left <= 10_000);
  el.classList.toggle('hot', left <= 20_000 && left > 10_000);
}

const DEFAULT_PLAYER = ['Charmander', 'Pikachu', 'Eevee', 'Squirtle', 'Bulbasaur', 'Rattata'];
const DEFAULT_AI = ['Machop', 'Geodude', 'Haunter', 'Golem', 'Magnemite', 'Dratini'];

const PRESET_KEY = 'duel-team-presets-v2';
const PRESET_SLOTS = 6;

type TeamPreset = {
  name: string;
  figures: string[];
  plates: number[];
};

const DEFAULT_PRESETS: TeamPreset[] = [
  {
    name: 'Starter Squad',
    figures: [...DEFAULT_PLAYER],
    plates: [...DEFAULT_PLAYER_PLATES],
  },
  {
    name: 'Stone Guard',
    figures: ['Golem', 'Geodude', 'Armaldo', 'Machop', 'Metagross', 'Magnemite'],
    plates: [12, 10, 7, 11],
  },
  {
    name: 'Swift Pack',
    figures: ['Pikachu', 'Eevee', 'Rattata', 'Aipom', 'Plusle', 'Sentret'],
    plates: [12, 10, 7, 11],
  },
  {
    name: 'Poison Fang',
    figures: ['Ekans', 'Spinarak', 'Mightyena', 'Haunter', 'Seedot', 'Bayleef'],
    plates: [12, 23, 20, 14],
  },
  {
    name: 'Dragon Rise',
    figures: ['Dratini', 'Dialga', 'Tauros', 'Charmander', 'Squirtle', 'Bulbasaur'],
    plates: [12, 10, 7, 11],
  },
  {
    name: 'Arena Rush',
    figures: ['Raticate', 'Marill', 'Snubbull', 'Tauros', 'Mightyena', 'Armaldo'],
    plates: [12, 15, 14, 91],
  },
];

function clonePreset(p: TeamPreset): TeamPreset {
  return { name: p.name, figures: [...p.figures], plates: [...p.plates] };
}

function normalizePreset(raw: unknown, fallback: TeamPreset): TeamPreset {
  if (!raw || typeof raw !== 'object') return clonePreset(fallback);
  const p = raw as Partial<TeamPreset>;
  const name =
    typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 28) : fallback.name;
  const figures = Array.isArray(p.figures)
    ? p.figures.filter((n): n is string => typeof n === 'string').slice(0, 6)
    : [...fallback.figures];
  const plates = Array.isArray(p.plates)
    ? p.plates.filter((id): id is number => typeof id === 'number').slice(0, 6)
    : [...fallback.plates];
  // Deleted / empty slots get the default preset for that slot back.
  if (figures.length === 0 && plates.length === 0) return clonePreset(fallback);
  return { name, figures, plates };
}

function loadPresets(): TeamPreset[] {
  try {
    const raw = localStorage.getItem(PRESET_KEY);
    if (!raw) return DEFAULT_PRESETS.map(clonePreset);
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_PRESETS.map(clonePreset);
    return Array.from({ length: PRESET_SLOTS }, (_, i) =>
      normalizePreset(parsed[i], DEFAULT_PRESETS[i]!),
    );
  } catch {
    return DEFAULT_PRESETS.map(clonePreset);
  }
}

function savePresets(presets: TeamPreset[]) {
  localStorage.setItem(PRESET_KEY, JSON.stringify(presets.slice(0, PRESET_SLOTS)));
}

const CURRENT_DECK_KEY = 'duel-current-deck';

function loadCurrentDeck(): { figures: string[]; plates: number[] } | null {
  try {
    const raw = localStorage.getItem(CURRENT_DECK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<{ figures: unknown; plates: unknown }>;
    const figures = Array.isArray(parsed.figures)
      ? parsed.figures.filter((n): n is string => typeof n === 'string').slice(0, 6)
      : [];
    const plates = Array.isArray(parsed.plates)
      ? parsed.plates.filter((id): id is number => typeof id === 'number').slice(0, 6)
      : [];
    if (!figures.length && !plates.length) return null;
    return { figures, plates };
  } catch {
    return null;
  }
}

function saveCurrentDeck(figures: FigureDef[], plates: number[]) {
  localStorage.setItem(
    CURRENT_DECK_KEY,
    JSON.stringify({
      figures: figures.map((f) => f.name),
      plates: [...plates],
    }),
  );
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Last started decks — used for Rematch from the report screen. */
let lastMatchDeck: {
  player: FigureDef[];
  opponent: FigureDef[];
  playerPlates: number[];
  opponentPlates: number[];
} | null = null;

let matchReportTimer: ReturnType<typeof setTimeout> | null = null;

function findByName(name: string): FigureDef | undefined {
  return figures.find((f) => f.name === name);
}

function fallbackTeam(): FigureDef[] {
  const pool = [...figures].sort(() => Math.random() - 0.5);
  return pool.slice(0, 6);
}

function resolveTeam(names: string[]): FigureDef[] {
  const team = names.map(findByName).filter(Boolean) as FigureDef[];
  while (team.length < 6) {
    const extra = figures[Math.floor(Math.random() * figures.length)];
    if (!team.some((t) => t.name === extra.name)) team.push(extra);
  }
  return team.slice(0, 6);
}

/* ---------------- UI ---------------- */

function marqueeName(text: string, extraClass = ''): string {
  return `<span class="name-marquee ${extraClass}"><span class="name-marquee-text">${text}</span></span>`;
}

/** Shared plate chip row used by bench picks + preset cards. */
function plateChipRowHtml(
  ids: number[],
  opts: { interactive?: boolean; emptyLabel?: string } = {},
): string {
  const chips = ids
    .map((id) => {
      const d = PLATE_BY_ID.get(id);
      if (!d) return '';
      const inner = `${marqueeName(escapeHtml(d.name))}<em>${d.cost}</em>`;
      if (opts.interactive) {
        return `<button type="button" class="plate-chip" data-pid="${id}" title="Remove ${escapeHtml(d.name)}">${inner}</button>`;
      }
      return `<span class="plate-chip">${inner}</span>`;
    })
    .filter(Boolean);
  if (!chips.length) {
    return `<span class="deck-empty">${opts.emptyLabel ?? 'No plates'}</span>`;
  }
  return `<div class="plate-chip-row">${chips.join('')}</div>`;
}

/** Enable CSS marquee only when the label overflows its box. */
function refreshNameMarquees(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('.name-marquee').forEach((el) => {
    const inner = el.querySelector<HTMLElement>('.name-marquee-text');
    if (!inner) return;
    // Measure unconstrained width (max-width:100% can hide real overflow).
    const prev = inner.style.maxWidth;
    inner.style.maxWidth = 'none';
    const need = inner.scrollWidth;
    inner.style.maxWidth = prev;
    const overflow = need - el.clientWidth;
    const isOverflow = overflow > 1;
    el.classList.toggle('is-overflow', isOverflow);
    el.style.setProperty('--marquee-travel', isOverflow ? `${overflow + 8}px` : '0px');
  });
}

function dismissBoot() {
  if (!document.documentElement.classList.contains('booting')) return;
  // Paint homescreen under the cover before revealing.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.documentElement.classList.remove('booting');
      document.getElementById('boot')?.remove();
    });
  });
}

function renderTeamSelect() {
  setSceneLive(false);
  const selected: FigureDef[] = [];
  const selectedPlates: number[] = [];
  const savedDeck = loadCurrentDeck();
  if (savedDeck) {
    for (const name of savedDeck.figures) {
      const def = findByName(name);
      if (def && selected.length < 6) selected.push(def);
    }
    const plates = savedDeck.plates.filter((id) => PLATE_BY_ID.has(id));
    if (isValidPlateDeck(plates)) selectedPlates.push(...plates);
    else selectedPlates.push(...DEFAULT_PLAYER_PLATES);
  } else {
    selectedPlates.push(...DEFAULT_PLAYER_PLATES);
  }

  const persistDeck = () => saveCurrentDeck(selected, selectedPlates);

  ui.innerHTML = `
    <div class="deck-screen">
      <div class="deck-atmosphere" aria-hidden="true"></div>
      <header class="deck-top">
        <div class="deck-brand">
          <p class="deck-kicker">Pokémon Duel · WebGL</p>
          <h1>Duel Field</h1>
        </div>
        <nav class="deck-tabs" role="tablist">
          <button type="button" class="deck-tab active" data-tab="figures" role="tab">Figures</button>
          <button type="button" class="deck-tab" data-tab="plates" role="tab">Plates</button>
        </nav>
      </header>

      <aside class="deck-bench" aria-label="Your team">
        <div class="deck-bench-head">
          <div class="deck-bench-label">Bench <span id="bench-count">0</span>/6</div>
          <div class="deck-bench-actions">
            <button type="button" class="deck-icon-btn" id="preset-load" aria-label="Load team" title="Load team">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h16v-2H4v2zm8-3 5-5h-3V4h-4v8H7l5 5z"/></svg>
            </button>
            <button type="button" class="deck-icon-btn" id="preset-save" aria-label="Save team" title="Save team">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-4-4zm-5 16a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm3-10H5V5h10v4z"/></svg>
            </button>
          </div>
        </div>
        <div class="bench-pads" id="picked"></div>
        <div class="deck-plate-meter">
          <div class="deck-plate-meter-top">
            <div class="deck-bench-label">Plates <span id="plate-count">0</span>/6</div>
            <div class="deck-bench-label">Cost <span id="plate-cost">0</span>/${MAX_PLATE_COST}</div>
          </div>
          <div class="deck-plate-bar deck-plate-bar-dual" aria-hidden="true">
            <i id="plate-count-bar" class="fill-plates" style="width:0%"></i>
            <i id="plate-bar" class="fill-cost" style="width:0%"></i>
          </div>
          <div class="deck-plate-picks" id="picked-plates"></div>
        </div>
      </aside>

      <main class="deck-main">
        <div id="tab-figures" class="tab-panel">
          <div class="filters">
            <input id="search" placeholder="Search figures…" autocomplete="off" />
            <div class="deck-filter" id="rarity-filter">
              <button type="button" class="deck-filter-btn" id="rarity-btn" data-rarity="" aria-haspopup="listbox" aria-expanded="false">
                All rarities
              </button>
              <div class="deck-filter-menu hidden" id="rarity-menu" role="listbox">
                <button type="button" class="deck-filter-opt" role="option" data-value="" data-rarity="">All rarities</button>
                <button type="button" class="deck-filter-opt" role="option" data-value="UX" data-rarity="UX">UX</button>
                <button type="button" class="deck-filter-opt" role="option" data-value="EX" data-rarity="EX">EX</button>
                <button type="button" class="deck-filter-opt" role="option" data-value="R" data-rarity="R">R</button>
                <button type="button" class="deck-filter-opt" role="option" data-value="UC" data-rarity="UC">UC</button>
                <button type="button" class="deck-filter-opt" role="option" data-value="C" data-rarity="C">C</button>
              </div>
              <select id="rarity" class="deck-filter-native" aria-label="Rarity" tabindex="-1">
                <option value="">All rarities</option>
                <option value="UX">UX</option>
                <option value="EX">EX</option>
                <option value="R">R</option>
                <option value="UC">UC</option>
                <option value="C">C</option>
              </select>
            </div>
            <div class="deck-filter" id="mp-filter">
              <button type="button" class="deck-filter-btn" id="mp-btn" aria-haspopup="listbox" aria-expanded="false">
                All MP
              </button>
              <div class="deck-filter-menu hidden" id="mp-menu" role="listbox">
                <button type="button" class="deck-filter-opt" role="option" data-value="" data-label="All MP">All MP</button>
                <button type="button" class="deck-filter-opt" role="option" data-value="1" data-label="1 MP">1 MP</button>
                <button type="button" class="deck-filter-opt" role="option" data-value="2" data-label="2 MP">2 MP</button>
                <button type="button" class="deck-filter-opt" role="option" data-value="3" data-label="3 MP">3 MP</button>
              </div>
              <select id="mp" class="deck-filter-native" aria-label="MP" tabindex="-1">
                <option value="">All MP</option>
                <option value="1">1 MP</option>
                <option value="2">2 MP</option>
                <option value="3">3 MP</option>
              </select>
            </div>
          </div>
          <div class="team-grid" id="grid"></div>
        </div>
        <div id="tab-plates" class="tab-panel hidden">
          <p class="deck-plate-hint">Use at the start of your turn. Up to 6 plates · total cost ≤ ${MAX_PLATE_COST}.</p>
          <div class="team-grid" id="plate-grid"></div>
        </div>
      </main>

      <footer class="deck-foot">
        <p class="disclaimer">Fan recreation for personal / educational use. Pokémon is © Nintendo / Creatures / GAME FREAK.</p>
        <button class="btn deck-start" id="start" disabled>Start duel</button>
      </footer>
    </div>
  `;

  const grid = ui.querySelector('#grid')!;
  const picked = ui.querySelector('#picked')!;
  const plateGrid = ui.querySelector('#plate-grid')!;
  const pickedPlates = ui.querySelector('#picked-plates')!;
  const plateCostEl = ui.querySelector('#plate-cost')!;
  const plateCountEl = ui.querySelector('#plate-count')!;
  const plateBar = ui.querySelector('#plate-bar') as HTMLElement;
  const plateCountBar = ui.querySelector('#plate-count-bar') as HTMLElement;
  const benchCount = ui.querySelector('#bench-count')!;
  const start = ui.querySelector('#start') as HTMLButtonElement;

  ui.querySelectorAll('.deck-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = (btn as HTMLElement).dataset.tab;
      ui.querySelectorAll('.deck-tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      ui.querySelector('#tab-figures')!.classList.toggle('hidden', tab !== 'figures');
      ui.querySelector('#tab-plates')!.classList.toggle('hidden', tab !== 'plates');
      playUiTap();
    });
  });

  const paintPlates = () => {
    const cost = plateCost(selectedPlates);
    const count = selectedPlates.length;
    plateCostEl.textContent = String(cost);
    plateCostEl.classList.toggle('over', cost > MAX_PLATE_COST);
    plateCountEl.textContent = String(count);
    plateCountEl.classList.toggle('over', count > 6);
    plateCountEl.classList.toggle('full', count >= 6);
    const countPct = Math.min(100, (count / 6) * 100);
    const costPct = Math.min(100, (cost / MAX_PLATE_COST) * 100);
    plateBar.style.width = `${costPct}%`;
    plateBar.classList.toggle('over', cost > MAX_PLATE_COST);
    plateCountBar.style.width = `${countPct}%`;
    plateCountBar.classList.toggle('full', count >= 6);
    plateCountBar.classList.toggle('over', count > 6);
    // Longer fill sits behind so both colors read; track extends to the max.
    const platesLonger = countPct >= costPct;
    plateCountBar.style.zIndex = platesLonger ? '1' : '2';
    plateBar.style.zIndex = platesLonger ? '2' : '1';
    pickedPlates.innerHTML = plateChipRowHtml(selectedPlates, {
      interactive: true,
      emptyLabel: 'No plates yet',
    });
    const plateScroll = plateGrid.scrollTop;
    plateGrid.innerHTML = PLATES.map((p) => {
      const onCount = selectedPlates.filter((id) => id === p.id).length;
      const wouldExceed = cost + p.cost > MAX_PLATE_COST && onCount === 0;
      const full = selectedPlates.length >= 6;
        return `<button class="fig-card plate-card ${onCount ? 'selected' : ''}" data-plate="${p.id}" ${
        wouldExceed || (full && !onCount) ? 'disabled' : ''
      }>
        <div class="fig-card-top">
          ${marqueeName(p.name)}
          <span class="rarity ${p.rarity}">${p.rarity}</span>
        </div>
        <div class="meta">Cost ${p.cost}${onCount ? ` · ×${onCount}` : ''}</div>
        <div class="meta dim plate-desc">${escapeHtml(p.description)}</div>
      </button>`;
    }).join('');
    plateGrid.scrollTop = plateScroll;
    paintStart();
    requestAnimationFrame(() => {
      plateGrid.scrollTop = plateScroll;
      refreshNameMarquees(plateGrid);
      refreshNameMarquees(pickedPlates);
    });
  };

  const paintStart = () => {
    const ok = selected.length === 6 && isValidPlateDeck(selectedPlates);
    start.disabled = !ok;
    start.textContent = ok
      ? 'Start duel'
      : `Need ${6 - selected.length} figure${6 - selected.length === 1 ? '' : 's'}`;
    if (ok) start.textContent = `Start duel · ${plateCost(selectedPlates)}/${MAX_PLATE_COST} plates`;
    syncPresetActionButtons();
  };

  const syncPresetActionButtons = () => {
    const loadBtn = ui.querySelector('#preset-load') as HTMLButtonElement | null;
    const saveBtn = ui.querySelector('#preset-save') as HTMLButtonElement | null;
    if (!loadBtn || !saveBtn) return;
    const hasSaved = loadPresets().some((p) => p.figures.length > 0);
    loadBtn.disabled = !hasSaved;
    const fullDeck =
      selected.length === 6 &&
      plateCost(selectedPlates) === MAX_PLATE_COST &&
      isValidPlateDeck(selectedPlates);
    saveBtn.disabled = !fullDeck;
    saveBtn.title = fullDeck
      ? 'Save team'
      : `Need 6 figures and ${MAX_PLATE_COST}/${MAX_PLATE_COST} plate cost`;
  };

  const paint = () => {
    const q = (ui.querySelector('#search') as HTMLInputElement).value.toLowerCase();
    const rarity = (ui.querySelector('#rarity') as HTMLSelectElement).value;
    const mp = (ui.querySelector('#mp') as HTMLSelectElement).value;
    const list = figures.filter((f) => {
      if (q && !f.name.toLowerCase().includes(q)) return false;
      if (rarity && f.rarity !== rarity) return false;
      if (mp && String(f.mp) !== mp) return false;
      return true;
    });
    const gridScroll = grid.scrollTop;
    grid.innerHTML = list
      .slice(0, 120)
      .map((f) => {
        const on = selected.some((s) => s.name === f.name);
        const art = pokemonArtUrl(f.name);
        return `<button class="fig-card ${on ? 'selected' : ''}" data-name="${f.name}">
          <div class="fig-card-art" data-rarity="${f.rarity}">
            ${
              art
                ? `<img src="${art}" alt="" loading="lazy" decoding="async" />`
                : `<span class="fig-card-art-fallback">${f.name.slice(0, 2)}</span>`
            }
          </div>
          <div class="fig-card-top">
            ${marqueeName(f.name)}
            <span class="rarity ${f.rarity}">${f.rarity}</span>
          </div>
          <div class="fig-badges">
            <span class="stat-badge">MP ${f.mp}</span>
            <span class="stat-badge">${f.wheel.length} seg</span>
            ${f.ability ? `<span class="stat-badge">Abil.</span>` : ''}
          </div>
        </button>`;
      })
      .join('');
    grid.scrollTop = gridScroll;

    benchCount.textContent = String(selected.length);
    const pads = Array.from({ length: 6 }, (_, i) => {
      const s = selected[i];
      if (!s) {
        return `<div class="bench-slot empty" data-slot="${i}" aria-label="Empty slot ${i + 1}">
          <div class="fig-card-art"><span class="fig-card-art-fallback">${i + 1}</span></div>
          <div class="fig-card-top">${marqueeName('Empty', 'muted')}</div>
          <div class="fig-badges"><span class="stat-badge">Slot ${i + 1}</span></div>
        </div>`;
      }
      const art = pokemonArtUrl(s.name);
      return `<button type="button" class="bench-slot filled fig-card selected" data-name="${s.name}" aria-label="Remove ${s.name}">
        <div class="fig-card-art" data-rarity="${s.rarity}">
          ${
            art
              ? `<img src="${art}" alt="" loading="lazy" decoding="async" />`
              : `<span class="fig-card-art-fallback">${s.name.slice(0, 2)}</span>`
          }
        </div>
        <div class="fig-card-top">
          ${marqueeName(s.name)}
          <span class="rarity ${s.rarity}">${s.rarity}</span>
        </div>
        <div class="fig-badges">
          <span class="stat-badge">MP ${s.mp}</span>
          <span class="stat-badge">${s.wheel.length} seg</span>
        </div>
      </button>`;
    }).join('');
    picked.innerHTML = pads;
    paintStart();
    requestAnimationFrame(() => {
      grid.scrollTop = gridScroll;
      refreshNameMarquees(grid);
      refreshNameMarquees(picked);
    });
  };

  paint();
  paintPlates();
  ui.querySelector('#search')!.addEventListener('input', paint);
  const raritySelect = ui.querySelector('#rarity') as HTMLSelectElement;
  const rarityBtn = ui.querySelector('#rarity-btn') as HTMLButtonElement;
  const rarityMenu = ui.querySelector('#rarity-menu') as HTMLElement;
  const rarityFilter = ui.querySelector('#rarity-filter') as HTMLElement;
  const mpSelect = ui.querySelector('#mp') as HTMLSelectElement;
  const mpBtn = ui.querySelector('#mp-btn') as HTMLButtonElement;
  const mpMenu = ui.querySelector('#mp-menu') as HTMLElement;
  const mpFilter = ui.querySelector('#mp-filter') as HTMLElement;

  const closeDeckFilter = (btn: HTMLButtonElement, menu: HTMLElement) => {
    menu.classList.add('hidden');
    btn.setAttribute('aria-expanded', 'false');
  };

  const setRarityFilter = (value: string) => {
    raritySelect.value = value;
    const label = value || 'All rarities';
    rarityBtn.dataset.rarity = value;
    rarityBtn.textContent = label;
    rarityMenu.querySelectorAll('.deck-filter-opt').forEach((opt) => {
      const el = opt as HTMLElement;
      el.classList.toggle('is-active', el.dataset.value === value);
    });
    closeDeckFilter(rarityBtn, rarityMenu);
    paint();
  };

  const setMpFilter = (value: string, label: string) => {
    mpSelect.value = value;
    mpBtn.textContent = label;
    mpMenu.querySelectorAll('.deck-filter-opt').forEach((opt) => {
      const el = opt as HTMLElement;
      el.classList.toggle('is-active', el.dataset.value === value);
    });
    closeDeckFilter(mpBtn, mpMenu);
    paint();
  };

  rarityBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeDeckFilter(mpBtn, mpMenu);
    const open = rarityMenu.classList.toggle('hidden') === false;
    rarityBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    playUiTap();
  });
  rarityMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    const opt = (e.target as HTMLElement).closest('.deck-filter-opt') as HTMLElement | null;
    if (!opt) return;
    playUiTap();
    setRarityFilter(opt.dataset.value ?? '');
  });

  mpBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeDeckFilter(rarityBtn, rarityMenu);
    const open = mpMenu.classList.toggle('hidden') === false;
    mpBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    playUiTap();
  });
  mpMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    const opt = (e.target as HTMLElement).closest('.deck-filter-opt') as HTMLElement | null;
    if (!opt) return;
    playUiTap();
    setMpFilter(opt.dataset.value ?? '', opt.dataset.label ?? opt.textContent ?? 'All MP');
  });

  ui.addEventListener('click', (e) => {
    const t = e.target as Node;
    if (!rarityFilter.contains(t)) closeDeckFilter(rarityBtn, rarityMenu);
    if (!mpFilter.contains(t)) closeDeckFilter(mpBtn, mpMenu);
  });
  rarityMenu.querySelector('.deck-filter-opt[data-value=""]')?.classList.add('is-active');
  mpMenu.querySelector('.deck-filter-opt[data-value=""]')?.classList.add('is-active');

  const openPresetScreen = (mode: 'load' | 'save') => {
    playUiTap();
    let presets = loadPresets();
    const canSave =
      selected.length === 6 &&
      plateCost(selectedPlates) === MAX_PLATE_COST &&
      isValidPlateDeck(selectedPlates);
    if (mode === 'save' && !canSave) return;
    if (mode === 'load' && !presets.some((p) => p.figures.length > 0)) return;

    const title = mode === 'load' ? 'Load team' : 'Save team';
    const sub =
      mode === 'load'
        ? 'Choose a preset for your bench, or delete a slot.'
        : 'Pick a slot to store your current bench and plates.';

    const plateChipsHtml = (ids: number[]) => plateChipRowHtml(ids);

    const figureSlotsHtml = (figs: FigureDef[]) =>
      Array.from({ length: 6 }, (_, j) => {
        const fig = figs[j];
        if (!fig) return `<div class="preset-mini empty"></div>`;
        const url = pokemonArtUrl(fig.name);
        return `<div class="preset-mini">${
          url
            ? `<img src="${url}" alt="" loading="lazy" decoding="async" />`
            : `<span>${fig.name.slice(0, 2)}</span>`
        }</div>`;
      }).join('');

    const trashIcon =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';

    const overlay = document.createElement('div');
    overlay.className = 'preset-screen';
    overlay.id = 'preset-screen';
    overlay.innerHTML = `
      <div class="preset-sheet">
        <header class="preset-top">
          <div>
            <p class="preset-kicker">Team presets</p>
            <h2>${title}</h2>
            <p class="preset-sub">${sub}</p>
          </div>
          <button type="button" class="settings-close" id="preset-back" aria-label="Close">✕</button>
        </header>
        <div class="preset-grid" id="preset-grid"></div>
      </div>
    `;

    const gridEl = overlay.querySelector('#preset-grid')!;

    const sameDeck = (p: TeamPreset) => {
      const names = selected.map((f) => f.name);
      if (p.figures.length !== names.length) return false;
      if (p.plates.length !== selectedPlates.length) return false;
      if (!p.figures.every((n, idx) => n === names[idx])) return false;
      return p.plates.every((id, idx) => id === selectedPlates[idx]);
    };

    const renderGrid = () => {
      gridEl.innerHTML = presets
        .map((p, i) => {
          const figs = p.figures.map(findByName).filter(Boolean) as FigureDef[];
          // Repair orphaned plate-only slots (figures gone / unresolved).
          if (figs.length === 0 && p.figures.length > 0) {
            p.figures = [];
          }
          const hasTeam = figs.length > 0;
          const hasPlates = p.plates.length > 0;
          const empty = !hasTeam && !hasPlates;
          const loaded = !empty && sameDeck(p);
          const cost = plateCost(p.plates);
          const slots = figureSlotsHtml(figs);
          const plates = plateChipsHtml(p.plates);
          const meta = !hasTeam
            ? hasPlates
              ? `No figures · plates ${cost}/${MAX_PLATE_COST}`
              : 'Empty slot'
            : `${figs.length}/6 · plates ${cost}/${MAX_PLATE_COST}`;

          if (mode === 'load') {
            return `
              <article class="preset-card preset-card-load ${empty ? 'is-empty' : ''} ${
                loaded ? 'is-loaded' : ''
              }" ${loaded ? 'aria-current="true"' : ''}>
                <div class="preset-card-head">
                  <div class="preset-card-title">
                    <span>Slot ${i + 1}</span>
                    <input
                      type="text"
                      class="preset-title-input"
                      data-rename-slot="${i}"
                      maxlength="28"
                      value="${escapeHtml(p.name)}"
                      aria-label="Preset name"
                    />
                  </div>
                  <button type="button" class="preset-icon-btn danger" data-delete="${i}" ${
                    empty ? 'disabled' : ''
                  } aria-label="Clear ${escapeHtml(p.name)}" title="Clear slot">
                    ${trashIcon}
                  </button>
                </div>
                <div class="preset-minis">${slots}</div>
                ${plates}
                <div class="preset-card-foot">
                  <span class="preset-meta">${meta}</span>
                  ${
                    loaded
                      ? `<span class="preset-loaded-badge">On bench</span>`
                      : `<button type="button" class="btn preset-load-btn" data-load="${i}" ${
                          hasTeam ? '' : 'disabled'
                        }>Load</button>`
                  }
                </div>
              </article>
            `;
          }

          return `
            <div class="preset-card preset-card-save">
              <label class="preset-name-label">
                <span>Slot ${i + 1}</span>
                <input type="text" class="preset-name-input" data-name-slot="${i}" maxlength="28" value="${escapeHtml(p.name)}" />
              </label>
              <div class="preset-minis" aria-hidden="true">${slots}</div>
              ${plates}
              <div class="preset-meta">${meta}</div>
              <button type="button" class="btn" data-save="${i}" ${canSave ? '' : 'disabled'}>
                ${empty ? 'Save here' : 'Overwrite'}
              </button>
            </div>
          `;
        })
        .join('');
      requestAnimationFrame(() => refreshNameMarquees(gridEl));
    };

    renderGrid();

    const close = () => {
      overlay.remove();
      syncPresetActionButtons();
    };

    overlay.querySelector('#preset-back')!.addEventListener('click', () => {
      playUiTap();
      close();
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        playUiTap();
        close();
      }
    });

    if (mode === 'load') {
      const commitRename = (input: HTMLInputElement) => {
        const idx = Number(input.dataset.renameSlot);
        if (!Number.isFinite(idx) || !presets[idx]) return;
        const name = (input.value.trim() || `Team ${idx + 1}`).slice(0, 28);
        input.value = name;
        if (presets[idx]!.name === name) return;
        presets[idx] = { ...presets[idx]!, name };
        savePresets(presets);
        const del = gridEl.querySelector(
          `button[data-delete="${idx}"]`,
        ) as HTMLButtonElement | null;
        if (del) {
          del.setAttribute('aria-label', `Delete ${name}`);
          del.title = 'Delete';
        }
      };

      gridEl.addEventListener('change', (e) => {
        const input = (e.target as HTMLElement).closest(
          'input[data-rename-slot]',
        ) as HTMLInputElement | null;
        if (input) commitRename(input);
      });
      gridEl.addEventListener('keydown', (e) => {
        const ke = e as KeyboardEvent;
        const input = (e.target as HTMLElement).closest(
          'input[data-rename-slot]',
        ) as HTMLInputElement | null;
        if (!input || ke.key !== 'Enter') return;
        ke.preventDefault();
        input.blur();
      });
      gridEl.addEventListener('blur', (e) => {
        const input = (e.target as HTMLElement).closest(
          'input[data-rename-slot]',
        ) as HTMLInputElement | null;
        if (input) commitRename(input);
      }, true);

      gridEl.addEventListener('click', (e) => {
        const del = (e.target as HTMLElement).closest(
          'button[data-delete]',
        ) as HTMLButtonElement | null;
        if (del && !del.disabled) {
          const idx = Number(del.dataset.delete);
          const nameInput = gridEl.querySelector(
            `input[data-rename-slot="${idx}"]`,
          ) as HTMLInputElement | null;
          const keepName =
            nameInput?.value.trim() || presets[idx]?.name?.trim() || `Team ${idx + 1}`;
          presets[idx] = { name: keepName, figures: [], plates: [] };
          savePresets(presets);
          playUiTap();
          renderGrid();
          syncPresetActionButtons();
          if (!presets.some((p) => p.figures.length > 0)) close();
          return;
        }

        const btn = (e.target as HTMLElement).closest(
          'button[data-load]',
        ) as HTMLButtonElement | null;
        if (!btn || btn.disabled) return;
        const idx = Number(btn.dataset.load);
        const preset = presets[idx];
        if (!preset || !preset.figures.length) return;
        selected.length = 0;
        for (const name of preset.figures) {
          const def = findByName(name);
          if (def && selected.length < 6) selected.push(def);
        }
        selectedPlates.length = 0;
        const plates = preset.plates.filter((id) => PLATE_BY_ID.has(id));
        if (isValidPlateDeck(plates)) selectedPlates.push(...plates);
        else selectedPlates.push(...DEFAULT_PLAYER_PLATES);
        playSelect();
        persistDeck();
        paint();
        paintPlates();
        close();
      });
    } else {
      gridEl.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest(
          'button[data-save]',
        ) as HTMLButtonElement | null;
        if (!btn || btn.disabled) return;
        const idx = Number(btn.dataset.save);
        const nameInput = overlay.querySelector(
          `input[data-name-slot="${idx}"]`,
        ) as HTMLInputElement | null;
        const name = (nameInput?.value.trim() || `Team ${idx + 1}`).slice(0, 28);
        presets[idx] = {
          name,
          figures: selected.map((f) => f.name),
          plates: [...selectedPlates],
        };
        savePresets(presets);
        playSelect();
        close();
      });
    }

    ui.querySelector('.deck-screen')!.appendChild(overlay);
  };

  ui.querySelector('#preset-load')!.addEventListener('click', () => openPresetScreen('load'));
  ui.querySelector('#preset-save')!.addEventListener('click', () => openPresetScreen('save'));
  syncPresetActionButtons();

  grid.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button[data-name]') as HTMLButtonElement | null;
    if (!btn) return;
    const def = findByName(btn.dataset.name!)!;
    const idx = selected.findIndex((s) => s.name === def.name);
    if (idx >= 0) selected.splice(idx, 1);
    else if (selected.length < 6) selected.push(def);
    playSelect();
    persistDeck();
    paint();
  });
  picked.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button.bench-slot.filled') as HTMLButtonElement | null;
    if (!btn?.dataset.name) return;
    const idx = selected.findIndex((s) => s.name === btn.dataset.name);
    if (idx >= 0) selected.splice(idx, 1);
    playSelect();
    persistDeck();
    paint();
  });
  plateGrid.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button[data-plate]') as HTMLButtonElement | null;
    if (!btn || btn.disabled) return;
    const id = Number(btn.dataset.plate);
    const idx = selectedPlates.indexOf(id);
    if (idx >= 0) selectedPlates.splice(idx, 1);
    else if (
      selectedPlates.length < 6 &&
      plateCost(selectedPlates) + (PLATE_BY_ID.get(id)?.cost ?? 0) <= MAX_PLATE_COST
    ) {
      selectedPlates.push(id);
    }
    playPlateUse();
    persistDeck();
    paintPlates();
  });
  pickedPlates.addEventListener('click', (e) => {
    const chip = (e.target as HTMLElement).closest('[data-pid]') as HTMLElement | null;
    if (!chip) return;
    const id = Number(chip.dataset.pid);
    const idx = selectedPlates.indexOf(id);
    if (idx >= 0) selectedPlates.splice(idx, 1);
    playSelect();
    persistDeck();
    paintPlates();
  });
  start.addEventListener('click', () => {
    const ai = resolveTeam(DEFAULT_AI.filter((n) => !selected.some((s) => s.name === n)));
    const opp = ai.length === 6 ? ai : fallbackTeam();
    beginMatch(selected, opp, selectedPlates, DEFAULT_AI_PLATES);
  });

  addEventListener('resize', () => {
    refreshNameMarquees(ui);
  });

  dismissBoot();
}

function beginMatch(
  player: FigureDef[],
  opponent: FigureDef[],
  playerPlates: number[],
  opponentPlates: number[],
) {
  lastMatchDeck = {
    player: [...player],
    opponent: [...opponent],
    playerPlates: [...playerPlates],
    opponentPlates: [...opponentPlates],
  };
  if (matchReportTimer) {
    clearTimeout(matchReportTimer);
    matchReportTimer = null;
  }
  engine.startMatch(player, opponent, playerPlates, opponentPlates);
  playMatchStart();
  if (isBgmWanted() && !isMusicMuted()) void startBgm();
  setSceneLive(true);
  renderHud();
  void boardView.playBenchDropIntro({ onLand: () => playLand() }).then(() => {
    maybeAiTurn();
  });
}

function resetCameraHome() {
  const saved = readCameraPrefs();
  if (saved) {
    applyCameraPrefs(saved);
    return;
  }
  camera.fov = CAM_DEFAULT_FOV;
  camera.position.copy(CAM_DEFAULT_POS);
  controls.target.copy(CAM_DEFAULT_TARGET);
  camera.updateProjectionMatrix();
  applyCameraLock();
  controls.update();
  syncCameraResetBtn();
}

function collectHudActions(): { id: HudActionId; label: string }[] {
  const s = engine.state;
  const actions: { id: HudActionId; label: string }[] = [];
  if (s.phase === 'playing' && s.turn === 'player') {
    if (s.pendingPlateInstanceId) {
      actions.push({ id: 'resign', label: 'Cancel Plate' });
    }
    const selected = s.selectedUid ? engine.piece(s.selectedUid) : null;
    if (selected && selected.owner === 'player' && !s.pendingPlateInstanceId) {
      if (s.turnStep === 'choose') {
        for (const h of engine.adjacentAlliesNeedingHeal(selected.uid)) {
          actions.push({ id: `heal:${h.uid}`, label: `Cure ${h.name}` });
        }
      }
    }
    if (s.turnStep === 'post-move') {
      actions.push({ id: 'end-turn', label: 'End Turn' });
    }
  }
  return actions;
}

function renderHud() {
  const s = engine.state;
  syncTurnTimer();

  // Don't wipe the report (or the short wait before it).
  if (document.getElementById('match-report') || matchReportTimer) return;

  if (s.phase === 'game-over' && !goalCinematic) {
    ui.innerHTML = '';
    scheduleMatchReport();
    return;
  }

  const youActive = s.turn === 'player';
  const oppActive = s.turn === 'opponent';
  const actions = collectHudActions();
  const endTurn = actions.find((a) => a.id === 'end-turn');
  const otherActions = actions.filter((a) => a.id !== 'end-turn');
  const endTurnHtml = endTurn
    ? `<button type="button" class="end-turn-btn" data-hud-action="end-turn" title="End turn" aria-label="End turn">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <polygon points="5 4 15 12 5 20"/>
          <rect x="17" y="5" width="3" height="14" rx="0.5"/>
        </svg>
      </button>`
    : '';
  const otherBar = otherActions.length
    ? `<div class="action-bar">${otherActions
        .map(
          (a) =>
            `<button type="button" class="hud-action${
              a.id.startsWith('battle') ? ' hot' : ''
            }" data-hud-action="${a.id}">${a.label}</button>`,
        )
        .join('')}</div>`
    : '';
  const actionsRoot =
    otherActions.length || endTurn
      ? `<div id="match-actions">${otherBar}${endTurnHtml}</div>`
      : '';
  const pending = plateTargetHintHtml();
  const showHeader = s.phase === 'playing' || s.phase === 'battle' || s.phase === 'game-over';

  ui.innerHTML = `
    ${
      showHeader
        ? `<div class="match-header" id="match-header">
      <div class="player-chip you${youActive ? ' active' : ''}">
        <div class="avatar" aria-hidden="true">Y</div>
        <div class="meta">
          <div class="name">You</div>
          <div class="sub">${youActive ? 'Acting' : 'Waiting'}</div>
        </div>
      </div>
      <div class="timer" id="match-timer-chip">—</div>
      <div class="player-chip opp${oppActive ? ' active' : ''}">
        <div class="meta">
          <div class="name">Rival</div>
          <div class="sub">${oppActive ? 'Acting' : 'Waiting'}</div>
        </div>
        <div class="avatar" aria-hidden="true">R</div>
      </div>
    </div>`
        : ''
    }
    ${pending}
    ${actionsRoot}
  `;

  syncSettingsLog();
  syncTurnTimer();

  ui.querySelector('#match-actions')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-hud-action]') as HTMLElement | null;
    if (!btn) return;
    const id = btn.dataset.hudAction as HudActionId;
    playUiTap();
    void handleHudAction(id);
  });
}

function scheduleMatchReport(delayMs = 2200) {
  if (document.getElementById('match-report')) return;
  if (matchReportTimer) return;

  const s = engine.state;
  // Goal wins already played sting in the cinematic
  if (!s.winReason?.includes('captured the goal')) {
    pauseBgmSoft();
    if (s.winner === 'player') playVictory();
    else if (s.winner === 'opponent') playDefeat();
  }

  matchReportTimer = setTimeout(() => {
    matchReportTimer = null;
    showMatchReport();
  }, delayMs);
}

function showMatchReport() {
  if (document.getElementById('match-report')) return;
  const s = engine.state;
  const outcome =
    s.winner === 'player' ? 'victory' : s.winner === 'opponent' ? 'defeat' : 'draw';
  const headline =
    outcome === 'victory' ? 'Victory' : outcome === 'defeat' ? 'Defeat' : 'Draw';
  const sub =
    s.winReason ||
    (outcome === 'victory'
      ? 'You won the duel.'
      : outcome === 'defeat'
        ? 'Your rival won the duel.'
        : 'The duel ended evenly.');

  const yours = engine.activePieces('player');
  const theirs = engine.activePieces('opponent');
  const onField = (side: 'player' | 'opponent') =>
    engine.activePieces(side).filter((p) => p.location === 'field').length;
  const inPc = (side: 'player' | 'opponent') =>
    engine.activePieces(side).filter((p) => p.location === 'pc').length;
  const platesUsed = (side: 'player' | 'opponent') => {
    const list = side === 'player' ? s.playerPlates : s.opponentPlates;
    return `${list.filter((p) => p.used).length}/${list.length}`;
  };

  ui.innerHTML = `
    <div class="match-report" id="match-report" data-outcome="${outcome}">
      <div class="match-report-card">
        <p class="match-report-kicker">Match report</p>
        <h2 class="match-report-title">${headline}</h2>
        <p class="match-report-sub">${sub}</p>
        <div class="match-report-stats">
          <div class="match-stat"><span>Turns</span><strong>${s.turnNumber}</strong></div>
          <div class="match-stat"><span>Your field</span><strong>${onField('player')}</strong></div>
          <div class="match-stat"><span>Rival field</span><strong>${onField('opponent')}</strong></div>
          <div class="match-stat"><span>Your PC</span><strong>${inPc('player')}</strong></div>
          <div class="match-stat"><span>Rival PC</span><strong>${inPc('opponent')}</strong></div>
          <div class="match-stat"><span>Plates used</span><strong>${platesUsed('player')}</strong></div>
        </div>
        <div class="match-report-teams">
          <div>
            <h3>You</h3>
            <ul>${yours.map((p) => `<li>${p.name} <em>${p.location}</em></li>`).join('')}</ul>
          </div>
          <div>
            <h3>Rival</h3>
            <ul>${theirs.map((p) => `<li>${p.name} <em>${p.location}</em></li>`).join('')}</ul>
          </div>
        </div>
        <div class="match-report-actions">
          <button type="button" class="btn secondary" id="report-home">Return home</button>
          <button type="button" class="btn" id="report-rematch">Rematch</button>
        </div>
      </div>
    </div>
  `;

  ui.querySelector('#report-home')!.addEventListener('click', () => {
    playUiTap();
    resetCameraHome();
    renderTeamSelect();
  });

  ui.querySelector('#report-rematch')!.addEventListener('click', () => {
    playUiTap();
    resetCameraHome();
    if (lastMatchDeck) {
      beginMatch(
        lastMatchDeck.player,
        lastMatchDeck.opponent,
        lastMatchDeck.playerPlates,
        lastMatchDeck.opponentPlates,
      );
    } else {
      renderTeamSelect();
    }
  });
}

async function runBattlePresentation() {
  if (!engine.state.battle || battleBusy) return;
  battleBusy = true;
  const b = engine.state.battle;
  const atk = engine.piece(b.attackerUid)!;
  const def = engine.piece(b.defenderUid)!;

  // Brief face-off on the board before the spinner overlay
  await boardView.animateBattleIntro(atk.uid, def.uid);
  await new Promise((r) => setTimeout(r, 80));

  const atkStart = boardView.pieceWorldPos(atk.uid);
  const defStart = boardView.pieceWorldPos(def.uid);

  // Portrait duel: rival wheel on top, yours on bottom
  const topPiece =
    atk.owner === 'opponent' ? atk : def.owner === 'opponent' ? def : def;
  const botPiece = topPiece.uid === atk.uid ? def : atk;
  const topIsAtk = topPiece.uid === atk.uid;

  const overlay = document.createElement('div');
  overlay.className = 'overlay battle-overlay';
  overlay.innerHTML = `
    <div class="battle-stage">
      <div class="wheel-slot top" id="slot-top">
        <div class="spin" id="w-top"></div>
      </div>
      <div class="wheel-slot bottom" id="slot-bot">
        <div class="spin" id="w-bot"></div>
      </div>
      <div class="clash" aria-hidden="true">
        <div class="diamond"></div>
      </div>
    </div>
  `;
  ui.appendChild(overlay);

  // Phone-column wheel size (matches HUD / portrait frame)
  const phoneW = Math.min(430, innerWidth);
  const renderSize = Math.min(860, Math.ceil(phoneW * 2));
  const topBuff = engine.buffFor(topPiece.uid);
  const botBuff = engine.buffFor(botPiece.uid);
  const topWheel = applyTurnBuffToWheel(topPiece.wheel, topBuff);
  const botWheel = applyTurnBuffToWheel(botPiece.wheel, botBuff);
  const topBonus = topBuff?.damageBonus ?? 0;
  const botBonus = botBuff?.damageBonus ?? 0;

  // Start at base power; X Attack boost anim runs before spin.
  const cTop = createWheelCanvas(topWheel, renderSize, { damageBonus: 0 });
  const cBot = createWheelCanvas(botWheel, renderSize, { damageBonus: 0 });
  const wTop = overlay.querySelector('#w-top') as HTMLElement;
  const wBot = overlay.querySelector('#w-bot') as HTMLElement;
  wTop.appendChild(cTop);
  wBot.appendChild(cBot);

  const result = engine.resolveCurrentBattle()!;
  const topSpin = topIsAtk ? result.attackerSpin : result.defenderSpin;
  const botSpin = topIsAtk ? result.defenderSpin : result.attackerSpin;

  // Keep KO'd figure on the field until after the spin UI (then hop to PC).
  let pcHopStart: THREE.Vector3 | null = null;
  if (result.sentToPcUid) {
    pcHopStart =
      (result.sentToPcUid === atk.uid ? atkStart : defStart) ??
      boardView.pieceWorldPos(result.sentToPcUid);
    if (pcHopStart) boardView.pinPiece(result.sentToPcUid, pcHopStart);
  }

  // If PC was full, hold queue occupants until dequeue/shift anims run.
  const pcEjects = engine.takeLastPcEjects();
  const pcShifts = engine.takeLastPcShifts();
  for (const e of pcEjects) {
    boardView.pinPiece(e.uid, boardView.pcWorldSlot(e.owner, e.fromSlot));
  }
  for (const sh of pcShifts) {
    boardView.pinPiece(sh.uid, boardView.pcWorldSlot(sh.owner, sh.fromSlot));
  }

  // X Attack: count disc damage up (~1s), then spin.
  if (topBonus > 0 || botBonus > 0) {
    playSelect();
    await Promise.all([
      animateWheelDamageBoost(cTop, topWheel, renderSize, topBonus, 1000),
      animateWheelDamageBoost(cBot, botWheel, renderSize, botBonus, 1000),
    ]);
    await new Promise((r) => setTimeout(r, 120));
  }

  const spinMs = 2700;
  playWheelSpin(spinMs / 1000);
  // Pointer toward center diamond (top-right wheel → SW, bottom-left → NE)
  await Promise.all([
    animateWheelSpin(wTop, topWheel, topSpin, 225, spinMs),
    animateWheelSpin(wBot, botWheel, botSpin, 45, spinMs),
  ]);

  if (result.playerResult === 'win') playSpinWin();
  else if (result.playerResult === 'lose') playSpinLose();
  else playSpinDraw();

  await new Promise((r) => setTimeout(r, 1000));

  overlay.remove();

  moveBusy = true;
  // Queue: front leaves → remaining slides up → KO enqueues at back
  if (pcEjects.length) {
    await animatePcEjectsToBench(pcEjects);
  }
  if (pcShifts.length) {
    await animatePcShifts(pcShifts);
  }
  if (result.sentToPcUid && pcHopStart) {
    boardView.clearPin(result.sentToPcUid);
    const dest = boardView.pcWorldForPiece(result.sentToPcUid);
    if (dest) {
      await animatePieceMove(
        result.sentToPcUid,
        buildWorldHopWaypoints(pcHopStart, dest),
        { hopMs: 420, hopHeight: 1.15 },
      );
    }
  }
  moveBusy = false;

  engine.finishBattleAndContinue();
  const postBattleSurrounds = engine.takeLastSurrounds();
  const postBattleEjects = engine.takeLastPcEjects();
  const postBattleShifts = engine.takeLastPcShifts();
  for (const e of postBattleEjects) {
    boardView.pinPiece(e.uid, boardView.pcWorldSlot(e.owner, e.fromSlot));
  }
  for (const sh of postBattleShifts) {
    boardView.pinPiece(sh.uid, boardView.pcWorldSlot(sh.owner, sh.fromSlot));
  }
  for (const s of postBattleSurrounds) {
    const node = engine.board.nodes.get(s.fromNodeId);
    if (!node) continue;
    const w = boardView.world(node);
    w.y = BOARD_TOP;
    boardView.pinPiece(s.uid, w);
  }
  if (postBattleSurrounds.length || postBattleEjects.length) {
    moveBusy = true;
    await animateSurroundsToPc(postBattleSurrounds, postBattleEjects, postBattleShifts);
    moveBusy = false;
  }

  battleBusy = false;
  if (!engine.state.winner) playTurnChange();
  syncView();
  renderHud();
  maybeAiTurn();
}

async function handleHudAction(id: HudActionId) {
  if (id === 'resign' && engine.state.pendingPlateInstanceId) {
    engine.cancelPendingPlate();
    playUiTap();
    renderHud();
    syncView();
    return;
  }
  if (id === 'end-turn') {
    if (engine.endTurnManually()) {
      matchNet.commit({ seq: engine.state.actionSeq, type: 'end-turn' });
      playTurnChange();
      syncView();
      renderHud();
      maybeAiTurn();
    }
    return;
  }
  if (id.startsWith('battle:')) {
    const enemyUid = id.slice(7);
    if (engine.state.selectedUid && engine.tryBattleAdjacent(enemyUid)) {
      matchNet.commit({
        seq: engine.state.actionSeq,
        type: 'battle',
        uid: engine.state.battle!.attackerUid,
        enemyUid,
      });
      playBattleStart();
      syncView();
      await runBattlePresentation();
    }
    return;
  }
  if (id.startsWith('heal:')) {
    const targetUid = id.slice(5);
    if (engine.tryHeal(targetUid)) {
      matchNet.commit({
        seq: engine.state.actionSeq,
        type: 'heal',
        uid: engine.state.selectedUid!,
        targetUid,
      });
      playHeal();
      syncView();
      renderHud();
      maybeAiTurn();
    }
  }
}

function openPlateHand() {
  boardView.matchHud.openHand();
}

function closePlateHand() {
  boardView.matchHud.collapsePlate();
}

async function usePlateWithAnim(instanceId: string) {
  if (!canUsePlateInstance(engine, 'player', instanceId)) {
    playMiss();
    boardView.matchHud.punchPlate(instanceId);
    return;
  }

  const inst = engine.state.playerPlates.find((p) => p.instanceId === instanceId);
  const def = inst ? PLATE_BY_ID.get(inst.plateId) : null;
  if (!def) return;

  boardView.matchHud.punchPlate(instanceId);

  // Targeting plates: close hand, no throw — pick a Pokémon on the board.
  if (def.targeting !== 'none') {
    if (!engine.trySelectPlate(instanceId)) {
      playMiss();
      renderHud();
      return;
    }
    closePlateHand();
    playSelect();
    syncView();
    renderHud();
    return;
  }

  // Board / no-target plates: throw from the open hand while others collapse.
  if (!engine.trySelectPlate(instanceId)) {
    playMiss();
    renderHud();
    return;
  }
  await presentPlateAnim(instanceId);
  syncView();
  renderHud();
  if (engine.state.turn !== 'player') maybeAiTurn();
}

function plateTargetHintHtml(): string {
  const id = engine.state.pendingPlateInstanceId;
  if (!id) return '';
  const inst = engine.state.playerPlates.find((p) => p.instanceId === id);
  const def = inst ? PLATE_BY_ID.get(inst.plateId) : null;
  if (!def) {
    return `<div class="plate-hint">Select a figure target for your plate…</div>`;
  }
  const dual =
    def.targeting === 'own-switch' ||
    def.targeting === 'own-field-pair' ||
    def.targeting === 'hurdle-jump';
  const step2 = dual && !!engine.state.pendingPlateTargetUid;
  let where = 'a figure';
  switch (def.targeting) {
    case 'own-bench':
      where = 'a benched figure';
      break;
    case 'own-field':
      where = 'a figure on the field';
      break;
    case 'own-pc':
      where = 'a figure in the PC';
      break;
    case 'own-any':
      where = 'one of your figures (bench or field)';
      break;
    case 'own-switch':
      where = step2 ? 'the other figure to switch with' : 'the first figure to switch';
      break;
    case 'own-field-pair':
      where = step2 ? 'the second field figure' : 'the first field figure';
      break;
    case 'hurdle-jump':
      where = step2
        ? 'the connected figure to jump over'
        : 'your figure that will jump';
      break;
    default:
      break;
  }
  const step = dual ? (step2 ? '2 / 2' : '1 / 2') : '';
  return `<div class="plate-hint plate-hint-target">
    <strong>${escapeHtml(def.name)}</strong>
    <span>${step ? `${step} · ` : ''}Tap ${where}</span>
    <em>Glowing figures are valid targets</em>
  </div>`;
}

async function presentPlateAnim(instanceId: string) {
  const anim = engine.takeLastPlateAnim();
  let to = new THREE.Vector3(0, BOARD_TOP + 0.55, 0);
  if (anim?.toUid) {
    const w = boardView.pieceWorldPos(anim.toUid);
    if (w) to = w;
  } else if (anim?.toNodeId) {
    const node = engine.board.nodes.get(anim.toNodeId);
    if (node) {
      to = boardView.world(node);
      to.y = BOARD_TOP + 0.5;
    }
  }
  if (anim?.toUid) boardView.flashStatus(anim.toUid);
  await boardView.matchHud.playPlateFly(instanceId, to);
  playPlateUse();
}

function syncView() {
  boardView.syncPieces(engine.state.pieces);
  const selected = engine.state.selectedUid
    ? engine.piece(engine.state.selectedUid)?.nodeId ?? null
    : null;

  const pendingId = engine.state.pendingPlateInstanceId;
  if (pendingId) {
    const inst = engine.state.playerPlates.find((p) => p.instanceId === pendingId);
    const def = inst ? PLATE_BY_ID.get(inst.plateId) : null;
    const uids = def
      ? validTargets(engine, 'player', def.targeting, def, {
          stepFirstUid: engine.state.pendingPlateTargetUid,
        }).filter((uid) => uid !== engine.state.pendingPlateTargetUid)
      : [];
    // Keep first pick highlighted for dual-target plates.
    const focus = engine.state.pendingPlateTargetUid;
    const show = focus ? [...uids, focus] : uids;
    boardView.setPlateTargets(show, focus);
    boardView.setHighlights([], null);
  } else {
    boardView.setPlateTargets([]);
    boardView.setHighlights(
      engine.state.turnStep === 'choose' ? engine.state.legalMoves : [],
      selected,
    );
  }
}

async function maybeAiTurn() {
  if (engine.state.phase !== 'playing' || engine.state.turn !== 'opponent' || aiBusy) return;
  aiBusy = true;
  await new Promise((r) => setTimeout(r, 550));

  const action = pickAiAction(engine);
  if (!action) {
    engine.endTurn();
    playTurnChange();
  } else if (action.type === 'plate') {
    if (action.targets.length === 0) {
      engine.trySelectPlate(action.instanceId);
      await presentPlateAnim(action.instanceId);
    } else {
      engine.trySelectPlate(action.instanceId);
      for (const t of action.targets) engine.selectPiece(t);
      engine.takeLastPlateAnim();
      playPlateUse();
    }
  } else if (action.type === 'end') {
    engine.endTurnManually();
    playTurnChange();
  } else if (action.type === 'heal') {
    engine.selectPiece(action.pieceUid);
    if (engine.tryHeal(action.targetUid)) playHeal();
  } else if (action.type === 'battle') {
    engine.selectPiece(action.pieceUid);
    if (engine.tryBattleAdjacent(action.battleUid)) playBattleStart();
  } else if (action.type === 'move') {
    engine.selectPiece(action.pieceUid);
    const piece = engine.piece(action.pieceUid)!;
    const fromNodeId = piece.nodeId;
    const fromBench = piece.location === 'bench';
    const waypoints = buildMoveWaypoints(
      action.pieceUid,
      fromNodeId,
      action.targetNode,
      fromBench,
    );
    if (engine.tryMove(action.targetNode)) {
      const landingGoal =
        action.targetNode === goalNode(engine.board.nodes, piece.owner);
      const surrounds = engine.takeLastSurrounds();
      const pcEjects = engine.takeLastPcEjects();
      const pcShifts = engine.takeLastPcShifts();
      for (const e of pcEjects) {
        boardView.pinPiece(e.uid, boardView.pcWorldSlot(e.owner, e.fromSlot));
      }
      for (const sh of pcShifts) {
        boardView.pinPiece(sh.uid, boardView.pcWorldSlot(sh.owner, sh.fromSlot));
      }
      for (const s of surrounds) {
        const node = engine.board.nodes.get(s.fromNodeId);
        if (!node) continue;
        const w = boardView.world(node);
        w.y = BOARD_TOP;
        boardView.pinPiece(s.uid, w);
      }
      moveBusy = true;
      if (landingGoal && waypoints.length) {
        boardView.pinPiece(action.pieceUid, waypoints[0].clone());
      }
      await presentMoveHops(action.pieceUid, waypoints, landingGoal);
      boardView.clearPin(action.pieceUid);
      if (!landingGoal) await animateSurroundsToPc(surrounds, pcEjects, pcShifts);
      moveBusy = false;
    }
  }

  aiBusy = false;
  syncView();

  if (engine.state.battle) {
    await runBattlePresentation();
    return;
  }
  renderHud();
  if (engine.state.phase === 'playing' && engine.state.turn === 'opponent' && !engine.state.winner) {
    maybeAiTurn();
  }
}

canvas.addEventListener('pointerdown', async (ev) => {
  if (
    engine.state.phase !== 'playing' ||
    engine.state.turn !== 'player' ||
    battleBusy ||
    moveBusy ||
    boardView.isAnimating()
  ) {
    return;
  }
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  const plateId = boardView.pickPlate(raycaster);
  if (plateId && engine.state.turnStep === 'choose' && engine.state.plateWindowOpen) {
    if (boardView.matchHud.isHandOpen()) {
      await usePlateWithAnim(plateId);
    } else {
      playSelect();
      openPlateHand();
    }
    return;
  }
  if (boardView.matchHud.isHandOpen()) {
    closePlateHand();
    return;
  }

  const pieceUid = boardView.pickPiece(raycaster);
  if (pieceUid) {
    const p = engine.piece(pieceUid)!;
    if (p.owner === 'player') {
      if (engine.state.turnStep === 'post-move' && p.uid !== engine.state.movedUid) return;
      const wasPending = !!engine.state.pendingPlateInstanceId;
      engine.selectPiece(pieceUid);
      // Targeting plates: resolve on the figure (no board disc popup).
      if (wasPending && !engine.state.pendingPlateInstanceId) {
        engine.takeLastPlateAnim();
        playPlateUse();
      }
      playSelect();
      syncView();
      renderHud();
      if (engine.state.turn !== 'player') maybeAiTurn();
      return;
    }
    if (engine.state.selectedUid && engine.tryBattleAdjacent(pieceUid)) {
      playBattleStart();
      syncView();
      await runBattlePresentation();
      return;
    }
  }

  if (engine.state.turnStep !== 'choose') return;
  if (engine.state.pendingPlateInstanceId) return;

  const nodeId = boardView.pickNode(raycaster);
  if (nodeId && engine.state.selectedUid) {
    if (await tryMoveWithAnim(nodeId)) {
      syncView();
      renderHud();
      if (engine.state.phase === 'playing' && engine.state.turn !== 'player') {
        maybeAiTurn();
      }
    }
  }
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  plateOverlayRenderer.setSize(innerWidth, innerHeight);
});

/** WebGL loop only while a match (or cinematic) needs the board. */
let sceneLive = false;
let rafId = 0;

function boardNeedsFrame() {
  return (
    sceneLive ||
    !!camTween ||
    goalCinematic ||
    boardView.matchHud.isHandOpen() ||
    boardView.matchHud.isThrowing()
  );
}

function kickRenderLoop() {
  if (rafId) return;
  const loop = () => {
    rafId = 0;
    if (!boardNeedsFrame()) return;
    const t = clock.getElapsedTime();
    tickCameraTween();
    controls.update();
    updateTimerDom();
    boardView.syncPieces(engine.state.pieces, t);
    boardView.markers.children.forEach((c) => {
      if (c instanceof THREE.Mesh && c.userData.pulse) {
        const mat = c.material as THREE.MeshBasicMaterial | THREE.MeshStandardMaterial;
        const baseOp = (c.userData.pulseOpacity as number | undefined) ?? 0.8;
        mat.opacity = baseOp + Math.sin(t * 5) * 0.1;
        if ('emissiveIntensity' in mat && c.userData.pulseEmissive != null) {
          const baseEm = c.userData.pulseEmissive as number;
          mat.emissiveIntensity = baseEm + Math.sin(t * 5) * 0.14;
        }
      }
    });
    renderer.render(scene, camera);
    if (boardView.matchHud.isHandOpen()) {
      plateOverlayRenderer.render(plateOverlayScene, camera);
    }
    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);
}

function setSceneLive(live: boolean) {
  sceneLive = live;
  if (live) kickRenderLoop();
}

renderTeamSelect();
