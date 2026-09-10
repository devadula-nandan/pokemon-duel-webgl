import * as THREE from 'three';
import type { Piece, SegmentColor, WheelSegment } from '../game/types';

const RARITY_HEX: Record<string, string> = {
  UX: '#ff66cc',
  EX: '#ffc107',
  R: '#b388ff',
  UC: '#64b5f6',
  C: '#cfd8dc',
};

const WHEEL_HEX: Record<SegmentColor, string> = {
  white: '#eceff1',
  gold: '#ffb300',
  purple: '#b388ff',
  blue: '#42a5f5',
  miss: '#455a64',
};

function monogram(name: string): string {
  const parts = name.replace(/[^a-zA-Z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  const compact = name.replace(/[^a-zA-Z0-9]/g, '');
  return (compact.slice(0, 2) || '?').toUpperCase();
}

function paintWheelRing(
  ctx: CanvasRenderingContext2D,
  wheel: WheelSegment[],
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
) {
  const total = Math.max(1, wheel.reduce((s, w) => s + w.size, 0));
  let a = -Math.PI / 2;
  for (const seg of wheel) {
    const span = (seg.size / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, rOuter, a, a + span);
    ctx.arc(cx, cy, rInner, a + span, a, true);
    ctx.closePath();
    ctx.fillStyle = WHEEL_HEX[seg.color] ?? '#78909c';
    ctx.fill();
    a += span;
  }
}

/** Flat disc face: rarity enamel + wheel ring + monogram + rarity chip. */
export function createTokenFaceTexture(piece: Piece): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;
  const rarity = RARITY_HEX[piece.rarity] ?? '#b0bec5';

  ctx.clearRect(0, 0, size, size);

  // Soft outer shadow disc
  ctx.beginPath();
  ctx.arc(cx, cy, 122, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();

  // Wheel color ring (duel “attack profile”)
  paintWheelRing(ctx, piece.wheel, cx, cy, 96, 118);

  // Dark spacer
  ctx.beginPath();
  ctx.arc(cx, cy, 94, 0, Math.PI * 2);
  ctx.fillStyle = '#1a2330';
  ctx.fill();

  // Rarity enamel face
  const grad = ctx.createRadialGradient(cx - 28, cy - 36, 8, cx, cy, 90);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.18, rarity);
  grad.addColorStop(1, shade(rarity, -0.35));
  ctx.beginPath();
  ctx.arc(cx, cy, 88, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // Subtle engraved rings
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 78, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.arc(cx, cy, 62, 0, Math.PI * 2);
  ctx.stroke();

  // Monogram
  const letters = monogram(piece.name);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 78px "Outfit", system-ui, sans-serif';
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillText(letters, cx + 2, cy + 6);
  ctx.fillStyle = '#0d1520';
  ctx.fillText(letters, cx, cy + 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.5;
  ctx.strokeText(letters, cx, cy + 2);

  // Rarity chip
  const chip = piece.rarity.slice(0, 3).toUpperCase();
  ctx.font = '700 18px "JetBrains Mono", monospace';
  const tw = ctx.measureText(chip).width;
  const padX = 10;
  const chipW = tw + padX * 2;
  const chipH = 22;
  const chipX = cx - chipW / 2;
  const chipY = cy + 48;
  roundRect(ctx, chipX, chipY, chipW, chipH, 6);
  ctx.fillStyle = 'rgba(13,21,32,0.82)';
  ctx.fill();
  ctx.strokeStyle = rarity;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = rarity;
  ctx.fillText(chip, cx, chipY + chipH / 2 + 1);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function createMpBadgeTexture(mp: number, teamCss: string): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  // Opaque fill so the decal never goes blank
  ctx.fillStyle = teamCss;
  ctx.fillRect(0, 0, size, size);

  ctx.beginPath();
  ctx.arc(64, 64, 56, 0, Math.PI * 2);
  ctx.fillStyle = teamCss;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(64, 64, 48, 0, Math.PI * 2);
  ctx.stroke();

  const label = String(mp);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 64px system-ui, sans-serif';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 8;
  ctx.strokeText(label, 64, 68);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, 64, 68);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Black wait badge: stop-hand + wait count. */
export function createWaitBadgeTexture(wait: number): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, size, size);

  ctx.beginPath();
  ctx.arc(64, 64, 56, 0, Math.PI * 2);
  ctx.fillStyle = '#111111';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 5;
  ctx.stroke();

  // Compact stop hand above the count
  ctx.save();
  ctx.translate(64, 38);
  ctx.scale(0.42, 0.42);
  ctx.translate(-64, -64);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  roundRect(ctx, 42, 58, 36, 34, 10);
  ctx.fill();
  ctx.beginPath();
  roundRect(ctx, 28, 68, 16, 22, 8);
  ctx.fill();
  for (const [x, y, w, h] of [
    [44, 28, 10, 36],
    [56, 22, 10, 42],
    [68, 24, 10, 40],
    [80, 32, 10, 32],
  ] as const) {
    ctx.beginPath();
    roundRect(ctx, x, y, w, h, 5);
    ctx.fill();
  }
  ctx.restore();

  const label = String(Math.max(1, Math.floor(wait)));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 52px system-ui, sans-serif';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.65)';
  ctx.lineWidth = 7;
  ctx.strokeText(label, 64, 86);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, 64, 86);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const STATUS_DOT: Record<string, string> = {
  poison: '#ab47bc',
  noxious: '#6a1b9a',
  paralysis: '#fdd835',
  sleep: '#90caf9',
  frozen: '#4fc3f7',
  burn: '#ff7043',
  confusion: '#f48fb1',
  curse: '#212121',
};

/** Compact status icon strip for token billboards. */
export function createStatusIconsTexture(statuses: string[]): THREE.CanvasTexture {
  const w = 256;
  const h = 64;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  const list = statuses.slice(0, 6);
  const r = 14;
  const gap = 6;
  const total = list.length * (r * 2) + Math.max(0, list.length - 1) * gap;
  let x = (w - total) / 2 + r;
  for (const s of list) {
    ctx.beginPath();
    ctx.arc(x, h / 2, r, 0, Math.PI * 2);
    ctx.fillStyle = STATUS_DOT[s] ?? '#fff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s[0]!.toUpperCase(), x, h / 2 + 1);
    x += r * 2 + gap;
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Transparent wrap: plain white letters on the team-colored base. */
export function createNameBandTexture(name: string): THREE.CanvasTexture {
  // Match cylinder unwrap aspect (~circumference / band height ≈ 16:1)
  const w = 2048;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);

  const label = name.length > 16 ? `${name.slice(0, 15)}…` : name;
  const line = `${label}      ·      ${label}      ·      `;
  // ~80% of band height, light weight
  ctx.font = '500 102px "Outfit", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(line, w / 2, h / 2 + 3);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}


function shade(hex: string, amount: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  hsl.l = Math.max(0, Math.min(1, hsl.l + amount));
  c.setHSL(hsl.h, hsl.s, hsl.l);
  return `#${c.getHexString()}`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
