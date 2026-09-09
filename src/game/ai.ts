import type { DuelEngine } from './engine';
import { goalNode, entryNodes } from './board';
import { canInitiateBattle, canMove } from './combat';

export type AiAction =
  | { type: 'move'; pieceUid: string; targetNode: string }
  | { type: 'battle'; pieceUid: string; battleUid: string }
  | { type: 'heal'; pieceUid: string; targetUid: string }
  | { type: 'end' };

/** Tactical AI respecting move-then-battle turn structure. */
export function pickAiAction(engine: DuelEngine): AiAction | null {
  const turn = engine.state.turn;
  const goal = goalNode(engine.board.nodes, turn);
  const oppEntries = entryNodes(
    engine.board.nodes,
    turn === 'player' ? 'opponent' : 'player',
  );

  // Post-move: battle if good, else end
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
    // Heal
    if (piece.location === 'field') {
      engine.selectPiece(piece.uid);
      for (const ally of engine.adjacentAlliesNeedingHeal(piece.uid)) {
        cands.push({
          score: 35 + ally.statuses.length * 10,
          action: { type: 'heal', pieceUid: piece.uid, targetUid: ally.uid },
        });
      }
    }

    // Battle without moving
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

    // Move
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

      // Prefer ending adjacent to enemies for follow-up battle
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
