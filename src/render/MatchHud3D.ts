import * as THREE from 'three';
import type { DuelEngine } from '../game/engine';
import { PLATE_BY_ID, canUsePlateInstance, canUsePlatesNow, platesFor } from '../game/plates';
import type { PlateInstance } from '../game/types';

/** Same as BoardView.FLOOR_Y — arena floor where bench figures sit. */
const ARENA_FLOOR_Y = -0.08;

/** Title/icon accents — vivid plate themes (not rarity). */
const PLATE_ACCENTS = [
  '#c77dff',
  '#ffd166',
  '#4cc9f0',
  '#ef476f',
  '#06d6a0',
  '#f72585',
  '#ff9f1c',
  '#7bdff2',
];

/** Stack size on the floor. */
const FIGURE_BASE_D = 0.48;
const STACK_W = FIGURE_BASE_D;
const STACK_H = FIGURE_BASE_D / (512 / 768);
/** Sit on the arena floor with the bench figures (not board-top height). */
const STACK_Y = ARENA_FLOOR_Y + 0.01;

/**
 * Open hand: fixed 2×6 camera-facing grid (max 6 plates).
 * Cards keep a constant aspect — never stretch to fill the HUD.
 */
const HAND_COLS = 2;
/** Max 6 plates → fixed 2×3 slots (always sized for a full hand). */
const HAND_ROWS = 3;
/** Texture / plate aspect (width / height). */
const HAND_CARD_ASPECT = 512 / 768;
const HAND_GAP_X = 0.08;
const HAND_GAP_Y = 0.08;
/** Distance in front of the camera. */
const HAND_CAM_DIST = 5.2;
/** Pixel insets — top clears match-header; bottom is a thin margin only. */
const HUD_TOP_PX = 88;
const HUD_BOTTOM_PX = 28;
const HUD_SIDE_PX = 12;

function hashStr(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function plateAccent(name: string) {
  return PLATE_ACCENTS[hashStr(name) % PLATE_ACCENTS.length]!;
}

/** Metallic / holographic stops by rarity for border + EX letters. */
function rarityMetalStops(rarity: string): string[] {
  switch (rarity) {
    case 'UX':
      return ['#fff6ff', '#ff66cc', '#a0e9ff', '#ffe066', '#ff66cc', '#ffffff'];
    case 'EX':
      return ['#ffffff', '#7ef9ff', '#ff7ae9', '#ffe566', '#7ef9ff', '#ffffff'];
    case 'R':
      return ['#f3e8ff', '#e0c3fc', '#c77dff', '#9b5de5', '#e0c3fc', '#ffffff'];
    case 'UC':
      return ['#e8f4ff', '#90caf9', '#42a5f5', '#1e88e5', '#bbdefb', '#ffffff'];
    default:
      return ['#f5f5f5', '#cfd8dc', '#90a4ae', '#607d8b', '#cfd8dc', '#ffffff'];
  }
}

function metalLinear(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  stops: string[],
) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  const n = Math.max(1, stops.length - 1);
  stops.forEach((c, i) => g.addColorStop(i / n, c));
  return g;
}

/** Original duel plate silhouette: chamfered top-left, rounded elsewhere. */
function platePath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  chamfer: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  const ch = Math.min(chamfer, w * 0.35, h * 0.28);
  ctx.beginPath();
  ctx.moveTo(x + ch, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + ch);
  ctx.closePath();
}

function drawPlateIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  accent: string,
  name: string,
  used: boolean,
) {
  const ring = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
  ring.addColorStop(0, used ? '#3a3a3a' : '#2a2a2e');
  ring.addColorStop(0.55, used ? '#1a1a1a' : '#0c0c0e');
  ring.addColorStop(1, '#050506');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = ring;
  ctx.fill();
  ctx.strokeStyle = used ? '#555' : accent;
  ctx.lineWidth = Math.max(4, r * 0.08);
  ctx.stroke();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = used ? '#777' : accent;
  ctx.fillStyle = used ? '#777' : accent;
  ctx.lineWidth = Math.max(5, r * 0.1);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const kind = hashStr(name) % 6;
  const s = r * 0.55;
  if (kind === 0) {
    // curved counter arrow
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.85, 0.35, Math.PI * 1.45);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-s * 0.15, s * 0.75);
    ctx.lineTo(-s * 0.7, s * 0.35);
    ctx.lineTo(-s * 0.05, s * 0.15);
    ctx.fill();
  } else if (kind === 1) {
    // poke-ball-ish
    ctx.beginPath();
    ctx.arc(0, 0, s, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-s, 0);
    ctx.lineTo(s, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.28, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 2) {
    // burst / powder
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * s * 0.25, Math.sin(a) * s * 0.25);
      ctx.lineTo(Math.cos(a) * s, Math.sin(a) * s);
      ctx.stroke();
    }
  } else if (kind === 3) {
    // chevron / throw
    ctx.beginPath();
    ctx.moveTo(-s * 0.7, s * 0.55);
    ctx.lineTo(0, -s * 0.75);
    ctx.lineTo(s * 0.7, s * 0.55);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-s * 0.45, s * 0.15);
    ctx.lineTo(0, -s * 0.35);
    ctx.lineTo(s * 0.45, s * 0.15);
    ctx.stroke();
  } else if (kind === 4) {
    // shield / band
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.quadraticCurveTo(s, -s * 0.6, s * 0.85, s * 0.2);
    ctx.quadraticCurveTo(0, s * 1.05, -s * 0.85, s * 0.2);
    ctx.quadraticCurveTo(-s, -s * 0.6, 0, -s);
    ctx.stroke();
  } else {
    // double diamond / chance
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.lineTo(s * 0.7, 0);
    ctx.lineTo(0, s);
    ctx.lineTo(-s * 0.7, 0);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.45);
    ctx.lineTo(s * 0.35, 0);
    ctx.lineTo(0, s * 0.45);
    ctx.lineTo(-s * 0.35, 0);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function createPlateCardTexture(
  name: string,
  cost: number,
  rarity: string,
  used: boolean,
  description?: string,
  detailed?: boolean,
  disabled?: boolean,
): THREE.CanvasTexture {
  const w = 512;
  const h = detailed ? 768 : 640;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  const locked = used || !!disabled;
  const accent = locked ? '#888888' : plateAccent(name);
  const metal = rarityMetalStops(rarity);
  const pad = 10;
  const x = pad;
  const y = pad;
  const pw = w - pad * 2;
  const ph = h - pad * 2;
  const cornerR = 22;
  const chamfer = 78;

  // Body — deep black glass
  platePath(ctx, x, y, pw, ph, cornerR, chamfer);
  const body = ctx.createLinearGradient(x, y, x + pw, y + ph);
  if (locked) {
    body.addColorStop(0, '#2a2a2c');
    body.addColorStop(1, '#141416');
  } else {
    body.addColorStop(0, '#1a1a1e');
    body.addColorStop(0.45, '#0a0a0c');
    body.addColorStop(1, '#050506');
  }
  ctx.fillStyle = body;
  ctx.fill();

  // Soft inner bevel
  ctx.save();
  platePath(ctx, x, y, pw, ph, cornerR, chamfer);
  ctx.clip();
  const inset = ctx.createLinearGradient(x, y, x, y + ph * 0.35);
  inset.addColorStop(0, 'rgba(255,255,255,0.07)');
  inset.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = inset;
  ctx.fillRect(x, y, pw, ph * 0.4);

  // Diagonal gloss streak (original plastic shine)
  if (!locked) {
    ctx.save();
    ctx.translate(x + pw * 0.15, y + ph * 0.02);
    ctx.rotate((-28 * Math.PI) / 180);
    const gloss = ctx.createLinearGradient(0, 0, pw * 0.55, 0);
    gloss.addColorStop(0, 'rgba(255,255,255,0)');
    gloss.addColorStop(0.35, 'rgba(255,255,255,0.14)');
    gloss.addColorStop(0.5, 'rgba(255,255,255,0.22)');
    gloss.addColorStop(0.65, 'rgba(255,255,255,0.1)');
    gloss.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gloss;
    ctx.fillRect(0, 0, pw * 0.55, ph * 0.55);
    ctx.restore();
  }

  // Subtle rarity wash behind EX corner
  const wash = ctx.createRadialGradient(x + pw - 36, y + 40, 4, x + pw - 20, y + 36, 110);
  wash.addColorStop(0, locked ? 'rgba(120,120,120,0.15)' : `${metal[2]}33`);
  wash.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = wash;
  ctx.fillRect(x + pw * 0.45, y, pw * 0.55, ph * 0.28);

  // Icon
  const iconR = detailed ? 78 : 88;
  const iconCy = y + (detailed ? 118 : 130);
  drawPlateIcon(ctx, x + pw / 2, iconCy, iconR, accent, name, locked);

  // Metallic rarity letters (top-right)
  const rarLabel = rarity.toUpperCase();
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.font = `bold ${detailed ? 42 : 48}px "Syne", system-ui, sans-serif`;
  const rarX = x + pw - 28;
  const rarY = y + 22;
  if (!locked) {
    ctx.shadowColor = metal[2] ?? '#fff';
    ctx.shadowBlur = 12;
  }
  ctx.fillStyle = locked
    ? '#666'
    : metalLinear(ctx, rarX - 70, rarY, rarX + 10, rarY + 40, metal);
  ctx.fillText(rarLabel, rarX, rarY);
  ctx.shadowBlur = 0;

  // Title under icon
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `bold ${detailed ? 40 : 44}px "Syne", system-ui, sans-serif`;
  ctx.fillStyle = accent;
  const titleY = iconCy + iconR + (detailed ? 48 : 52);
  wrapText(ctx, name, x + pw / 2, titleY, pw - 56, detailed ? 44 : 48);

  // Description — metallic silver, left-aligned
  if (detailed && description) {
    ctx.textAlign = 'left';
    ctx.font = '26px "Source Sans 3", system-ui, sans-serif';
    ctx.fillStyle = locked
      ? '#666'
      : metalLinear(ctx, x, titleY + 40, x + pw, titleY + 220, [
          '#ffffff',
          '#d8dee6',
          '#aeb8c4',
          '#e8eef5',
          '#c5ced8',
        ]);
    const descBottom = y + ph - 78;
    wrapText(ctx, description, x + 36, titleY + 52, pw - 72, 34, descBottom);
  }

  // Cost badge (bottom)
  const badgeY = y + ph - (detailed ? 52 : 58);
  ctx.textAlign = 'center';
  ctx.font = 'bold 22px "Source Sans 3", system-ui, sans-serif';
  ctx.fillStyle = locked ? '#555' : 'rgba(255,255,255,0.35)';
  ctx.fillText(used ? 'USED' : `COST  ${cost}`, x + pw / 2, badgeY);

  if (detailed && !used && !disabled) {
    ctx.font = 'bold 22px "Source Sans 3", system-ui, sans-serif';
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.85;
    ctx.fillText('Tap to play', x + pw / 2, badgeY + 28);
    ctx.globalAlpha = 1;
  } else if (detailed && disabled && !used) {
    ctx.font = 'bold 22px "Source Sans 3", system-ui, sans-serif';
    ctx.fillStyle = '#888';
    ctx.fillText('Unavailable', x + pw / 2, badgeY + 28);
  }

  // Disabled veil + slash
  if (disabled && !used) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(x, y, pw, ph);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(x + pw * 0.18, y + ph * 0.22);
    ctx.lineTo(x + pw * 0.82, y + ph * 0.78);
    ctx.stroke();
  }
  ctx.restore();

  // Metallic rarity border (after clip restore so stroke sits on edge)
  platePath(ctx, x, y, pw, ph, cornerR, chamfer);
  ctx.strokeStyle = locked
    ? '#555'
    : metalLinear(ctx, x, y, x + pw, y + ph, metal);
  ctx.lineWidth = 7;
  ctx.stroke();
  // Thin outer chrome rim
  platePath(ctx, x + 1.5, y + 1.5, pw - 3, ph - 3, cornerR - 1, chamfer - 1);
  ctx.strokeStyle = locked ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  lineH: number,
  maxY?: number,
) {
  const words = text.split(/\s+/);
  let line = '';
  let yy = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      if (maxY != null && yy + lineH > maxY) {
        const clipped = line.replace(/\s+\S*$/, '') || line;
        ctx.fillText(`${clipped}…`, x, yy);
        return;
      }
      ctx.fillText(line, x, yy);
      line = word;
      yy += lineH;
    } else line = test;
  }
  if (line) {
    if (maxY != null && yy > maxY) return;
    ctx.fillText(line, x, yy);
  }
}

export type HudActionId =
  | 'end-turn'
  | 'battle'
  | 'heal'
  | 'resign'
  | `battle:${string}`
  | `heal:${string}`;

/**
 * World-space plate cards. Stack on floor; open into a camera-facing
 * 2D grid near the screen (portrait HUD width).
 */
export class MatchHud3D {
  readonly root = new THREE.Group();
  private plateRoot = new THREE.Group();
  private plateMeshes = new Map<string, THREE.Mesh>();
  private engine: DuelEngine;
  private plateLayout: { x: number; z: number; mirror: number } | null = null;
  private viewCamera: THREE.Camera | null = null;
  private flyAnim: {
    mesh: THREE.Object3D;
    t0: number;
    from: THREE.Vector3;
    to: THREE.Vector3;
    startScaleX: number;
    startScaleY: number;
    resolve: () => void;
  } | null = null;
  private punch = new Map<string, number>();
  private handOpen = false;
  /** While set, sync skips layout for this plate (throw / fly). */
  private flyingId: string | null = null;
  onHandChange: ((open: boolean) => void) | null = null;
  private readonly _right = new THREE.Vector3();
  private readonly _up = new THREE.Vector3();
  private readonly _fwd = new THREE.Vector3();
  private readonly _center = new THREE.Vector3();

  constructor(engine: DuelEngine) {
    this.engine = engine;
    this.root.add(this.plateRoot);
  }

  setPlateSlot(worldX: number, worldZ: number, mirror: number) {
    this.plateLayout = { x: worldX, z: worldZ, mirror };
  }

  setCamera(camera: THREE.Camera) {
    this.viewCamera = camera;
  }

  isHandOpen() {
    return this.handOpen;
  }

  isThrowing() {
    return !!this.flyingId;
  }

  openHand() {
    if (this.handOpen) return;
    this.handOpen = true;
    this.restampAll();
    this.onHandChange?.(true);
  }

  collapsePlate() {
    if (!this.handOpen) return;
    this.handOpen = false;
    this.restampAll();
    this.onHandChange?.(false);
  }

  sync(t = 0) {
    this.syncPlates(t);
    this.updateFly(t);
  }

  private restampAll() {
    for (const id of this.plateMeshes.keys()) {
      if (id === this.flyingId) continue;
      this.restampPlate(id);
    }
  }

  private restampPlate(instanceId: string) {
    const mesh = this.plateMeshes.get(instanceId);
    if (!mesh) return;
    const plates = platesFor(this.engine, 'player');
    const inst = plates.find((p) => p.instanceId === instanceId);
    if (!inst) return;
    const def = PLATE_BY_ID.get(inst.plateId);
    if (!def) return;
    mesh.userData.used = undefined;
    mesh.userData.detailed = undefined;
    mesh.userData.disabled = undefined;
    const disabled =
      !inst.used && !canUsePlateInstance(this.engine, 'player', inst.instanceId);
    this.refreshPlateTex(mesh, inst, def.name, def.cost, def.rarity, def.description, disabled);
  }

  /** Fixed 2×6 grid; scale cards uniformly to fit the HUD (no stretch). */
  private fitHandInHud(cam: THREE.Camera | null) {
    const gapX = HAND_GAP_X;
    const gapY = HAND_GAP_Y;
    let safeW = 2.2;
    let safeH = 4.2;
    let centerY = 0;

    if (cam && cam instanceof THREE.PerspectiveCamera) {
      const vFov = (cam.fov * Math.PI) / 180;
      const halfH = Math.tan(vFov / 2) * HAND_CAM_DIST;
      const halfW = halfH * cam.aspect;
      const vh = Math.max(1, innerHeight);
      const vw = Math.max(1, innerWidth);
      const ndcTop = 1 - (2 * HUD_TOP_PX) / vh;
      const ndcBot = -1 + (2 * HUD_BOTTOM_PX) / vh;
      const fill = 0.94;

      const header = document.getElementById('match-header');
      const headerW = header?.getBoundingClientRect().width ?? 0;
      const hudPx = Math.min(
        vw - HUD_SIDE_PX * 2,
        Math.max(headerW > 120 ? headerW : 0, Math.min(420, vh * 0.56)),
      );
      const hudWorldW = (hudPx / vw) * 2 * halfW;

      safeW = Math.max(0.5, hudWorldW * fill);
      safeH = Math.max(0.5, (ndcTop - ndcBot) * halfH * fill);
      centerY = ((ndcTop + ndcBot) / 2) * halfH;
    }

    // Max cell size that fits the full 2×6 grid inside the safe rect.
    const maxCellW = (safeW - (HAND_COLS - 1) * gapX) / HAND_COLS;
    const maxCellH = (safeH - (HAND_ROWS - 1) * gapY) / HAND_ROWS;
    // Pick the larger dimension that still preserves aspect (no stretch).
    let cardW = maxCellW;
    let cardH = cardW / HAND_CARD_ASPECT;
    if (cardH > maxCellH) {
      cardH = maxCellH;
      cardW = cardH * HAND_CARD_ASPECT;
    }

    const gridW = HAND_COLS * cardW + (HAND_COLS - 1) * gapX;
    const gridH = HAND_ROWS * cardH + (HAND_ROWS - 1) * gapY;
    return {
      cardW,
      cardH,
      gapX,
      gapY,
      originX: -gridW / 2 + cardW / 2,
      originY: gridH / 2 - cardH / 2,
      centerY,
    };
  }

  private syncPlates(_t: number) {
    if (!this.plateLayout) return;
    const usable = canUsePlatesNow(this.engine, 'player');
    const plates = platesFor(this.engine, 'player');
    const seen = new Set<string>();
    const cx = this.plateLayout.x;
    const cz = this.plateLayout.z;

    const cam = this.viewCamera;
    const layout = this.fitHandInHud(cam);

    if (this.handOpen && cam) {
      cam.getWorldDirection(this._fwd);
      this._center.copy(cam.position).addScaledVector(this._fwd, HAND_CAM_DIST);
      this._right.set(1, 0, 0).applyQuaternion(cam.quaternion);
      this._up.set(0, 1, 0).applyQuaternion(cam.quaternion);
      this._center.addScaledVector(this._up, layout.centerY);
    }

    plates.forEach((inst, i) => {
      seen.add(inst.instanceId);
      let mesh = this.plateMeshes.get(inst.instanceId);
      const def = PLATE_BY_ID.get(inst.plateId);
      if (!def) return;
      const playable = canUsePlateInstance(this.engine, 'player', inst.instanceId);
      const disabled = !inst.used && !playable;
      if (!mesh) {
        const geo = new THREE.PlaneGeometry(1, 1);
        const mat = new THREE.MeshBasicMaterial({
          map: createPlateCardTexture(
            def.name,
            def.cost,
            def.rarity,
            inst.used,
            undefined,
            false,
            disabled,
          ),
          transparent: true,
          alphaTest: 0.08,
          side: THREE.DoubleSide,
          depthWrite: true,
          depthTest: true,
        });
        mesh = new THREE.Mesh(geo, mat);
        mesh.userData.plateInstanceId = inst.instanceId;
        mesh.userData.kind = 'plate';
        mesh.position.set(cx, STACK_Y + i * 0.01, cz);
        mesh.rotation.set(-Math.PI / 2, 0, 0);
        mesh.scale.set(STACK_W, STACK_H, 1);
        this.plateMeshes.set(inst.instanceId, mesh);
        this.plateRoot.add(mesh);
      } else if (this.flyingId !== inst.instanceId) {
        this.refreshPlateTex(mesh, inst, def.name, def.cost, def.rarity, def.description, disabled);
      }

      if (this.flyingId === inst.instanceId) {
        const mat = mesh.material as THREE.MeshBasicMaterial;
        mat.depthTest = false;
        mesh.renderOrder = 200;
        return;
      }

      const punchT = this.punch.get(inst.instanceId);
      let punchScale = 1;
      if (punchT != null) {
        const age = performance.now() - punchT;
        if (age < 220) punchScale = 1 + Math.sin((age / 220) * Math.PI) * 0.12;
        else this.punch.delete(inst.instanceId);
      }

      let targetPos: THREE.Vector3;
      let targetSx: number;
      let targetSy: number;
      const faceCamera = this.handOpen && !!cam;

      if (faceCamera) {
        const col = i % HAND_COLS;
        const row = Math.min(HAND_ROWS - 1, Math.floor(i / HAND_COLS));
        const lx = layout.originX + col * (layout.cardW + layout.gapX);
        const ly = layout.originY - row * (layout.cardH + layout.gapY);
        targetPos = this._center
          .clone()
          .addScaledVector(this._right, lx)
          .addScaledVector(this._up, ly);
        targetSx = layout.cardW * punchScale * (disabled ? 0.96 : 1);
        targetSy = layout.cardH * punchScale * (disabled ? 0.96 : 1);
      } else if (this.handOpen) {
        const col = i % HAND_COLS;
        const row = Math.min(HAND_ROWS - 1, Math.floor(i / HAND_COLS));
        targetPos = new THREE.Vector3(
          layout.originX + col * (layout.cardW + layout.gapX),
          6.2 - row * (layout.cardH + layout.gapY),
          5.2,
        );
        targetSx = layout.cardW * punchScale;
        targetSy = layout.cardH * punchScale;
      } else {
        // Neat stack on the arena floor with the bench figures.
        targetPos = new THREE.Vector3(cx, STACK_Y + i * 0.012, cz);
        targetSx = STACK_W * (inst.used ? 0.9 : 1) * punchScale;
        targetSy = STACK_H * (inst.used ? 0.9 : 1) * punchScale;
      }

      if (this.flyAnim?.mesh !== mesh) {
        // Snap other cards home faster while one is thrown from the open hand.
        const ease = this.flyingId ? 0.38 : 0.22;
        mesh.position.lerp(targetPos, ease);
        mesh.scale.x += (targetSx - mesh.scale.x) * ease;
        mesh.scale.y += (targetSy - mesh.scale.y) * ease;
        mesh.scale.z = 1;
        if (faceCamera && cam) {
          mesh.quaternion.copy(cam.quaternion);
        } else if (this.handOpen) {
          mesh.rotation.set(-0.35, 0, 0);
        } else {
          mesh.rotation.set(-Math.PI / 2, 0, 0);
        }
      }

      const mat = mesh.material as THREE.MeshBasicMaterial;
      // Floor stack participates in depth so figure domes can occlude plates.
      // Open hand / throw stays on top of the scene.
      mat.depthTest = !this.handOpen && this.flyingId !== inst.instanceId;
      mat.depthWrite = mat.depthTest;
      mesh.renderOrder = this.handOpen ? 80 + i : 2 + i;
      if (this.handOpen) {
        mat.opacity = inst.used ? 0.4 : disabled ? 0.55 : 1;
      } else {
        mat.opacity =
          usable && !inst.used ? 1 : this.engine.state.phase === 'playing' ? 0.55 : 0.3;
      }
    });

    for (const [id, mesh] of this.plateMeshes) {
      if (!seen.has(id)) {
        this.plateRoot.remove(mesh);
        (mesh.material as THREE.MeshBasicMaterial).map?.dispose();
        (mesh.material as THREE.Material).dispose();
        mesh.geometry.dispose();
        this.plateMeshes.delete(id);
      }
    }

    this.plateRoot.visible = this.engine.state.phase === 'playing';
    if (!usable && this.handOpen) this.collapsePlate();
  }

  private refreshPlateTex(
    mesh: THREE.Mesh,
    inst: PlateInstance,
    name: string,
    cost: number,
    rarity: string,
    description?: string,
    disabled = false,
  ) {
    const detailed = this.handOpen;
    if (
      mesh.userData.used === inst.used &&
      mesh.userData.detailed === detailed &&
      mesh.userData.disabled === disabled
    ) {
      return;
    }
    mesh.userData.used = inst.used;
    mesh.userData.detailed = detailed;
    mesh.userData.disabled = disabled;
    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.map?.dispose();
    mat.map = createPlateCardTexture(
      name,
      cost,
      rarity,
      inst.used,
      description,
      detailed,
      disabled,
    );
    mat.needsUpdate = true;
  }

  pickPlate(raycaster: THREE.Raycaster): string | null {
    const objs = [...this.plateMeshes.values()];
    const hits = raycaster.intersectObjects(objs, false);
    if (!hits.length) return null;
    hits.sort((a, b) => (b.object.renderOrder ?? 0) - (a.object.renderOrder ?? 0));
    return (hits[0].object.userData.plateInstanceId as string) || null;
  }

  punchPlate(instanceId: string) {
    this.punch.set(instanceId, performance.now());
  }

  /** World position of a plate mesh (for throw start). */
  plateWorldPos(instanceId: string): THREE.Vector3 | null {
    const mesh = this.plateMeshes.get(instanceId);
    return mesh ? mesh.position.clone() : null;
  }

  playPlateFly(instanceId: string, toWorld: THREE.Vector3): Promise<void> {
    const mesh = this.plateMeshes.get(instanceId);
    if (!mesh) return Promise.resolve();
    this.flyingId = instanceId;

    // Capture pose in the open hand, then send the rest of the hand home.
    const worldFrom = new THREE.Vector3();
    mesh.getWorldPosition(worldFrom);
    const worldQuat = new THREE.Quaternion();
    mesh.getWorldQuaternion(worldQuat);
    const startScaleX = mesh.scale.x;
    const startScaleY = mesh.scale.y;

    this.collapsePlate();

    const toLocal = toWorld.clone();
    if (mesh.parent) {
      const localFrom = worldFrom.clone();
      mesh.parent.worldToLocal(localFrom);
      mesh.position.copy(localFrom);
      mesh.parent.worldToLocal(toLocal);
      const parentQ = new THREE.Quaternion();
      mesh.parent.getWorldQuaternion(parentQ);
      mesh.quaternion.copy(parentQ.clone().invert().multiply(worldQuat));
    } else {
      mesh.position.copy(worldFrom);
      mesh.quaternion.copy(worldQuat);
    }
    mesh.scale.set(startScaleX, startScaleY, 1);

    return new Promise((resolve) => {
      this.flyAnim = {
        mesh,
        t0: performance.now(),
        from: mesh.position.clone(),
        to: toLocal,
        startScaleX,
        startScaleY,
        resolve,
      };
    });
  }

  private updateFly(_t: number) {
    if (!this.flyAnim) return;
    const { mesh, t0, from, to, startScaleX, startScaleY, resolve } = this.flyAnim;
    const u = Math.min(1, (performance.now() - t0) / 560);
    const e = 1 - Math.pow(1 - u, 3);
    mesh.position.lerpVectors(from, to, e);
    mesh.position.y += Math.sin(e * Math.PI) * 1.2;
    mesh.scale.x = Math.max(0.04, startScaleX * (1 - e * 0.9));
    mesh.scale.y = Math.max(0.04, startScaleY * (1 - e * 0.9));
    mesh.scale.z = 1;
    mesh.rotateZ(0.12);
    if (mesh instanceof THREE.Mesh) {
      (mesh.material as THREE.MeshBasicMaterial).opacity = 1 - e * 0.9;
      (mesh.material as THREE.MeshBasicMaterial).depthTest = false;
      mesh.renderOrder = 200;
    }
    if (u >= 1) {
      const id = this.flyingId;
      this.flyAnim = null;
      this.flyingId = null;
      if (mesh instanceof THREE.Mesh) {
        (mesh.material as THREE.MeshBasicMaterial).opacity = 0.45;
        mesh.rotation.set(-Math.PI / 2, 0, 0);
      }
      if (id) this.restampPlate(id);
      resolve();
    }
  }
}

/** Floor slot between player bench and PC (legacy helper; layout uses BoardView). */
export function plateSlotBetweenBenchAndPc(
  benchRightEdge: number,
  pcFrontX: number,
  zNear: number,
  mirror: number,
): { x: number; z: number; mirror: number } {
  const figureClear = benchRightEdge + mirror * 0.5;
  const nearPc = pcFrontX - mirror * 0.42;
  const x = mirror > 0 ? Math.max(figureClear, nearPc) : Math.min(figureClear, nearPc);
  return { x, z: zNear, mirror };
}
