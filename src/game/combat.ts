import type { DuelEngine } from './engine';
import type { Piece, SegmentColor, Status, TurnBuff, WheelSegment } from './types';

/** Official color outcomes from Pokemon.com strategy guide. */
export function spinWheel(wheel: WheelSegment[]): WheelSegment {
  const total = wheel.reduce((s, seg) => s + Math.max(0, seg.size), 0) || 1;
  let r = Math.random() * total;
  for (const seg of wheel) {
    r -= Math.max(0, seg.size);
    if (r <= 0) return seg;
  }
  return wheel[wheel.length - 1];
}

function segmentIndex(wheel: WheelSegment[], seg: WheelSegment): number {
  const i = wheel.indexOf(seg);
  if (i >= 0) return i;
  return wheel.findIndex((s) => s.name === seg.name && s.color === seg.color && s.size === seg.size);
}

/** Confusion: next segment clockwise from the spun result. */
export function applyConfusion(wheel: WheelSegment[], seg: WheelSegment): WheelSegment {
  const idx = segmentIndex(wheel, seg);
  if (idx < 0) return seg;
  return wheel[(idx + 1) % wheel.length];
}

/** Paralysis / Burn: convert the smallest non-miss segment into Miss for this battle. */
export function applySmallestBecomesMiss(wheel: WheelSegment[]): WheelSegment[] {
  const candidates = wheel
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.color !== 'miss');
  if (!candidates.length) return wheel.map((s) => ({ ...s }));
  candidates.sort((a, b) => a.s.size - b.s.size || a.i - b.i);
  const target = candidates[0].i;
  return wheel.map((s, i) =>
    i === target ? { ...s, name: 'Miss', color: 'miss' as SegmentColor, damage: 0, stars: 0 } : { ...s },
  );
}

export function battleWheelFor(piece: Piece): WheelSegment[] {
  let wheel = piece.wheel.map((s) => ({ ...s }));
  if (piece.statuses.includes('paralysis') || piece.statuses.includes('burn')) {
    wheel = applySmallestBecomesMiss(wheel);
  }
  return wheel;
}

/** X Speed: convert one white attack to gold. */
export function applyTurnBuffToWheel(wheel: WheelSegment[], buff?: TurnBuff): WheelSegment[] {
  if (!buff?.whiteToGold) return wheel;
  let done = false;
  return wheel.map((s) => {
    if (!done && s.color === 'white' && s.damage > 0) {
      done = true;
      return { ...s, color: 'gold' as SegmentColor };
    }
    return { ...s };
  });
}

export function prepareSpin(piece: Piece, wheel: WheelSegment[]): WheelSegment {
  if (piece.statuses.includes('frozen')) {
    return { name: 'Miss', color: 'miss', size: 96, damage: 0, stars: 0 };
  }
  let seg = spinWheel(wheel);
  if (piece.statuses.includes('confusion')) {
    seg = applyConfusion(wheel, seg);
  }
  return seg;
}

/** Multi-spin white attacks (multiply: true). */
export function resolveMultiplyDamage(seg: WheelSegment, wheel: WheelSegment[]): WheelSegment {
  if (!seg.multiply || (seg.color !== 'white' && seg.color !== 'gold')) return seg;
  // Spin again up to 2 extra times; sum damage while landing same-name or any white
  let total = seg.damage;
  const spins = 1 + Math.floor(Math.random() * 3); // 1–3 hits typical
  for (let i = 1; i < spins; i++) {
    const extra = spinWheel(wheel);
    if (extra.color === 'white' || extra.color === 'gold') total += extra.damage;
  }
  return { ...seg, damage: total, name: `${seg.name} ×${spins}` };
}

export function effectiveDamage(piece: Piece, seg: WheelSegment): number {
  if (seg.color !== 'white' && seg.color !== 'gold') return 0;
  let dmg = seg.damage;
  if (piece.statuses.includes('poison')) dmg -= 20;
  if (piece.statuses.includes('noxious')) dmg -= 40;
  if (piece.statuses.includes('burn')) dmg -= 10;
  return Math.max(0, dmg);
}

export function effectiveDamageWithBuffs(
  piece: Piece,
  seg: WheelSegment,
  buff?: TurnBuff,
): number {
  let dmg = effectiveDamage(piece, seg);
  if (buff?.damageBonus && (seg.color === 'white' || seg.color === 'gold')) {
    dmg += buff.damageBonus;
  }
  return Math.max(0, dmg);
}

export type BattleOutcome =
  | { type: 'draw'; note: string }
  | { type: 'ko'; winner: 'attacker' | 'defender'; note: string; damageDealt?: number }
  | { type: 'blue'; note: string; user: 'attacker' | 'defender' | 'both'; spin: WheelSegment }
  | {
      type: 'purple';
      winner: 'attacker' | 'defender';
      note: string;
      effect: string;
      spin: WheelSegment;
    };

export function shouldBlockKo(
  _loser: Piece,
  buff: TurnBuff | undefined,
  outcome: BattleOutcome,
): boolean {
  if (buff?.cannotKo) return true;
  if (buff?.xDefend && outcome.type === 'ko') {
    const dmg = outcome.damageDealt ?? 0;
    if (dmg >= 10 && dmg <= 100) return true;
  }
  return false;
}

/**
 * Resolve one battle per official color rules.
 * Blue beats all. Gold beats Purple. Purple beats White. White/Gold compare damage.
 */
export function resolveBattle(
  attacker: Piece,
  defender: Piece,
  aSpin: WheelSegment,
  dSpin: WheelSegment,
  dmgFn: (p: Piece, seg: WheelSegment) => number = effectiveDamage,
): BattleOutcome {
  const a = aSpin.color;
  const d = dSpin.color;

  if (a === 'miss' && d === 'miss') {
    return { type: 'draw', note: 'Both missed — draw.' };
  }
  if (a === 'miss') return winFromColor('defender', defender, attacker, dSpin);
  if (d === 'miss') return winFromColor('attacker', attacker, defender, aSpin);

  if (a === 'blue' && d === 'blue') {
    return { type: 'blue', note: 'Blue vs Blue — draw.', user: 'both', spin: aSpin };
  }
  if (a === 'blue') {
    return {
      type: 'blue',
      note: `${attacker.name} spun Blue (${aSpin.name}).`,
      user: 'attacker',
      spin: aSpin,
    };
  }
  if (d === 'blue') {
    return {
      type: 'blue',
      note: `${defender.name} spun Blue (${dSpin.name}).`,
      user: 'defender',
      spin: dSpin,
    };
  }

  if (a === 'gold' && d === 'purple') {
    if (dmgFn(attacker, aSpin) > 0) {
      return {
        type: 'ko',
        winner: 'attacker',
        note: `${attacker.name}'s Gold beats Purple.`,
        damageDealt: dmgFn(attacker, aSpin),
      };
    }
    return {
      type: 'draw',
      note: `${attacker.name}'s Gold (0 dmg) vs Purple — no KO.`,
    };
  }
  if (d === 'gold' && a === 'purple') {
    if (dmgFn(defender, dSpin) > 0) {
      return {
        type: 'ko',
        winner: 'defender',
        note: `${defender.name}'s Gold beats Purple.`,
        damageDealt: dmgFn(defender, dSpin),
      };
    }
    return {
      type: 'draw',
      note: `${defender.name}'s Gold (0 dmg) vs Purple — no KO.`,
    };
  }

  if (a === 'purple' && d === 'white') {
    return {
      type: 'purple',
      winner: 'attacker',
      note: `${attacker.name}'s Purple beats White.`,
      effect: aSpin.effect || aSpin.name,
      spin: aSpin,
    };
  }
  if (d === 'purple' && a === 'white') {
    return {
      type: 'purple',
      winner: 'defender',
      note: `${defender.name}'s Purple beats White.`,
      effect: dSpin.effect || dSpin.name,
      spin: dSpin,
    };
  }

  if (a === 'purple' && d === 'purple') {
    if (aSpin.stars === dSpin.stars) {
      return { type: 'draw', note: `Purple ★ tie (${aSpin.stars}).` };
    }
    const winner = aSpin.stars > dSpin.stars ? 'attacker' : 'defender';
    const spin = winner === 'attacker' ? aSpin : dSpin;
    return {
      type: 'purple',
      winner,
      note: `Purple ${spin.stars}★ wins.`,
      effect: spin.effect || spin.name,
      spin,
    };
  }

  if (
    (a === 'white' || a === 'gold') &&
    (d === 'white' || d === 'gold')
  ) {
    const ad = dmgFn(attacker, aSpin);
    const dd = dmgFn(defender, dSpin);
    if (ad === dd) return { type: 'draw', note: `Damage tie (${ad}).` };
    if (ad > dd) {
      return {
        type: 'ko',
        winner: 'attacker',
        note: `${attacker.name} ${ad} > ${dd}.`,
        damageDealt: ad,
      };
    }
    return {
      type: 'ko',
      winner: 'defender',
      note: `${defender.name} ${dd} > ${ad}.`,
      damageDealt: dd,
    };
  }

  return { type: 'draw', note: 'Unresolved clash — draw.' };
}

function winFromColor(
  side: 'attacker' | 'defender',
  winner: Piece,
  _loser: Piece,
  winSpin: WheelSegment,
): BattleOutcome {
  if (winSpin.color === 'blue') {
    return {
      type: 'blue',
      note: `${winner.name} spun Blue.`,
      user: side,
      spin: winSpin,
    };
  }
  if (winSpin.color === 'purple') {
    return {
      type: 'purple',
      winner: side,
      note: `${winner.name}'s Purple wins.`,
      effect: winSpin.effect || winSpin.name,
      spin: winSpin,
    };
  }
  if (winSpin.color === 'white' || winSpin.color === 'gold') {
    return {
      type: 'ko',
      winner: side,
      note: `${winner.name} wins (${winSpin.name}).`,
      damageDealt: winSpin.damage,
    };
  }
  return { type: 'draw', note: 'Draw.' };
}

const STATUS_WORDS: { re: RegExp; status: Status }[] = [
  { re: /noxious/i, status: 'noxious' },
  { re: /poison/i, status: 'poison' },
  { re: /paraly/i, status: 'paralysis' },
  { re: /sleep|asleep/i, status: 'sleep' },
  { re: /frozen|freeze/i, status: 'frozen' },
  { re: /burn/i, status: 'burn' },
  { re: /confus/i, status: 'confusion' },
  { re: /curse/i, status: 'curse' },
];

export function applyPurpleEffect(
  effect: string,
  target: Piece,
  _engine?: DuelEngine,
): string {
  const e = effect || '';
  const notes: string[] = [];

  for (const { re, status } of STATUS_WORDS) {
    if (re.test(e)) {
      if (!target.statuses.includes(status)) target.statuses.push(status);
      notes.push(`${target.name} → ${status}`);
    }
  }

  if (/wait/i.test(e)) {
    const m = e.match(/wait\s*(\d+)/i);
    const w = m ? parseInt(m[1], 10) : 3;
    target.wait = Math.max(target.wait, w);
    notes.push(`${target.name} Wait ${target.wait}`);
  }

  if (/mp\s*-?\s*1|mp-1|slows|string/i.test(e)) {
    target.mpMarkers += 1;
    notes.push(`${target.name} MP−1`);
  }

  if (/bench/i.test(e)) {
    notes.push('BENCH');
  }

  if (/knock\s*back|blow\s*away|whirlwind|pushed/i.test(e)) {
    notes.push('KNOCKBACK');
  }

  if (/knock\s*out|faint|exclude/i.test(e) && !notes.includes('BENCH')) {
    // Range KO text — mark for engine; generic Wait if no engine context
    notes.push('RANGE_KO');
  }

  if (!notes.length) {
    target.wait = Math.max(target.wait, 2);
    notes.push(`${target.name} Wait 2 (${e.slice(0, 40) || 'purple'})`);
  }

  return notes.join('; ');
}

/**
 * Lightweight ability tags from free-text ability strings.
 */
export function applyAbilityPassives(piece: Piece, mode: 'mpBonus'): number;
export function applyAbilityPassives(piece: Piece, mode: 'surroundImmune'): boolean;
export function applyAbilityPassives(piece: Piece, mode: 'start'): number;
export function applyAbilityPassives(
  piece: Piece,
  mode: 'start' | 'mpBonus' | 'surroundImmune',
): number | boolean {
  const text = (piece.ability || '').toLowerCase();
  if (!text) {
    if (mode === 'mpBonus') return 0;
    if (mode === 'surroundImmune') return false;
    return 0;
  }
  if (mode === 'mpBonus') {
    if (/mp\s*\+?\s*1|plus 1 mp|\+1 mp/i.test(text)) return 1;
    return 0;
  }
  if (mode === 'surroundImmune') {
    return /cannot be surrounded|immune to surround|infiltrator/i.test(text);
  }
  return 0;
}

export function canInitiateBattle(piece: Piece): boolean {
  if (piece.wait > 0) return false;
  if (piece.statuses.includes('sleep')) return false;
  if (piece.statuses.includes('frozen')) return false;
  return true;
}

export function canMove(piece: Piece): boolean {
  if (piece.wait > 0) return false;
  if (piece.statuses.includes('frozen')) return false;
  return true;
}

export const TOUCH_CURABLE: Status[] = [
  'poison',
  'noxious',
  'paralysis',
  'burn',
  'confusion',
  'sleep',
  'frozen',
];
