import * as THREE from 'three';

/** Dark wood grain for the duel board slab — visible planks, still near-black. */
export function createWoodTexture(size = 1024): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Charcoal base (not pure black so grain can lift)
  ctx.fillStyle = '#0c0b0a';
  ctx.fillRect(0, 0, size, size);

  // Vertical plank strips with varied tone
  const plankW = size / 14;
  for (let p = 0; p < 14; p++) {
    const x0 = p * plankW;
    const base = 14 + (p % 3) * 4 + Math.floor(Math.random() * 6);
    for (let x = 0; x < plankW; x++) {
      const edge = Math.min(x, plankW - x) / plankW;
      const darken = edge < 0.04 ? 8 : 0;
      const n =
        Math.sin((x0 + x) * 0.035) * 6 +
        Math.sin((x0 + x) * 0.11) * 4 +
        Math.sin((x0 + x) * 0.4) * 2 +
        (Math.random() - 0.5) * 4;
      const tone = Math.max(6, Math.min(48, base + n - darken));
      ctx.fillStyle = `rgb(${tone},${tone - 1},${tone - 2})`;
      ctx.fillRect(x0 + x, 0, 1, size);
    }
    // Plank seam
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(x0, 0, 1.5, size);
  }

  // Soft wavy grain lines
  for (let k = 0; k < 48; k++) {
    const x0 = Math.random() * size;
    ctx.beginPath();
    for (let y = 0; y < size; y += 2) {
      const x =
        x0 +
        Math.sin(y * 0.016 + k) * 18 +
        Math.sin(y * 0.055) * 8 +
        (Math.random() - 0.5) * 1.5;
      if (y === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    const g = 28 + Math.floor(Math.random() * 22);
    ctx.strokeStyle = `rgba(${g},${g - 1},${g - 3},${0.12 + Math.random() * 0.18})`;
    ctx.lineWidth = 0.6 + Math.random() * 2.4;
    ctx.stroke();
  }

  // Pores / flecks
  for (let i = 0; i < 2200; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.fillStyle = `rgba(0,0,0,${0.2 + Math.random() * 0.4})`;
    ctx.fillRect(x, y, 1, 1 + Math.random() * 2.5);
  }
  for (let i = 0; i < 400; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.fillStyle = `rgba(55,50,45,${0.08 + Math.random() * 0.12})`;
    ctx.fillRect(x, y, 1, 1);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/** Grayscale bump from the same grain pattern for soft relief. */
export function createWoodBumpTexture(size = 512): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);

  const plankW = size / 14;
  for (let p = 0; p < 14; p++) {
    const x0 = p * plankW;
    for (let x = 0; x < plankW; x++) {
      const edge = Math.min(x, plankW - x) / plankW;
      const seam = edge < 0.05 ? 40 : 0;
      const n =
        Math.sin((x0 + x) * 0.04) * 12 +
        Math.sin((x0 + x) * 0.12) * 8 +
        (Math.random() - 0.5) * 6;
      const tone = Math.max(60, Math.min(200, 128 + n - seam));
      ctx.fillStyle = `rgb(${tone},${tone},${tone})`;
      ctx.fillRect(x0 + x, 0, 1, size);
    }
    ctx.fillStyle = '#404040';
    ctx.fillRect(x0, 0, 1.2, size);
  }

  for (let k = 0; k < 30; k++) {
    const x0 = Math.random() * size;
    ctx.beginPath();
    for (let y = 0; y < size; y += 2) {
      const x = x0 + Math.sin(y * 0.018 + k) * 14 + Math.sin(y * 0.05) * 6;
      if (y === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(90,90,90,${0.15 + Math.random() * 0.2})`;
    ctx.lineWidth = 1 + Math.random() * 2;
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}
