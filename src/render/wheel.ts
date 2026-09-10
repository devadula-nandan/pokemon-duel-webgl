import type { WheelSegment } from '../game/types';

/** Official Pokémon Duel wheel palette */
const COLORS: Record<string, string> = {
  white: '#f3f4f6',
  gold: '#ffc107',
  purple: '#b24dff',
  blue: '#4fc3f7',
  miss: '#e53935',
};

function drawArcText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  radius: number,
  midAngle: number,
  maxSweep: number,
  fill: string,
  fontSize: number,
) {
  const chars = [...text];
  if (!chars.length) return;
  const charAngle = fontSize / radius;
  const total = Math.min(maxSweep * 0.82, charAngle * chars.length);
  let a = midAngle - total / 2;
  const step = chars.length > 1 ? total / (chars.length - 1) : 0;
  ctx.fillStyle = fill;
  ctx.font = `800 ${fontSize}px Outfit, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const ch of chars) {
    const x = cx + Math.cos(a) * radius;
    const y = cy + Math.sin(a) * radius;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    a += step;
  }
}

export function createWheelCanvas(
  segments: WheelSegment[],
  size = 720,
  opts?: { damageBonus?: number },
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.floor(size * dpr);
  canvas.height = Math.floor(size * dpr);
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);

  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.495;
  const rim = size * 0.028;
  const innerR = r - rim;
  const total = segments.reduce((s, x) => s + x.size, 0) || 96;
  const damageBonus = opts?.damageBonus ?? 0;

  // Soft contact shadow
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();

  // Thick black rim (official disc look)
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#0d0d0d';
  ctx.fill();

  let angle = -Math.PI / 2;
  for (const seg of segments) {
    const sweep = (seg.size / total) * Math.PI * 2;
    const mid = angle + sweep / 2;
    const fill = COLORS[seg.color] || '#888';
    const darkText = seg.color === 'white' || seg.color === 'gold' || seg.color === 'blue';

    // Segment wedge (base)
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, innerR, angle, angle + sweep);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();

    // Zebra radial stripes (official duel disc look)
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, innerR, angle, angle + sweep);
    ctx.closePath();
    ctx.clip();
    const stripeCount = Math.max(10, Math.floor((seg.size / total) * 140));
    const zebraDark =
      seg.color === 'white'
        ? 'rgba(0, 0, 0, 0.05)'
        : seg.color === 'gold'
          ? 'rgba(0, 0, 0, 0.06)'
          : seg.color === 'blue'
            ? 'rgba(0, 0, 0, 0.06)'
            : seg.color === 'purple'
              ? 'rgba(0, 0, 0, 0.07)'
              : 'rgba(0, 0, 0, 0.05)';
    for (let i = 0; i < stripeCount; i++) {
      if (i % 2 === 0) continue;
      const a0 = angle + (sweep * i) / stripeCount;
      const a1 = angle + (sweep * (i + 1)) / stripeCount;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, innerR, a0, a1);
      ctx.closePath();
      ctx.fillStyle = zebraDark;
      ctx.fill();
    }
    ctx.restore();

    // Segment divider
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = Math.max(1.5, size * 0.0025);
    ctx.stroke();

    const ink = darkText ? '#111111' : '#ffffff';
    const name = seg.name || '';

    if (seg.color === 'miss') {
      drawArcText(
        ctx,
        'Miss',
        cx,
        cy,
        innerR * 0.9,
        mid,
        sweep,
        ink,
        Math.max(16, Math.min(34, sweep * innerR * 0.42)),
      );
    } else if (seg.color === 'blue') {
      drawArcText(
        ctx,
        name.slice(0, 16),
        cx,
        cy,
        innerR * 0.9,
        mid,
        sweep,
        ink,
        Math.max(15, Math.min(30, sweep * innerR * 0.36)),
      );
    } else if (seg.color === 'purple') {
      const stars = '★'.repeat(Math.max(1, seg.stars || 1));
      drawArcText(
        ctx,
        `${name.slice(0, 12)} ${stars}`,
        cx,
        cy,
        innerR * 0.9,
        mid,
        sweep,
        ink,
        Math.max(14, Math.min(28, sweep * innerR * 0.34)),
      );
    } else {
      // White / gold: big damage + curved move name near the rim
      const base = seg.damage ?? 0;
      const shown = base + (seg.color === 'white' || seg.color === 'gold' ? damageBonus : 0);
      const dmg =
        seg.color === 'gold' && base
          ? `${shown}*`
          : String(shown);
      const dmgSize = Math.max(22, Math.min(64, sweep * innerR * 0.55));
      ctx.save();
      ctx.translate(cx + Math.cos(mid) * innerR * 0.42, cy + Math.sin(mid) * innerR * 0.42);
      ctx.rotate(mid + Math.PI / 2);
      ctx.fillStyle = ink;
      ctx.font = `900 ${dmgSize}px Outfit, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(3, dmgSize * 0.08);
      ctx.strokeStyle = seg.color === 'white' ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.35)';
      ctx.strokeText(dmg, 0, 0);
      ctx.fillText(dmg, 0, 0);
      // Rising bonus flash
      if (damageBonus > 0 && (seg.color === 'white' || seg.color === 'gold') && base > 0) {
        ctx.fillStyle = '#ff6b35';
        ctx.font = `800 ${Math.max(12, dmgSize * 0.38)}px Outfit, system-ui, sans-serif`;
        ctx.fillText(`+${Math.round(damageBonus)}`, 0, dmgSize * 0.55);
      }
      ctx.restore();

      if (name) {
        const label = seg.color === 'gold' ? `${name} *` : name;
        drawArcText(
          ctx,
          label.slice(0, 18),
          cx,
          cy,
          innerR * 0.9,
          mid,
          sweep,
          ink,
          Math.max(14, Math.min(26, sweep * innerR * 0.3)),
        );
      }
    }

    angle += sweep;
  }

  // Final divider for last edge
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = Math.max(1.5, size * 0.0025);
  ctx.stroke();

  // Inner rim ring
  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
  ctx.strokeStyle = '#0d0d0d';
  ctx.lineWidth = Math.max(2, size * 0.004);
  ctx.stroke();

  // Hub
  const hub = r * 0.085;
  ctx.beginPath();
  ctx.arc(cx, cy, hub, 0, Math.PI * 2);
  ctx.fillStyle = '#0a0a0a';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, hub * 0.55, 0, Math.PI * 2);
  ctx.strokeStyle = '#333';
  ctx.lineWidth = Math.max(2, size * 0.003);
  ctx.stroke();

  return canvas;
}

/**
 * Count white/gold damage up by `damageBonus` on an existing battle disc
 * canvas (e.g. X Attack) before the spin starts.
 */
export function animateWheelDamageBoost(
  canvas: HTMLCanvasElement,
  segments: WheelSegment[],
  size: number,
  damageBonus: number,
  durationMs = 1000,
): Promise<void> {
  if (!(damageBonus > 0)) return Promise.resolve();

  const paint = (bonus: number) => {
    const painted = createWheelCanvas(segments, size, { damageBonus: bonus });
    const ctx = canvas.getContext('2d')!;
    canvas.width = painted.width;
    canvas.height = painted.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(painted, 0, 0);
  };

  paint(0);
  const t0 = performance.now();
  return new Promise((resolve) => {
    const frame = (now: number) => {
      const u = Math.min(1, (now - t0) / durationMs);
      const e = 1 - Math.pow(1 - u, 3);
      paint(Math.round(damageBonus * e));
      if (u < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
}

/**
 * Spin so the result segment lands under the pointer.
 * pointerDeg: 0 = top of wheel, 90 = right, 180 = bottom, 270 = left.
 * Diagonal duel layout uses ~225 (top-right wheel → center) and ~45 (bottom-left → center).
 */
export async function animateWheelSpin(
  el: HTMLElement,
  segments: WheelSegment[],
  result: WheelSegment,
  pointerDeg = 0,
  durationMs = 2700,
): Promise<void> {
  const total = segments.reduce((s, x) => s + x.size, 0) || 96;
  let acc = 0;
  let idx = segments.indexOf(result);
  if (idx < 0) idx = segments.findIndex((s) => s.name === result.name && s.color === result.color);
  for (let i = 0; i < Math.max(0, idx); i++) acc += segments[i].size;
  const mid = acc + result.size / 2;
  const deg = 360 - (mid / total) * 360 + pointerDeg + 360 * 6;

  el.style.transition = 'none';
  el.style.transform = 'rotate(0deg)';
  void el.offsetWidth;
  el.style.transition = `transform ${durationMs}ms cubic-bezier(0.1, 0.7, 0.08, 1)`;
  el.style.transform = `rotate(${deg}deg)`;

  await new Promise((r) => setTimeout(r, durationMs + 50));
}
