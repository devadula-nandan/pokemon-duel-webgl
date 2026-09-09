import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import figuresData from './data/figures.json';
import { DuelEngine } from './game/engine';
import { pickAiAction } from './game/ai';
import type { FigureDef } from './game/types';
import { canInitiateBattle } from './game/combat';
import { BoardView, BOARD_TOP } from './render/BoardView';
import { animateWheelSpin, createWheelCanvas } from './render/wheel';
import {
  entryNodes,
  goalNode,
  shortestPath,
  shortestPathFromBench,
} from './game/board';
import {
  getSfxVolume,
  isSfxMuted,
  playBattleStart,
  playDefeat,
  playHeal,
  playHop,
  playLand,
  playMatchStart,
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
  isMusicMuted,
  mountBgmInSettings,
  setMusicVolume,
  setTrackChangeListener,
  startBgm,
  stopBgm,
} from './audio/bgm';

const figures = figuresData as FigureDef[];
const engine = new DuelEngine(figures);
const ui = document.getElementById('ui')!;
const canvas = document.getElementById('c') as HTMLCanvasElement;

/** Filled by settings mount — refreshes battle log while the sheet is open. */
let syncSettingsLog = () => {};

function ensureAudioControls() {
  if (document.getElementById('settings-btn')) return;

  const settingsBtn = document.createElement('button');
  settingsBtn.id = 'settings-btn';
  settingsBtn.type = 'button';
  settingsBtn.className = 'settings-btn';
  settingsBtn.title = 'Settings';
  settingsBtn.setAttribute('aria-label', 'Settings');
  settingsBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`;

  const dialog = document.createElement('div');
  dialog.id = 'settings-dialog';
  dialog.className = 'settings-dialog hidden';
  dialog.innerHTML = `
    <div class="settings-sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div class="settings-top">
        <h2 id="settings-title">Settings</h2>
        <button type="button" class="settings-close" id="settings-close" aria-label="Close">✕</button>
      </div>
      <section class="settings-section">
        <h3>Audio</h3>
        <div class="settings-sliders">
          <label class="settings-slider">
            <span class="settings-slider-label">🎵 Music <em id="music-vol-val">${getMusicVolume()}%</em></span>
            <input id="music-volume" type="range" min="0" max="100" step="1" value="${getMusicVolume()}" />
          </label>
          <label class="settings-slider">
            <span class="settings-slider-label">🔊 Sounds <em id="sfx-vol-val">${getSfxVolume()}%</em></span>
            <input id="sfx-volume" type="range" min="0" max="100" step="1" value="${getSfxVolume()}" />
          </label>
        </div>
        <div class="settings-audio-row" id="audio-controls">
          <div id="bgm-label" class="settings-chip bgm-label">${getTrackLabel()}</div>
        </div>
        <div id="sc-bgm-mount" class="sc-bgm-mount"></div>
        <p class="settings-hint">Music streams from SoundCloud (Pokémon Red/Blue Game Boy OST). One track loops; Next switches songs. Game sounds are separate.</p>
      </section>
      <section class="settings-section">
        <h3>Battle log</h3>
        <div class="settings-log" id="settings-log"></div>
      </section>
    </div>
  `;

  const musicSlider = () => dialog.querySelector('#music-volume') as HTMLInputElement;
  const sfxSlider = () => dialog.querySelector('#sfx-volume') as HTMLInputElement;
  const musicVal = () => dialog.querySelector('#music-vol-val') as HTMLElement;
  const sfxVal = () => dialog.querySelector('#sfx-vol-val') as HTMLElement;
  const trackLabel = () => dialog.querySelector('#bgm-label') as HTMLElement;

  const paintAudio = () => {
    musicSlider().value = String(getMusicVolume());
    sfxSlider().value = String(getSfxVolume());
    musicVal().textContent = `${getMusicVolume()}%`;
    sfxVal().textContent = `${getSfxVolume()}%`;
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

  const openSettings = () => {
    if (!isSfxMuted()) playUiTap();
    paintAudio();
    paintBattleLog();
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

  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !dialog.classList.contains('hidden')) closeSettings();
  });

  setTrackChangeListener((title) => {
    trackLabel().textContent = title;
  });

  musicSlider().addEventListener('input', () => {
    const v = Number(musicSlider().value);
    setMusicVolume(v);
    musicVal().textContent = `${v}%`;
    if (v > 0) void startBgm();
  });

  sfxSlider().addEventListener('input', () => {
    const v = Number(sfxSlider().value);
    setSfxVolume(v);
    sfxVal().textContent = `${v}%`;
  });

  paintAudio();
  paintBattleLog();
  syncSettingsLog = paintBattleLog;
  document.getElementById('app')!.append(settingsBtn, dialog);
  mountBgmInSettings();
  if (!isMusicMuted()) void startBgm();
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

const resetCamBtn = document.createElement('button');
resetCamBtn.type = 'button';
resetCamBtn.id = 'camera-reset';
resetCamBtn.className = 'camera-reset-btn hidden';
resetCamBtn.textContent = 'Reset camera';
resetCamBtn.setAttribute('aria-label', 'Reset camera');
// Append to #app (not #ui) so it stacks above the match HUD like Settings
document.getElementById('app')!.appendChild(resetCamBtn);

function cameraIsDefault() {
  return (
    camera.position.distanceToSquared(CAM_DEFAULT_POS) < 0.0025 &&
    controls.target.distanceToSquared(CAM_DEFAULT_TARGET) < 0.0025 &&
    Math.abs(camera.fov - CAM_DEFAULT_FOV) < 0.05
  );
}

function syncCameraResetBtn() {
  resetCamBtn.classList.toggle('hidden', (cameraIsDefault() && !camTween) || goalCinematic);
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
  if (restoreControls && !goalCinematic) controls.enabled = true;
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
    if (!goalCinematic) controls.enabled = true;
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
controls.addEventListener('end', syncCameraResetBtn);
controls.addEventListener('start', () => {
  cancelCameraTween();
  resetCamBtn.classList.remove('hidden');
});

resetCamBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (cameraIsDefault() && !camTween) return;
  if (!isSfxMuted()) playUiTap();
  void animateCameraTo(CAM_DEFAULT_POS, CAM_DEFAULT_TARGET, {
    dur: 750,
    fov: CAM_DEFAULT_FOV,
  }).then(() => syncCameraResetBtn());
  resetCamBtn.classList.add('hidden');
});

scene.add(new THREE.HemisphereLight(0xffe0c0, 0x2a1510, 0.55));
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
  stopBgm();

  await new Promise((r) => setTimeout(r, 900));
  boardView.clearPin(uid);
  goalCinematic = false;
  showRematchChip();
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
  const el = document.getElementById('timer');
  syncTurnTimer();
  const playing = engine.state.phase === 'playing';
  const left = playing ? turnDeadline - performance.now() : 0;
  const frac = playing ? Math.max(0, Math.min(1, left / (TURN_SECONDS * 1000))) : 0;
  boardView.setTurnTimer(playing ? engine.state.turn : null, frac);
  if (!el || !playing) return;
  el.textContent = formatTurnClock(left);
  el.classList.toggle('urgent', left <= 10_000);
}

const DEFAULT_PLAYER = ['Charmander', 'Pikachu', 'Eevee', 'Squirtle', 'Bulbasaur', 'Rattata'];
const DEFAULT_AI = ['Machop', 'Geodude', 'Haunter', 'Golem', 'Magnemite', 'Dratini'];

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

function renderTeamSelect() {
  stopBgm();
  const selected: FigureDef[] = [];
  ui.innerHTML = `
    <div class="overlay">
      <div class="modal">
        <h1>Duel Field</h1>
        <p>Build a 6-figure team. Rules mirror Pokémon Duel — goal race, attack wheels, PC, surrounds.</p>
        <div class="filters">
          <input id="search" placeholder="Search figures…" />
          <select id="rarity">
            <option value="">All rarities</option>
            <option>UX</option><option>EX</option><option>R</option><option>UC</option><option>C</option>
          </select>
          <select id="mp">
            <option value="">All MP</option>
            <option value="1">1 MP</option>
            <option value="2">2 MP</option>
            <option value="3">3 MP</option>
          </select>
          <button class="btn secondary" id="quick">Quick team</button>
        </div>
        <div class="selected-row" id="picked"></div>
        <div class="team-grid" id="grid"></div>
        <button class="btn" id="start" disabled>Start duel (0/6)</button>
        <p class="disclaimer">Fan recreation of Pokémon Duel mechanics for personal/educational use. Pokémon is © Nintendo / Creatures / GAME FREAK. Not affiliated with The Pokémon Company.</p>
      </div>
    </div>
  `;

  const grid = ui.querySelector('#grid')!;
  const picked = ui.querySelector('#picked')!;
  const start = ui.querySelector('#start') as HTMLButtonElement;

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
    grid.innerHTML = list
      .slice(0, 120)
      .map((f) => {
        const on = selected.some((s) => s.name === f.name);
        return `<button class="fig-card ${on ? 'selected' : ''}" data-name="${f.name}">
          <div class="name">${f.name}<span class="rarity ${f.rarity}">${f.rarity}</span></div>
          <div class="meta">MP ${f.mp} · ${f.wheel.length} segments</div>
        </button>`;
      })
      .join('');
    picked.innerHTML = selected
      .map((s) => `<span class="chip">${s.name}</span>`)
      .join('');
    start.disabled = selected.length !== 6;
    start.textContent = `Start duel (${selected.length}/6)`;
  };

  paint();
  ui.querySelector('#search')!.addEventListener('input', paint);
  ui.querySelector('#rarity')!.addEventListener('change', paint);
  ui.querySelector('#mp')!.addEventListener('change', paint);
  ui.querySelector('#quick')!.addEventListener('click', () => {
    selected.length = 0;
    selected.push(...resolveTeam(DEFAULT_PLAYER));
    playUiTap();
    paint();
  });
  grid.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button[data-name]') as HTMLButtonElement | null;
    if (!btn) return;
    const def = findByName(btn.dataset.name!)!;
    const idx = selected.findIndex((s) => s.name === def.name);
    if (idx >= 0) selected.splice(idx, 1);
    else if (selected.length < 6) selected.push(def);
    playSelect();
    paint();
  });
  start.addEventListener('click', () => {
    const ai = resolveTeam(DEFAULT_AI.filter((n) => !selected.some((s) => s.name === n)));
    engine.startMatch(selected, ai.length === 6 ? ai : fallbackTeam());
    playMatchStart();
    if (!isMusicMuted()) void startBgm();
    renderHud();
    void boardView.playBenchDropIntro({ onLand: () => playLand() }).then(() => {
      maybeAiTurn();
    });
  });
}

function renderHud() {
  const s = engine.state;
  syncTurnTimer();

  const selected = s.selectedUid ? engine.piece(s.selectedUid) : null;
  const foes =
    selected && s.turn === 'player' && selected.owner === 'player'
      ? engine.adjacentEnemies(selected.uid)
      : [];
  const heals =
    selected && s.turnStep === 'choose' && s.turn === 'player'
      ? engine.adjacentAlliesNeedingHeal(selected.uid)
      : [];

  const actionBar =
    s.turn === 'player' && s.phase === 'playing'
      ? `<div class="action-bar">
          ${foes
            .map(
              (f) =>
                `<button class="btn" data-battle="${f.uid}" ${
                  selected && canInitiateBattle(selected) ? '' : 'disabled'
                }>Battle ${f.name}</button>`,
            )
            .join('')}
          ${heals
            .map(
              (h) =>
                `<button class="btn secondary" data-heal="${h.uid}">Cure ${h.name}</button>`,
            )
            .join('')}
          ${
            s.turnStep === 'post-move'
              ? `<button class="btn secondary" id="end-turn">End Turn</button>`
              : ''
          }
        </div>`
      : '';

  ui.innerHTML = `
    <button type="button" class="resign-btn" id="resign">Resign</button>
    <div class="match-header">
      <div class="player-chip you ${s.turn === 'player' ? 'active' : ''}">
        <div class="avatar" aria-hidden="true">Y</div>
        <div class="meta">
          <div class="name">You</div>
          <div class="sub">${s.turn === 'player' ? 'Acting' : 'Waiting'}</div>
        </div>
      </div>
      <div class="timer ${s.turn === 'player' ? 'hot' : ''}" id="timer">${formatTurnClock(
        turnDeadline - performance.now(),
      )}</div>
      <div class="player-chip opp ${s.turn === 'opponent' ? 'active' : ''}">
        <div class="meta">
          <div class="name">Rival</div>
          <div class="sub">${s.turn === 'opponent' ? 'Acting' : 'Waiting'}</div>
        </div>
        <div class="avatar" aria-hidden="true">R</div>
      </div>
    </div>
    ${actionBar}
  `;

  syncSettingsLog();

  ui.querySelector('#resign')!.addEventListener('click', () => {
    engine.state.phase = 'game-over';
    engine.state.winner = 'opponent';
    engine.state.winReason = 'You resigned.';
    showRematchChip();
  });

  ui.querySelector('#end-turn')?.addEventListener('click', () => {
    if (engine.endTurnManually()) {
      playTurnChange();
      syncView();
      renderHud();
      maybeAiTurn();
    }
  });

  ui.querySelectorAll('[data-battle]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = (btn as HTMLElement).dataset.battle!;
      if (engine.state.selectedUid && engine.tryBattleAdjacent(id)) {
        playBattleStart();
        syncView();
        await runBattlePresentation();
      }
    });
  });

  ui.querySelectorAll('[data-heal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).dataset.heal!;
      if (engine.tryHeal(id)) {
        playHeal();
        syncView();
        renderHud();
        maybeAiTurn();
      }
    });
  });

  if (s.phase === 'game-over' && !goalCinematic) showRematchChip();
}

function showRematchChip() {
  if (document.getElementById('go')) return;
  const s = engine.state;
  // Goal wins already played sting in the cinematic
  if (!s.winReason?.includes('captured the goal')) {
    stopBgm();
    if (s.winner === 'player') playVictory();
    else if (s.winner === 'opponent') playDefeat();
  }
  const label =
    s.winner === 'player' ? 'You win' : s.winner === 'opponent' ? 'Rival wins' : 'Draw';
  ui.insertAdjacentHTML(
    'beforeend',
    `<div class="rematch-chip" id="go">
      <span class="rematch-label">${label}</span>
      <button type="button" class="btn" id="again">Rematch</button>
    </div>`,
  );
  ui.querySelector('#again')!.addEventListener('click', () => {
    playUiTap();
    camera.fov = CAM_DEFAULT_FOV;
    camera.position.copy(CAM_DEFAULT_POS);
    controls.target.copy(CAM_DEFAULT_TARGET);
    camera.updateProjectionMatrix();
    controls.enabled = true;
    controls.update();
    renderTeamSelect();
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
  const cTop = createWheelCanvas(topPiece.wheel, renderSize);
  const cBot = createWheelCanvas(botPiece.wheel, renderSize);
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

  const spinMs = 2700;
  playWheelSpin(spinMs / 1000);
  // Pointer toward center diamond (top-right wheel → SW, bottom-left → NE)
  await Promise.all([
    animateWheelSpin(wTop, topPiece.wheel, topSpin, 225, spinMs),
    animateWheelSpin(wBot, botPiece.wheel, botSpin, 45, spinMs),
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

function syncView() {
  boardView.syncPieces(engine.state.pieces);
  const selected = engine.state.selectedUid
    ? engine.piece(engine.state.selectedUid)?.nodeId ?? null
    : null;
  boardView.setHighlights(
    engine.state.turnStep === 'choose' ? engine.state.legalMoves : [],
    selected,
  );
}

async function maybeAiTurn() {
  if (engine.state.phase !== 'playing' || engine.state.turn !== 'opponent' || aiBusy) return;
  aiBusy = true;
  await new Promise((r) => setTimeout(r, 550));

  const action = pickAiAction(engine);
  if (!action) {
    engine.endTurn();
    playTurnChange();
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

  const pieceUid = boardView.pickPiece(raycaster);
  if (pieceUid) {
    const p = engine.piece(pieceUid)!;
    if (p.owner === 'player') {
      if (engine.state.turnStep === 'post-move' && p.uid !== engine.state.movedUid) return;
      engine.selectPiece(pieceUid);
      playSelect();
      syncView();
      renderHud();
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
});

function frame() {
  requestAnimationFrame(frame);
  const t = clock.getElapsedTime();
  tickCameraTween();
  controls.update();
  updateTimerDom();
  boardView.syncPieces(engine.state.pieces, t);
  // Pulse legal-move rings
  boardView.markers.children.forEach((c) => {
    if (c instanceof THREE.Mesh && c.userData.pulse) {
      const mat = c.material as THREE.MeshStandardMaterial;
      mat.opacity = 0.72 + Math.sin(t * 5) * 0.16;
      mat.emissiveIntensity = 0.5 + Math.sin(t * 5) * 0.2;
    }
  });
  renderer.render(scene, camera);
}
frame();

renderTeamSelect();
