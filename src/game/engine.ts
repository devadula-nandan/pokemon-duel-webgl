import {
  createBoard,
  entryNodes,
  goalNode,
  neighbors,
  reachable,
  reachableFromBench,
  gridLabel,
} from './board';
import {
  TOUCH_CURABLE,
  applyPurpleEffect,
  battleWheelFor,
  canInitiateBattle,
  canMove,
  prepareSpin,
  resolveBattle,
} from './combat';
import type {
  FigureDef,
  GameState,
  Piece,
  PlayerId,
  WheelSegment,
} from './types';

let uidCounter = 0;
const uid = () => `p${++uidCounter}`;

export type SurroundSend = { uid: string; fromNodeId: string };
export type PcEject = {
  uid: string;
  owner: PlayerId;
  fromSlot: number;
  /** Figure whose PC entry forced this eject. */
  causedByUid: string;
};
export type PcShift = {
  uid: string;
  owner: PlayerId;
  fromSlot: number;
  toSlot: number;
  causedByUid: string;
};

export class DuelEngine {
  readonly board = createBoard();
  state: GameState;
  defs: Map<number, FigureDef>;
  /** Surround KOs from the last resolveSurrounds call (for PC hop anim). */
  private lastSurrounds: SurroundSend[] = [];
  /** PC → bench returns when PC was full (for hop + wait marker). */
  private lastPcEjects: PcEject[] = [];
  /** Remaining PC figures sliding forward after a dequeue. */
  private lastPcShifts: PcShift[] = [];
  /** FIFO PC queues per side (front = index 0 = next to leave). */
  private pcQueues: Record<PlayerId, string[]> = { player: [], opponent: [] };

  constructor(allFigures: FigureDef[]) {
    this.defs = new Map(allFigures.map((f) => [f.id, f]));
    this.state = this.emptyState();
  }

  private emptyState(): GameState {
    return {
      phase: 'team-select',
      turn: 'player',
      turnNumber: 0,
      duelFirstMoveDone: false,
      turnStep: 'choose',
      movedUid: null,
      pieces: [],
      selectedUid: null,
      legalMoves: [],
      battle: null,
      winner: null,
      winReason: null,
      log: [],
    };
  }

  private log(msg: string) {
    this.state.log = [msg, ...this.state.log].slice(0, 50);
  }

  startMatch(playerTeam: FigureDef[], opponentTeam: FigureDef[]) {
    uidCounter = 0;
    const make = (def: FigureDef, owner: PlayerId, benchSlot: number): Piece => ({
      uid: uid(),
      defId: def.id,
      name: def.name,
      owner,
      mp: def.mp,
      baseMp: def.mp,
      rarity: def.rarity,
      wheel: def.wheel.map((w) => ({ ...w })),
      nodeId: null,
      location: 'bench',
      benchSlot,
      wait: 0,
      statuses: [],
      mpMarkers: 0,
      removed: false,
    });

    this.state = {
      ...this.emptyState(),
      phase: 'playing',
      turn: Math.random() < 0.5 ? 'player' : 'opponent',
      turnNumber: 1,
      turnStep: 'choose',
      pieces: [
        ...playerTeam.map((d, i) => make(d, 'player', i)),
        ...opponentTeam.map((d, i) => make(d, 'opponent', i)),
      ],
    };
    this.pcQueues = { player: [], opponent: [] };
    this.lastSurrounds = [];
    this.lastPcEjects = [];
    this.lastPcShifts = [];
    this.log(
      `${this.state.turn === 'player' ? 'You' : 'Opponent'} go first. First move of the duel is −1 MP.`,
    );
  }

  /** FIFO PC order for an owner (index 0 = front / next out). */
  pcQueue(owner: PlayerId): readonly string[] {
    return this.pcQueues[owner];
  }

  /** Queue slot for a figure currently in PC, or -1. */
  pcSlotIndex(uid: string): number {
    const piece = this.piece(uid);
    if (!piece || piece.location !== 'pc') return -1;
    return this.pcQueues[piece.owner].indexOf(uid);
  }

  piece(id: string) {
    return this.state.pieces.find((p) => p.uid === id);
  }

  activePieces(owner?: PlayerId) {
    return this.state.pieces.filter(
      (p) => !p.removed && (owner === undefined || p.owner === owner),
    );
  }

  piecesAt(nodeId: string) {
    return this.activePieces().filter((p) => p.location === 'field' && p.nodeId === nodeId);
  }

  occupied(): Set<string> {
    return new Set(
      this.activePieces()
        .filter((p) => p.location === 'field' && p.nodeId)
        .map((p) => p.nodeId!),
    );
  }

  /** MP for this move action. */
  currentMp(piece: Piece): number {
    let mp = piece.baseMp - piece.mpMarkers;
    if (!this.state.duelFirstMoveDone) mp -= 1;
    if (!canMove(piece)) return 0;
    return Math.max(0, mp);
  }

  selectPiece(id: string | null) {
    if (this.state.phase !== 'playing') return;
    this.state.selectedUid = id;
    this.state.legalMoves = [];
    if (!id) return;

    const piece = this.piece(id);
    if (!piece || piece.owner !== this.state.turn || piece.removed) return;

    // After a move, only the moved figure stays selected for possible battle
    if (this.state.turnStep === 'post-move') {
      if (piece.uid !== this.state.movedUid) return;
      return; // battles via adjacentEnemies, no moves
    }

    if (!canMove(piece)) return;

    const mp = this.currentMp(piece);
    const occ = this.occupied();

    if (piece.location === 'bench') {
      const entries = entryNodes(this.board.nodes, piece.owner);
      this.state.legalMoves = reachableFromBench(this.board.edges, entries, mp, occ);
      return;
    }

    if (piece.location === 'field' && piece.nodeId) {
      const occ2 = new Set(occ);
      occ2.delete(piece.nodeId);
      this.state.legalMoves = reachable(this.board.edges, piece.nodeId, mp, occ2);
    }
  }

  /**
   * Move selected figure. Does NOT end the turn if a battle is still possible
   * with the moved figure (or if somehow another battle option exists — only moved figure).
   */
  tryMove(targetNodeId: string): boolean {
    if (this.state.phase !== 'playing' || this.state.turnStep !== 'choose') return false;
    if (!this.state.selectedUid) return false;
    if (!this.state.legalMoves.includes(targetNodeId)) return false;

    const piece = this.piece(this.state.selectedUid)!;
    if (!canMove(piece)) return false;

    if (piece.location === 'bench') {
      piece.location = 'field';
      piece.nodeId = targetNodeId;
      this.log(`${piece.name} entered → ${gridLabel(targetNodeId)}.`);
    } else {
      piece.nodeId = targetNodeId;
      this.log(`${piece.name} → ${gridLabel(targetNodeId)}.`);
    }

    this.state.duelFirstMoveDone = true;
    this.state.movedUid = piece.uid;
    this.state.legalMoves = [];
    this.state.selectedUid = piece.uid;
    this.state.turnStep = 'post-move';

    if (this.checkGoal(piece)) return true;

    // Surrounds resolve after movement, before battle
    this.resolveSurrounds();
    if (this.state.winner) return true;

    // If moved figure was surrounded somehow (rare), it's gone
    if (piece.location !== 'field') {
      this.endTurn();
      return true;
    }

    // If can battle, stay in post-move; else end turn
    const foes = this.adjacentEnemies(piece.uid).filter(() => canInitiateBattle(piece));
    if (!foes.length || !canInitiateBattle(piece)) {
      this.endTurn();
    } else {
      this.log('Adjacent enemy — battle or end turn.');
    }
    return true;
  }

  /** Battle an adjacent enemy. Ends the turn after resolution (caller finishes presentation). */
  tryBattleAdjacent(enemyUid: string): boolean {
    if (this.state.phase !== 'playing') return false;
    if (!this.state.selectedUid) return false;

    const piece = this.piece(this.state.selectedUid)!;
    const enemy = this.piece(enemyUid);
    if (!piece || !enemy || piece.removed || enemy.removed) return false;
    if (piece.location !== 'field' || enemy.location !== 'field') return false;
    if (!piece.nodeId || !enemy.nodeId) return false;
    if (piece.owner !== this.state.turn || enemy.owner === piece.owner) return false;
    if (!neighbors(this.board.edges, piece.nodeId).includes(enemy.nodeId)) return false;
    if (!canInitiateBattle(piece)) return false;

    // post-move: only the figure that moved may battle
    if (this.state.turnStep === 'post-move' && piece.uid !== this.state.movedUid) {
      return false;
    }

    // Surround check: if enemy is surrounded they should already be gone;
    // if WE are surrounded we shouldn't be able to battle (already KO'd after opp move)
    this.state.phase = 'battle';
    this.state.battle = { attackerUid: piece.uid, defenderUid: enemy.uid };
    // Attacking wakes sleep on defender
    enemy.statuses = enemy.statuses.filter((s) => s !== 'sleep');
    this.log(`Battle: ${piece.name} vs ${enemy.name}`);
    return true;
  }

  /** Ally touch heal — ends turn. */
  tryHeal(targetUid: string): boolean {
    if (this.state.phase !== 'playing' || this.state.turnStep !== 'choose') return false;
    if (!this.state.selectedUid) return false;
    const healer = this.piece(this.state.selectedUid)!;
    const target = this.piece(targetUid);
    if (!healer || !target || healer.owner !== this.state.turn) return false;
    if (healer.location !== 'field' || target.location !== 'field') return false;
    if (!healer.nodeId || !target.nodeId) return false;
    if (healer.owner !== target.owner) return false;
    if (!neighbors(this.board.edges, healer.nodeId).includes(target.nodeId)) return false;

    const before = target.statuses.length;
    target.statuses = target.statuses.filter((s) => !TOUCH_CURABLE.includes(s));
    if (target.statuses.length === before) return false;

    this.log(`${healer.name} cured ${target.name}.`);
    this.endTurn();
    return true;
  }

  endTurnManually(): boolean {
    if (this.state.phase !== 'playing') return false;
    if (this.state.turnStep !== 'post-move') return false;
    this.endTurn();
    return true;
  }

  resolveCurrentBattle(): {
    attackerSpin: WheelSegment;
    defenderSpin: WheelSegment;
    note: string;
    playerResult: 'win' | 'lose' | 'draw';
    sentToPcUid: string | null;
  } | null {
    const b = this.state.battle;
    if (!b) return null;
    const attacker = this.piece(b.attackerUid)!;
    const defender = this.piece(b.defenderUid)!;

    const aWheel = battleWheelFor(attacker);
    const dWheel = battleWheelFor(defender);
    const attackerSpin = prepareSpin(attacker, aWheel);
    const defenderSpin = prepareSpin(defender, dWheel);
    b.attackerSpin = attackerSpin;
    b.defenderSpin = defenderSpin;

    const outcome = resolveBattle(attacker, defender, attackerSpin, defenderSpin);
    let note = outcome.note;
    let playerResult: 'win' | 'lose' | 'draw' = 'draw';
    let sentToPcUid: string | null = null;

    if (outcome.type === 'ko') {
      const winPiece = outcome.winner === 'attacker' ? attacker : defender;
      playerResult = winPiece.owner === 'player' ? 'win' : 'lose';
      const loser = outcome.winner === 'attacker' ? defender : attacker;
      if (this.sendToPC(loser)) sentToPcUid = loser.uid;
      note += ` ${loser.name} → PC.`;
    } else if (outcome.type === 'purple') {
      const winPiece = outcome.winner === 'attacker' ? attacker : defender;
      playerResult = winPiece.owner === 'player' ? 'win' : 'lose';
      const loser = outcome.winner === 'attacker' ? defender : attacker;
      const fx = applyPurpleEffect(outcome.effect, loser);
      note += ' ' + fx;
      if (fx.includes('BENCH')) {
        this.sendToBench(loser, true);
      }
    } else if (outcome.type === 'blue') {
      const spin = outcome.spin;
      const user =
        outcome.user === 'attacker'
          ? attacker
          : outcome.user === 'defender'
            ? defender
            : null;
      if (user) playerResult = user.owner === 'player' ? 'win' : 'lose';
      if (user && /wait/i.test(spin.effect || spin.name)) {
        user.wait = Math.max(user.wait, 3);
        note += ` ${user.name} gains Wait.`;
      }
    }

    // Frozen clears after battle (common Duel ruling)
    attacker.statuses = attacker.statuses.filter((s) => s !== 'frozen');
    defender.statuses = defender.statuses.filter((s) => s !== 'frozen');

    b.resultText = note;
    this.log(note);
    return {
      attackerSpin,
      defenderSpin,
      note,
      playerResult,
      sentToPcUid,
    };
  }

  finishBattleAndContinue() {
    this.state.battle = null;
    if (this.state.phase === 'game-over') return;
    this.state.phase = 'playing';
    // Battle ends the turn
    this.resolveSurrounds();
    if (this.state.winner) return;
    this.endTurn();
  }

  /** @returns true if the figure was enqueued in PC. */
  private sendToPC(piece: Piece): boolean {
    if (piece.removed) return false;
    if (piece.statuses.includes('curse')) {
      piece.removed = true;
      piece.location = 'bench';
      piece.nodeId = null;
      this.removeFromPcQueue(piece.uid, piece.owner);
      this.log(`${piece.name} removed by Curse!`);
      return false;
    }

    const owner = piece.owner;
    const q = this.pcQueues[owner];

    // Capacity 2: dequeue front before the new figure enqueues
    if (q.length >= 2) {
      const oldestUid = q.shift()!;
      const oldest = this.piece(oldestUid);
      if (oldest) {
        oldest.location = 'bench';
        oldest.wait = 1;
        this.lastPcEjects.push({
          uid: oldestUid,
          owner,
          fromSlot: 0,
          causedByUid: piece.uid,
        });
        this.log(`${oldest.name} left PC → bench (Wait 1).`);
      }
      // Remaining figure slides forward to the front pad
      if (q.length === 1) {
        this.lastPcShifts.push({
          uid: q[0],
          owner,
          fromSlot: 1,
          toSlot: 0,
          causedByUid: piece.uid,
        });
      }
    }

    piece.nodeId = null;
    piece.location = 'pc';
    piece.statuses = [];
    piece.wait = 0;
    piece.mpMarkers = 0;
    q.push(piece.uid);
    return true;
  }

  private removeFromPcQueue(uid: string, owner: PlayerId) {
    const q = this.pcQueues[owner];
    const i = q.indexOf(uid);
    if (i >= 0) q.splice(i, 1);
  }

  private sendToBench(piece: Piece, withWait: boolean) {
    this.removeFromPcQueue(piece.uid, piece.owner);
    piece.nodeId = null;
    piece.location = 'bench';
    if (withWait) piece.wait = Math.max(piece.wait, 1);
  }

  private checkGoal(piece: Piece): boolean {
    if (!piece.nodeId) return false;
    const goal = goalNode(this.board.nodes, piece.owner);
    if (piece.nodeId === goal) {
      this.state.phase = 'game-over';
      this.state.winner = piece.owner;
      this.state.winReason = `${piece.name} captured the goal!`;
      this.log(this.state.winReason);
      return true;
    }
    return false;
  }

  /**
   * Surround = every adjacent point occupied by an opposing figure.
   * Official: after movement ends; KO before battle can be initiated.
   */
  resolveSurrounds(): SurroundSend[] {
    const sent: SurroundSend[] = [];
    let changed = true;
    while (changed) {
      changed = false;
      for (const piece of [...this.activePieces()]) {
        if (piece.location !== 'field' || !piece.nodeId) continue;
        const nbs = neighbors(this.board.edges, piece.nodeId);
        if (!nbs.length) continue;
        const surrounded = nbs.every((n) => {
          const occ = this.piecesAt(n)[0];
          return !!occ && occ.owner !== piece.owner;
        });
        if (surrounded) {
          const fromNodeId = piece.nodeId;
          this.log(`${piece.name} surrounded → PC.`);
          if (this.sendToPC(piece)) {
            sent.push({ uid: piece.uid, fromNodeId });
          }
          changed = true;
        }
      }
    }
    this.lastSurrounds = sent;
    return sent;
  }

  /** Consume surround events for presentation (PC hop). */
  takeLastSurrounds(): SurroundSend[] {
    const s = this.lastSurrounds;
    this.lastSurrounds = [];
    return s;
  }

  /** Consume PC→bench ejects (full PC) for presentation. */
  takeLastPcEjects(): PcEject[] {
    const e = this.lastPcEjects;
    this.lastPcEjects = [];
    return e;
  }

  /** Consume PC queue forward-shifts for presentation. */
  takeLastPcShifts(): PcShift[] {
    const s = this.lastPcShifts;
    this.lastPcShifts = [];
    return s;
  }

  private hasLegalAction(side: PlayerId): boolean {
    const mine = this.activePieces(side).filter((p) => p.wait === 0 && !p.removed);
    for (const p of mine) {
      // Can move?
      if (canMove(p)) {
        const mp = (() => {
          let m = p.baseMp - p.mpMarkers;
          // During wait-win check at start of their turn, duelFirstMoveDone is already true usually
          if (!this.state.duelFirstMoveDone) m -= 1;
          return Math.max(0, m);
        })();
        const occ = this.occupied();
        if (p.location === 'bench') {
          const entries = entryNodes(this.board.nodes, side);
          if (reachableFromBench(this.board.edges, entries, mp, occ).length) return true;
        }
        if (p.location === 'field' && p.nodeId) {
          const occ2 = new Set(occ);
          occ2.delete(p.nodeId);
          if (reachable(this.board.edges, p.nodeId, mp, occ2).length) return true;
        }
      }
      // Can battle?
      if (p.location === 'field' && canInitiateBattle(p) && this.adjacentEnemies(p.uid).length) {
        return true;
      }
      // Can heal?
      if (p.location === 'field' && p.nodeId) {
        for (const n of neighbors(this.board.edges, p.nodeId)) {
          const ally = this.piecesAt(n)[0];
          if (
            ally &&
            ally.owner === side &&
            ally.statuses.some((s) => TOUCH_CURABLE.includes(s))
          ) {
            return true;
          }
        }
      }
    }
    return false;
  }

  private checkWaitWin(): boolean {
    const side = this.state.turn;
    if (this.hasLegalAction(side)) return false;
    const winner: PlayerId = side === 'player' ? 'opponent' : 'player';
    this.state.phase = 'game-over';
    this.state.winner = winner;
    this.state.winReason = 'Wait Win — no legal moves.';
    this.log(this.state.winReason);
    return true;
  }

  endTurn() {
    // Tick wait on the player whose turn is ending
    for (const p of this.activePieces(this.state.turn)) {
      if (p.wait > 0) p.wait -= 1;
    }

    this.state.turn = this.state.turn === 'player' ? 'opponent' : 'player';
    this.state.turnNumber += 1;
    this.state.turnStep = 'choose';
    this.state.movedUid = null;
    this.state.selectedUid = null;
    this.state.legalMoves = [];

    if (this.state.turnNumber > 300) {
      this.state.phase = 'game-over';
      this.state.winner = null;
      this.state.winReason = 'Turn limit (300).';
      return;
    }

    this.checkWaitWin();
  }

  adjacentEnemies(id: string): Piece[] {
    const piece = this.piece(id);
    if (!piece?.nodeId || piece.location !== 'field') return [];
    return neighbors(this.board.edges, piece.nodeId)
      .map((n) => this.piecesAt(n)[0])
      .filter((p): p is Piece => !!p && p.owner !== piece.owner && !p.removed);
  }

  adjacentAlliesNeedingHeal(id: string): Piece[] {
    const piece = this.piece(id);
    if (!piece?.nodeId || piece.location !== 'field') return [];
    return neighbors(this.board.edges, piece.nodeId)
      .map((n) => this.piecesAt(n)[0])
      .filter(
        (p): p is Piece =>
          !!p &&
          p.owner === piece.owner &&
          p.statuses.some((s) => TOUCH_CURABLE.includes(s)),
      );
  }
}
