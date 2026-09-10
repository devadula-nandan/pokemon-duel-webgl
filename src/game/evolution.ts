/**
 * Mid-duel evolution / Mega helpers (Phase 3).
 * Mega is applied via mega stone plates in plates.ts + engine.applyMega.
 * This module covers chain-level evolution stubs for Molting Energy–style flows.
 */

import type { FigureDef, Piece } from './types';

/** Simple name-based evolution map for common chains in the current roster. */
const EVO: Record<string, string> = {
  Charmander: 'Charmeleon',
  Charmeleon: 'Charizard',
  Squirtle: 'Wartortle',
  Wartortle: 'Blastoise',
  Bulbasaur: 'Ivysaur',
  Ivysaur: 'Venusaur',
  Rattata: 'Raticate',
  Machop: 'Machoke',
  Machoke: 'Machamp',
  Geodude: 'Graveler',
  Graveler: 'Golem',
  Dratini: 'Dragonair',
  Dragonair: 'Dragonite',
  Magnemite: 'Magneton',
  Haunter: 'Gengar',
};

export function nextEvolutionName(name: string): string | null {
  return EVO[name] ?? null;
}

export function tryEvolvePiece(
  piece: Piece,
  defsByName: Map<string, FigureDef>,
  waitAfter = 3,
): boolean {
  const next = nextEvolutionName(piece.name.replace(/^Mega\s+/, ''));
  if (!next) return false;
  const def = defsByName.get(next);
  if (!def) return false;
  piece.name = def.name;
  piece.defId = def.id;
  piece.baseMp = def.mp;
  piece.mp = def.mp;
  piece.wheel = def.wheel.map((w) => ({ ...w }));
  piece.rarity = def.rarity;
  piece.ability = def.ability ?? null;
  piece.types = def.types ? [...def.types] : undefined;
  piece.wait = Math.max(piece.wait, waitAfter);
  return true;
}

/** Z-Move placeholder: convert highest white to a gold Z attack for one battle. */
export function applyZMoveBuff(piece: Piece): void {
  let best = -1;
  let idx = -1;
  piece.wheel.forEach((w, i) => {
    if (w.color === 'white' && w.damage > best) {
      best = w.damage;
      idx = i;
    }
  });
  if (idx < 0) return;
  const w = piece.wheel[idx];
  piece.wheel[idx] = {
    ...w,
    name: `Z-${w.name}`,
    color: 'gold',
    damage: w.damage + 50,
  };
}
