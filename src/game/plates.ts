import platesData from '../data/plates.json';
import { entryNodes, goalNode, neighbors } from './board';
import type { DuelEngine } from './engine';
import type {
  PlateDef,
  PlateInstance,
  PlateTargeting,
  PlayerId,
  Status,
  TurnBuff,
} from './types';

export const PLATES = platesData as PlateDef[];
export const PLATE_BY_ID = new Map(PLATES.map((p) => [p.id, p]));

export const MAX_PLATE_COST = 8;

let plateInstanceCounter = 0;
export function makePlateInstances(ids: number[]): PlateInstance[] {
  return ids.map((plateId) => ({
    instanceId: `pl${++plateInstanceCounter}`,
    plateId,
    used: false,
  }));
}

export function resetPlateInstanceCounter() {
  plateInstanceCounter = 0;
}

export function plateCost(ids: number[]): number {
  return ids.reduce((s, id) => s + (PLATE_BY_ID.get(id)?.cost ?? 0), 0);
}

export function isValidPlateDeck(ids: number[]): boolean {
  if (ids.length > 6) return false;
  return plateCost(ids) <= MAX_PLATE_COST;
}

export const DEFAULT_PLAYER_PLATES = [12, 10, 7, 11]; // X Attack, Full Heal, Double Chance, Scoop Up = 4
export const DEFAULT_AI_PLATES = [12, 23, 20, 14]; // X Attack, Antidote, Awakening, Swap Spot = 4

export function getPlateDef(instance: PlateInstance): PlateDef | undefined {
  return PLATE_BY_ID.get(instance.plateId);
}

export function platesFor(engine: DuelEngine, owner: PlayerId): PlateInstance[] {
  return owner === 'player' ? engine.state.playerPlates : engine.state.opponentPlates;
}

export function canUsePlatesNow(engine: DuelEngine, owner: PlayerId): boolean {
  const s = engine.state;
  return (
    s.phase === 'playing' &&
    s.turn === owner &&
    s.turnStep === 'choose' &&
    s.plateWindowOpen &&
    !s.movedUid
  );
}

/** True if this specific plate instance can be played right now. */
export function canUsePlateInstance(
  engine: DuelEngine,
  owner: PlayerId,
  instanceId: string,
): boolean {
  if (!canUsePlatesNow(engine, owner)) return false;
  const inst = platesFor(engine, owner).find((p) => p.instanceId === instanceId);
  if (!inst || inst.used) return false;
  const def = getPlateDef(inst);
  if (!def) return false;
  if (def.targeting === 'none') return true;
  return validTargets(engine, owner, def.targeting, def).length > 0;
}

export function validTargets(
  engine: DuelEngine,
  owner: PlayerId,
  targeting: PlateTargeting,
  def?: PlateDef,
  ctx?: { stepFirstUid?: string | null },
): string[] {
  const mine = engine.activePieces(owner);
  switch (targeting) {
    case 'none':
      return [];
    case 'own-bench':
      return mine.filter((p) => p.location === 'bench').map((p) => p.uid);
    case 'own-field': {
      let list = mine.filter((p) => p.location === 'field');
      if (def?.effectId === 'mega_evolve' && def.megaSpecies) {
        list = list.filter((p) => p.name === def.megaSpecies);
        if (mine.some((p) => (p.megaTurnsLeft ?? 0) > 0)) return [];
      }
      return list.map((p) => p.uid);
    }
    case 'own-pc':
      return mine.filter((p) => p.location === 'pc').map((p) => p.uid);
    case 'own-any':
      return mine
        .filter((p) => p.location === 'bench' || p.location === 'field')
        .map((p) => p.uid);
    case 'own-switch':
    case 'own-field-pair':
      return mine
        .filter((p) =>
          targeting === 'own-field-pair'
            ? p.location === 'field'
            : p.location === 'bench' || p.location === 'field',
        )
        .map((p) => p.uid);
    case 'hurdle-jump': {
      const first = ctx?.stepFirstUid;
      if (!first) {
        return mine
          .filter((p) => p.location === 'field' && p.nodeId && hurdleOptions(engine, p.uid).length > 0)
          .map((p) => p.uid);
      }
      return [...new Set(hurdleOptions(engine, first).map((o) => o.hurdleUid))];
    }
    default:
      return [];
  }
}

/** Valid hurdle jumps from a field figure: over an adjacent piece onto an empty point beyond. */
export function hurdleOptions(
  engine: DuelEngine,
  jumperUid: string,
): { hurdleUid: string; landNodeId: string }[] {
  const jumper = engine.piece(jumperUid);
  if (!jumper?.nodeId || jumper.location !== 'field') return [];
  const from = jumper.nodeId;
  const occ = engine.occupied();
  const fromNode = engine.board.nodes.get(from);
  const out: { hurdleUid: string; landNodeId: string; score: number }[] = [];

  for (const mid of neighbors(engine.board.edges, from)) {
    const hurdle = engine.piecesAt(mid)[0];
    if (!hurdle || hurdle.removed) continue;
    const midNode = engine.board.nodes.get(mid);
    for (const land of neighbors(engine.board.edges, mid)) {
      if (land === from || occ.has(land)) continue;
      let score = 0;
      if (fromNode && midNode) {
        const landNode = engine.board.nodes.get(land);
        if (landNode) {
          const dx = midNode.x - fromNode.x;
          const dy = midNode.y - fromNode.y;
          const lx = landNode.x - midNode.x;
          const ly = landNode.y - midNode.y;
          score = dx * lx + dy * ly;
        }
      }
      out.push({ hurdleUid: hurdle.uid, landNodeId: land, score });
    }
  }

  // One landing per hurdle — prefer the most “straight-over” option.
  const best = new Map<string, { hurdleUid: string; landNodeId: string; score: number }>();
  for (const o of out) {
    const prev = best.get(o.hurdleUid);
    if (!prev || o.score > prev.score) best.set(o.hurdleUid, o);
  }
  return [...best.values()].map(({ hurdleUid, landNodeId }) => ({ hurdleUid, landNodeId }));
}

function upsertBuff(buffs: TurnBuff[], pieceUid: string, patch: Partial<TurnBuff>) {
  let b = buffs.find((x) => x.pieceUid === pieceUid);
  if (!b) {
    b = { pieceUid };
    buffs.push(b);
  }
  Object.assign(b, patch);
}

function clearStatus(statuses: Status[], ...remove: Status[]) {
  return statuses.filter((s) => !remove.includes(s));
}

export type PlateApplyResult = {
  ok: boolean;
  message: string;
  endedTurn: boolean;
  needsSecondTarget?: boolean;
  anim?: {
    kind: 'fly' | 'heal' | 'swap' | 'mega' | 'buff';
    fromUid?: string;
    toUid?: string;
    toNodeId?: string;
    damageBonus?: number;
  };
};

/**
 * Apply a plate effect. Caller must have validated window / unused / targets.
 */
export function applyPlateEffect(
  engine: DuelEngine,
  owner: PlayerId,
  def: PlateDef,
  targets: string[],
): PlateApplyResult {
  const needsTwo =
    def.targeting === 'own-switch' ||
    def.targeting === 'own-field-pair' ||
    def.targeting === 'hurdle-jump';
  if (needsTwo && targets.length < 2) {
    return { ok: false, message: 'Need two targets.', endedTurn: false, needsSecondTarget: true };
  }
  if (def.targeting !== 'none' && !needsTwo && targets.length < 1) {
    return { ok: false, message: 'Need a target.', endedTurn: false };
  }

  const piece = (uid: string) => engine.piece(uid);
  const t0 = targets[0] ? piece(targets[0]) : null;
  const t1 = targets[1] ? piece(targets[1]) : null;

  switch (def.effectId) {
    case 'long_throw': {
      if (!t0 || t0.location !== 'bench') {
        return { ok: false, message: 'Invalid bench target.', endedTurn: false };
      }
      const entries = entryNodes(engine.board.nodes, owner);
      const occ = engine.occupied();
      // One space away from an entry = neighbors of entry (or entry if empty — prefer adjacent)
      const candidates: string[] = [];
      for (const e of entries) {
        for (const n of neighbors(engine.board.edges, e)) {
          if (!occ.has(n)) candidates.push(n);
        }
        if (!occ.has(e)) candidates.push(e);
      }
      if (!candidates.length) {
        return { ok: false, message: 'No open space near entry.', endedTurn: false };
      }
      const dest = candidates[0];
      t0.location = 'field';
      t0.nodeId = dest;
      return {
        ok: true,
        message: `${t0.name} Long Throw → field.`,
        endedTurn: true,
        anim: { kind: 'fly', fromUid: t0.uid, toNodeId: dest },
      };
    }
    case 'bright_powder':
      if (!t0) return { ok: false, message: 'No target.', endedTurn: false };
      upsertBuff(engine.state.turnBuffs, t0.uid, { forceOpponentRespin: true });
      return { ok: true, message: `Bright Powder on ${t0.name}.`, endedTurn: false };
    case 'double_chance':
      if (!t0) return { ok: false, message: 'No target.', endedTurn: false };
      upsertBuff(engine.state.turnBuffs, t0.uid, { respinOwn: true });
      return { ok: true, message: `Double Chance on ${t0.name}.`, endedTurn: false };
    case 'focus_band':
      if (!t0) return { ok: false, message: 'No target.', endedTurn: false };
      upsertBuff(engine.state.turnBuffs, t0.uid, { cannotKo: true });
      return { ok: true, message: `Focus Band on ${t0.name}.`, endedTurn: false };
    case 'x_defend':
      if (!t0) return { ok: false, message: 'No target.', endedTurn: false };
      upsertBuff(engine.state.turnBuffs, t0.uid, { xDefend: true });
      return { ok: true, message: `X Defend on ${t0.name}.`, endedTurn: false };
    case 'x_attack':
      if (!t0) return { ok: false, message: 'No target.', endedTurn: false };
      upsertBuff(engine.state.turnBuffs, t0.uid, { damageBonus: 30 });
      return {
        ok: true,
        message: `X Attack on ${t0.name} (+30).`,
        endedTurn: false,
        anim: { kind: 'buff', toUid: t0.uid, damageBonus: 30 },
      };
    case 'x_speed':
      if (!t0) return { ok: false, message: 'No target.', endedTurn: false };
      upsertBuff(engine.state.turnBuffs, t0.uid, { whiteToGold: true });
      return { ok: true, message: `X Speed on ${t0.name}.`, endedTurn: false };
    case 'max_revive': {
      if (!t0 || t0.location !== 'pc') {
        return { ok: false, message: 'Need PC target.', endedTurn: false };
      }
      engine.forcePcToBench(t0.uid, false);
      return {
        ok: true,
        message: `${t0.name} Max Revive → bench.`,
        endedTurn: false,
        anim: { kind: 'fly', fromUid: t0.uid },
      };
    }
    case 'scoop_up':
      if (!t0 || t0.location !== 'field') {
        return { ok: false, message: 'Need field target.', endedTurn: false };
      }
      engine.forceToBench(t0.uid, false);
      return {
        ok: true,
        message: `${t0.name} scooped to bench.`,
        endedTurn: false,
        anim: { kind: 'fly', fromUid: t0.uid },
      };
    case 'full_heal':
      if (!t0) return { ok: false, message: 'No target.', endedTurn: false };
      t0.statuses = [];
      return {
        ok: true,
        message: `${t0.name} Fully Healed.`,
        endedTurn: false,
        anim: { kind: 'heal', toUid: t0.uid },
      };
    case 'awakening':
      if (!t0) return { ok: false, message: 'No target.', endedTurn: false };
      t0.statuses = clearStatus(t0.statuses, 'sleep');
      return { ok: true, message: `${t0.name} awoke.`, endedTurn: false, anim: { kind: 'heal', toUid: t0.uid } };
    case 'paralyze_heal':
      if (!t0) return { ok: false, message: 'No target.', endedTurn: false };
      t0.statuses = clearStatus(t0.statuses, 'paralysis');
      return { ok: true, message: `${t0.name} paralysis cured.`, endedTurn: false, anim: { kind: 'heal', toUid: t0.uid } };
    case 'confuse_heal':
      if (!t0) return { ok: false, message: 'No target.', endedTurn: false };
      t0.statuses = clearStatus(t0.statuses, 'confusion');
      return { ok: true, message: `${t0.name} confusion cured.`, endedTurn: false, anim: { kind: 'heal', toUid: t0.uid } };
    case 'antidote':
      if (!t0) return { ok: false, message: 'No target.', endedTurn: false };
      t0.statuses = clearStatus(t0.statuses, 'poison', 'noxious');
      return { ok: true, message: `${t0.name} antidote.`, endedTurn: false, anim: { kind: 'heal', toUid: t0.uid } };
    case 'ice_heal':
      if (!t0) return { ok: false, message: 'No target.', endedTurn: false };
      t0.statuses = clearStatus(t0.statuses, 'frozen');
      return { ok: true, message: `${t0.name} thawed.`, endedTurn: false, anim: { kind: 'heal', toUid: t0.uid } };
    case 'burn_heal':
      if (!t0) return { ok: false, message: 'No target.', endedTurn: false };
      t0.statuses = clearStatus(t0.statuses, 'burn');
      return { ok: true, message: `${t0.name} burn healed.`, endedTurn: false, anim: { kind: 'heal', toUid: t0.uid } };
    case 'pokemon_switch':
    case 'swap_spot': {
      if (!t0 || !t1 || t0.uid === t1.uid) {
        return { ok: false, message: 'Need two different targets.', endedTurn: false };
      }
      if (def.effectId === 'swap_spot' && (t0.location !== 'field' || t1.location !== 'field')) {
        return { ok: false, message: 'Both must be on field.', endedTurn: false };
      }
      // Cannot switch two from bench only for Pokémon Switch
      if (def.effectId === 'pokemon_switch' && t0.location === 'bench' && t1.location === 'bench') {
        return { ok: false, message: 'Cannot switch two bench Pokémon.', endedTurn: false };
      }
      const loc0 = t0.location;
      const node0 = t0.nodeId;
      const loc1 = t1.location;
      const node1 = t1.nodeId;
      t0.location = loc1;
      t0.nodeId = node1;
      t1.location = loc0;
      t1.nodeId = node0;
      return {
        ok: true,
        message: `Switched ${t0.name} ↔ ${t1.name}.`,
        endedTurn: def.endsTurn,
        anim: { kind: 'swap', fromUid: t0.uid, toUid: t1.uid },
      };
    }
    case 'priority_recovery': {
      const q = [...engine.pcQueue(owner)];
      if (q.length < 2) {
        return { ok: false, message: 'Need 2 in PC.', endedTurn: false };
      }
      engine.swapPcOrder(owner);
      return { ok: true, message: 'PC order swapped.', endedTurn: true };
    }
    case 'goal_block': {
      if (!t0 || t0.location !== 'field') {
        return { ok: false, message: 'Need field target.', endedTurn: false };
      }
      const goal = goalNode(engine.board.nodes, owner);
      if (engine.occupied().has(goal)) {
        return { ok: false, message: 'Goal occupied.', endedTurn: false };
      }
      t0.nodeId = goal;
      return {
        ok: true,
        message: `${t0.name} Goal Block.`,
        endedTurn: true,
        anim: { kind: 'fly', fromUid: t0.uid, toNodeId: goal },
      };
    }
    case 'hurdle_jump': {
      if (!t0 || !t1) {
        return { ok: false, message: 'Need jumper and hurdle.', endedTurn: false };
      }
      const opt = hurdleOptions(engine, t0.uid).find((o) => o.hurdleUid === t1.uid);
      if (!opt) {
        return { ok: false, message: 'Cannot jump that figure.', endedTurn: false };
      }
      t0.nodeId = opt.landNodeId;
      return {
        ok: true,
        message: `${t0.name} Hurdle Jump over ${t1.name}.`,
        endedTurn: true,
        anim: { kind: 'fly', fromUid: t0.uid, toNodeId: opt.landNodeId },
      };
    }
    case 'recycle': {
      for (const pl of [...engine.state.playerPlates, ...engine.state.opponentPlates]) {
        const d = PLATE_BY_ID.get(pl.plateId);
        if (d && d.effectId !== 'recycle') pl.used = false;
      }
      return { ok: true, message: 'Recycle — plates restored.', endedTurn: true };
    }
    case 'mega_evolve': {
      if (!t0 || t0.location !== 'field') {
        return { ok: false, message: 'Need field target.', endedTurn: false };
      }
      if (def.megaSpecies && t0.name !== def.megaSpecies) {
        return { ok: false, message: `Need ${def.megaSpecies}.`, endedTurn: false };
      }
      if (engine.activePieces(owner).some((p) => (p.megaTurnsLeft ?? 0) > 0)) {
        return { ok: false, message: 'Already have a Mega.', endedTurn: false };
      }
      engine.applyMega(t0.uid, def.megaTurns ?? 7);
      return {
        ok: true,
        message: `${t0.name} Mega Evolved!`,
        endedTurn: false,
        anim: { kind: 'mega', toUid: t0.uid },
      };
    }
    default:
      return { ok: false, message: 'Unknown plate.', endedTurn: false };
  }
}
