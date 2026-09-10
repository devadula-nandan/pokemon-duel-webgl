import type { DuelEngine } from './engine';
import { goalNode, entryNodes } from './board';
import { canInitiateBattle, canMove } from './combat';
import {
  PLATE_BY_ID,
  canUsePlatesNow,
  platesFor,
  validTargets,
} from './plates';

export type AiAction =
  | { type: 'move'; pieceUid: string; targetNode: string }
  | { type: 'battle'; pieceUid: string; battleUid: string }
  | { type: 'heal'; pieceUid: string; targetUid: string }
  | { type: 'plate'; instanceId: string; targets: string[] }
  | { type: 'end' };

/** Tactical AI respecting move-then-battle turn structure + plates. */
export function pickAiAction(engine: DuelEngine): AiAction | null {
  const turn = engine.state.turn;
  const goal = goalNode(engine.board.nodes, turn);
  const oppEntries = entryNodes(
    engine.board.nodes,
    turn === 'player' ? 'opponent' : 'player',
  );

  // Prefer a plate at turn start when useful
  if (canUsePlatesNow(engine, turn)) {
    const plateAct = pickPlate(engine, turn);
    if (plateAct) return plateAct;
  }

  if (engine.state.turnStep === 'post-move' && engine.state.movedUid) {
    const piece = engine.piece(engine.state.movedUid)!;
    engine.selectPiece(piece.uid);
    if (canInitiateBattle(piece)) {
      const foes = engine.adjacentEnemies(piece.uid);
      if (foes.length) {
        foes.sort((a, b) => {
          let sa = 0;
          let sb = 0;
          if (a.nodeId === goal) sa += 50;
          if (b.nodeId === goal) sb += 50;
          return sb - sa;
        });
        return { type: 'battle', pieceUid: piece.uid, battleUid: foes[0].uid };
      }
    }
    return { type: 'end' };
  }

  type Cand = { score: number; action: AiAction };
  const cands: Cand[] = [];

  const mine = engine.activePieces(turn).filter((p) => p.wait === 0);

  for (const piece of mine) {
    if (piece.location === 'field') {
      engine.selectPiece(piece.uid);
      for (const ally of engine.adjacentAlliesNeedingHeal(piece.uid)) {
        cands.push({
          score: 35 + ally.statuses.length * 10,
          action: { type: 'heal', pieceUid: piece.uid, targetUid: ally.uid },
        });
      }
    }

    if (piece.location === 'field' && canInitiateBattle(piece)) {
      engine.selectPiece(piece.uid);
      for (const enemy of engine.adjacentEnemies(piece.uid)) {
        let score = 50;
        if (enemy.nodeId === goal) score += 60;
        if (enemy.nodeId && oppEntries.includes(enemy.nodeId)) score += 35;
        cands.push({
          score,
          action: { type: 'battle', pieceUid: piece.uid, battleUid: enemy.uid },
        });
      }
    }

    if (!canMove(piece)) continue;
    engine.selectPiece(piece.uid);
    for (const node of engine.state.legalMoves) {
      let score = 15;
      if (node === goal) score += 250;
      if (oppEntries.includes(node)) score += 80;

      const to = engine.board.nodes.get(node)!;
      const g = engine.board.nodes.get(goal)!;
      const distAfter = Math.hypot(to.x - g.x, to.y - g.y);
      score += Math.max(0, 45 - distAfter * 12);

      if (piece.nodeId) {
        const from = engine.board.nodes.get(piece.nodeId)!;
        const distBefore = Math.hypot(from.x - g.x, from.y - g.y);
        if (distAfter < distBefore) score += 20;
      }
      if (piece.location === 'bench') score += piece.baseMp * 12;

      const tmpNeighbors = (engine.board.edges.get(node) || []).filter((n) => {
        const occ = engine.piecesAt(n)[0];
        return occ && occ.owner !== turn;
      });
      if (tmpNeighbors.length && canInitiateBattle(piece)) score += 25;

      cands.push({
        score,
        action: { type: 'move', pieceUid: piece.uid, targetNode: node },
      });
    }
  }

  engine.selectPiece(null);
  if (!cands.length) return null;
  cands.sort((a, b) => b.score - a.score);
  return cands[0].action;
}

function pickPlate(engine: DuelEngine, turn: 'player' | 'opponent'): AiAction | null {
  const plates = platesFor(engine, turn).filter((p) => !p.used);
  type Cand = { score: number; action: AiAction };
  const cands: Cand[] = [];

  for (const inst of plates) {
    const def = PLATE_BY_ID.get(inst.plateId);
    if (!def) continue;
    const targets = validTargets(engine, turn, def.targeting, def);

    if (def.effectId === 'full_heal' || def.effectId === 'antidote' || def.effectId === 'awakening') {
      for (const uid of targets) {
        const p = engine.piece(uid);
        if (p && p.statuses.length) {
          cands.push({
            score: 40 + p.statuses.length * 15,
            action: { type: 'plate', instanceId: inst.instanceId, targets: [uid] },
          });
        }
      }
    }
    if (def.effectId === 'x_attack' && targets.length) {
      const best = targets
        .map((uid) => engine.piece(uid)!)
        .filter(Boolean)
        .sort((a, b) => b.baseMp - a.baseMp)[0];
      if (best) {
        cands.push({
          score: 28,
          action: { type: 'plate', instanceId: inst.instanceId, targets: [best.uid] },
        });
      }
    }
    if (def.effectId === 'long_throw' && targets.length) {
      cands.push({
        score: 22,
        action: { type: 'plate', instanceId: inst.instanceId, targets: [targets[0]] },
      });
    }
    if (def.effectId === 'hurdle_jump') {
      for (const jumperUid of targets) {
        const hurdles = validTargets(engine, turn, def.targeting, def, {
          stepFirstUid: jumperUid,
        });
        if (!hurdles.length) continue;
        cands.push({
          score: 45,
          action: {
            type: 'plate',
            instanceId: inst.instanceId,
            targets: [jumperUid, hurdles[0]],
          },
        });
      }
    }
    if (def.effectId === 'max_revive' && targets.length) {
      cands.push({
        score: 45,
        action: { type: 'plate', instanceId: inst.instanceId, targets: [targets[0]] },
      });
    }
    if (def.targeting === 'none') {
      if (def.effectId === 'priority_recovery' && engine.pcQueue(turn).length >= 2) {
        cands.push({
          score: 30,
          action: { type: 'plate', instanceId: inst.instanceId, targets: [] },
        });
      }
    }
  }

  if (!cands.length) return null;
  cands.sort((a, b) => b.score - a.score);
  // Only use plate if score is competitive
  if (cands[0].score < 28) return null;
  return cands[0].action;
}
