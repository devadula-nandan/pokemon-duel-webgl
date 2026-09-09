/**
 * Lightweight combat rule tests (run via `npx tsx src/game/combat.test.ts`).
 */
import {
  applyConfusion,
  applySmallestBecomesMiss,
  effectiveDamage,
  resolveBattle,
} from './combat';
import type { Piece, WheelSegment } from './types';

function seg(
  color: WheelSegment['color'],
  damage = 0,
  stars = 0,
  name = color,
): WheelSegment {
  return { name, color, size: 24, damage, stars };
}

function piece(name: string, statuses: Piece['statuses'] = []): Piece {
  return {
    uid: name,
    defId: 1,
    name,
    owner: 'player',
    mp: 2,
    baseMp: 2,
    rarity: 'C',
    wheel: [],
    nodeId: null,
    location: 'field',
    benchSlot: 0,
    wait: 0,
    statuses,
    mpMarkers: 0,
    removed: false,
  };
}

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log('✓', msg);
  } else {
    failed++;
    console.error('✗', msg);
  }
}

const A = piece('A');
const B = piece('B');

// Blue beats gold
{
  const o = resolveBattle(A, B, seg('blue'), seg('gold', 100));
  assert(o.type === 'blue', 'Blue beats Gold');
}

// Gold beats purple
{
  const o = resolveBattle(A, B, seg('gold', 50), seg('purple', 0, 3));
  assert(o.type === 'ko' && o.winner === 'attacker', 'Gold beats Purple (KO)');
}

// Purple beats white
{
  const o = resolveBattle(A, B, seg('purple', 0, 2), seg('white', 120));
  assert(o.type === 'purple' && o.winner === 'attacker', 'Purple beats White');
}

// White vs gold damage
{
  const o = resolveBattle(A, B, seg('white', 70), seg('gold', 50));
  assert(o.type === 'ko' && o.winner === 'attacker', 'White 70 > Gold 50');
}

// Damage tie
{
  const o = resolveBattle(A, B, seg('white', 40), seg('white', 40));
  assert(o.type === 'draw', 'White damage tie');
}

// Purple star tie
{
  const o = resolveBattle(A, B, seg('purple', 0, 2), seg('purple', 0, 2));
  assert(o.type === 'draw', 'Purple ★ tie');
}

// Miss loses
{
  const o = resolveBattle(A, B, seg('miss'), seg('white', 10));
  assert(o.type === 'ko' && o.winner === 'defender', 'Miss loses to White');
}

// Poison damage
{
  const p = piece('P', ['poison']);
  assert(effectiveDamage(p, seg('white', 50)) === 30, 'Poison −20');
}

// Confusion clockwise
{
  const wheel = [seg('white', 10, 0, 'A'), seg('miss', 0, 0, 'B'), seg('blue', 0, 0, 'C')];
  const next = applyConfusion(wheel, wheel[0]);
  assert(next.name === 'B', 'Confusion → next clockwise');
}

// Smallest becomes miss
{
  const wheel = [
    { name: 'Big', color: 'white' as const, size: 40, damage: 100, stars: 0 },
    { name: 'Small', color: 'gold' as const, size: 8, damage: 30, stars: 0 },
    { name: 'X', color: 'miss' as const, size: 48, damage: 0, stars: 0 },
  ];
  const w2 = applySmallestBecomesMiss(wheel);
  assert(w2[1].color === 'miss' && w2[1].name === 'Miss', 'Paralysis/Burn: smallest → Miss');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
