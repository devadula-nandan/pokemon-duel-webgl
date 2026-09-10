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
  applyAbilityPassives,
  applyPurpleEffect,
  applyTurnBuffToWheel,
  battleWheelFor,
  canInitiateBattle,
  canMove,
  effectiveDamageWithBuffs,
  prepareSpin,
  resolveBattle,
  resolveMultiplyDamage,
  shouldBlockKo,
} from './combat';
import {
  DEFAULT_AI_PLATES,
  DEFAULT_PLAYER_PLATES,
  PLATE_BY_ID,
  applyPlateEffect,
  canUsePlatesNow,
  getPlateDef,
  makePlateInstances,
  platesFor,
  resetPlateInstanceCounter,
  validTargets,
} from './plates';
import type {
  FigureDef,
  GameState,
  Piece,
  PlayerId,
  TurnBuff,
  WheelSegment,
} from './types';

let uidCounter = 0;
const uid = () => `p${++uidCounter}`;

export type SurroundSend = { uid: string; fromNodeId: string };
export type PcEject = {
  uid: string;
  owner: PlayerId;
  fromSlot: number;
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
  private lastSurrounds: SurroundSend[] = [];
  private lastPcEjects: PcEject[] = [];
  private lastPcShifts: PcShift[] = [];
  private pcQueues: Record<PlayerId, string[]> = { player: [], opponent: [] };
  /** Last plate anim hint for presentation. */
  lastPlateAnim: ReturnType<typeof applyPlateEffect>['anim'] | null = null;
  lastUsedPlateInstanceId: string | null = null;

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
      plateWindowOpen: true,
      movedUid: null,
      pieces: [],
      playerPlates: [],
      opponentPlates: [],
      turnBuffs: [],
      selectedUid: null,
      pendingPlateInstanceId: null,
      pendingPlateTargetUid: null,
      legalMoves: [],
      battle: null,
      winner: null,
      winReason: null,
      log: [],
      actionSeq: 0,
    };
  }

  private log(msg: string) {
    this.state.log = [msg, ...this.state.log].slice(0, 50);
  }

  startMatch(
    playerTeam: FigureDef[],
    opponentTeam: FigureDef[],
    playerPlateIds: number[] = DEFAULT_PLAYER_PLATES,
    opponentPlateIds: number[] = DEFAULT_AI_PLATES,
  ) {
    uidCounter = 0;
    resetPlateInstanceCounter();
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
      ability: def.ability ?? null,
      types: def.types ? [...def.types] : undefined,
      megaTurnsLeft: 0,
    });

    this.state = {
      ...this.emptyState(),
      phase: 'playing',
      turn: Math.random() < 0.5 ? 'player' : 'opponent',
      turnNumber: 1,
      turnStep: 'choose',
      plateWindowOpen: true,
      pieces: [
        ...playerTeam.map((d, i) => make(d, 'player', i)),
        ...opponentTeam.map((d, i) => make(d, 'opponent', i)),
      ],
      playerPlates: makePlateInstances(playerPlateIds),
      opponentPlates: makePlateInstances(opponentPlateIds),
    };
    this.pcQueues = { player: [], opponent: [] };
    this.lastSurrounds = [];
    this.lastPcEjects = [];
    this.lastPcShifts = [];
    this.lastPlateAnim = null;
    for (const p of this.state.pieces) applyAbilityPassives(p, 'start');
    this.log(
      `${this.state.turn === 'player' ? 'You' : 'Opponent'} go first. First move of the duel is −1 MP.`,
    );
  }

  pcQueue(owner: PlayerId): readonly string[] {
    return this.pcQueues[owner];
  }

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

  buffFor(uid: string): TurnBuff | undefined {
    return this.state.turnBuffs.find((b) => b.pieceUid === uid);
  }

  currentMp(piece: Piece): number {
    let mp = piece.baseMp - piece.mpMarkers;
    if (!this.state.duelFirstMoveDone) mp -= 1;
    mp += applyAbilityPassives(piece, 'mpBonus');
    if (!canMove(piece)) return 0;
    return Math.max(0, mp);
  }

  /** Close plate window when committing a non-plate action. */
  private closePlateWindow() {
    this.state.plateWindowOpen = false;
    this.state.pendingPlateInstanceId = null;
    this.state.pendingPlateTargetUid = null;
  }

  selectPiece(id: string | null) {
    if (this.state.phase !== 'playing') return;
    // If selecting a plate target, don't overwrite with move selection unless clearing
    if (this.state.pendingPlateInstanceId && id) {
      this.tryCompletePlateTarget(id);
      return;
    }
    this.state.selectedUid = id;
    this.state.legalMoves = [];
    if (!id) return;

    const piece = this.piece(id);
    if (!piece || piece.owner !== this.state.turn || piece.removed) return;

    if (this.state.turnStep === 'post-move') {
      if (piece.uid !== this.state.movedUid) return;
      return;
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

  /** Begin or confirm plate use. */
  trySelectPlate(instanceId: string): boolean {
    const owner = this.state.turn;
    if (!canUsePlatesNow(this, owner)) return false;
    const inst = platesFor(this, owner).find((p) => p.instanceId === instanceId);
    if (!inst || inst.used) return false;
    const def = getPlateDef(inst);
    if (!def) return false;

    if (def.targeting === 'none') {
      return this.commitPlate(inst, []);
    }

    const targets = validTargets(this, owner, def.targeting, def);
    if (!targets.length) {
      this.log(`${def.name}: no valid targets.`);
      return false;
    }

    this.state.pendingPlateInstanceId = instanceId;
    this.state.pendingPlateTargetUid = null;
    this.state.selectedUid = null;
    this.state.legalMoves = [];
    this.log(`Select target for ${def.name}.`);
    return true;
  }

  private tryCompletePlateTarget(targetUid: string): boolean {
    const instanceId = this.state.pendingPlateInstanceId;
    if (!instanceId) return false;
    const owner = this.state.turn;
    const inst = platesFor(this, owner).find((p) => p.instanceId === instanceId);
    if (!inst || inst.used) return false;
    const def = getPlateDef(inst);
    if (!def) return false;

    const allowed = validTargets(this, owner, def.targeting, def, {
      stepFirstUid: this.state.pendingPlateTargetUid,
    });
    if (!allowed.includes(targetUid)) {
      this.log('Invalid plate target.');
      return false;
    }

    const needsTwo =
      def.targeting === 'own-switch' ||
      def.targeting === 'own-field-pair' ||
      def.targeting === 'hurdle-jump';
    if (needsTwo) {
      if (!this.state.pendingPlateTargetUid) {
        this.state.pendingPlateTargetUid = targetUid;
        this.log('Select second target.');
        return true;
      }
      if (this.state.pendingPlateTargetUid === targetUid) return false;
      return this.commitPlate(inst, [this.state.pendingPlateTargetUid, targetUid]);
    }

    return this.commitPlate(inst, [targetUid]);
  }

  private commitPlate(inst: { instanceId: string; plateId: number; used: boolean }, targets: string[]): boolean {
    const def = PLATE_BY_ID.get(inst.plateId);
    if (!def) return false;
    const result = applyPlateEffect(this, this.state.turn, def, targets);
    if (!result.ok) {
      this.log(result.message);
      if (result.needsSecondTarget) return true;
      return false;
    }
    inst.used = true;
    this.state.pendingPlateInstanceId = null;
    this.state.pendingPlateTargetUid = null;
    this.lastPlateAnim = result.anim ?? null;
    this.lastUsedPlateInstanceId = inst.instanceId;
    this.log(`Plate: ${def.name} — ${result.message}`);
    this.state.actionSeq += 1;
    if (result.endedTurn) {
      this.closePlateWindow();
      this.endTurn();
    } else {
      // Non-ending plates still close further plate uses this turn (authentic: one plate per turn typically; we allow only start window — once any plate used, close window)
      this.state.plateWindowOpen = false;
    }
    return true;
  }

  cancelPendingPlate() {
    this.state.pendingPlateInstanceId = null;
    this.state.pendingPlateTargetUid = null;
  }

  forceToBench(uid: string, withWait: boolean) {
    const piece = this.piece(uid);
    if (!piece) return;
    this.sendToBench(piece, withWait);
  }

  forcePcToBench(uid: string, withWait: boolean) {
    const piece = this.piece(uid);
    if (!piece || piece.location !== 'pc') return;
    this.removeFromPcQueue(uid, piece.owner);
    piece.location = 'bench';
    piece.nodeId = null;
    if (withWait) piece.wait = Math.max(piece.wait, 1);
    else piece.wait = 0;
  }

  swapPcOrder(owner: PlayerId) {
    const q = this.pcQueues[owner];
    if (q.length >= 2) {
      const a = q[0];
      q[0] = q[1];
      q[1] = a;
    }
  }

  applyMega(uid: string, turns: number) {
    const piece = this.piece(uid);
    if (!piece) return;
    const def = this.defs.get(piece.defId);
    piece.preMegaWheel = piece.wheel.map((w) => ({ ...w }));
    piece.preMegaMp = piece.baseMp;
    if (def?.megaWheel?.length) {
      piece.wheel = def.megaWheel.map((w) => ({ ...w }));
    } else {
      // Generic mega boost: +20 white/gold damage, +1 MP
      piece.wheel = piece.wheel.map((w) =>
        w.color === 'white' || w.color === 'gold'
          ? { ...w, damage: w.damage + 20 }
          : { ...w },
      );
    }
    piece.baseMp = def?.megaMp ?? piece.baseMp + 1;
    piece.mp = piece.baseMp;
    piece.megaTurnsLeft = turns;
    piece.name = piece.name.startsWith('Mega ') ? piece.name : `Mega ${piece.name}`;
  }

  private tickMega() {
    for (const p of this.activePieces()) {
      if ((p.megaTurnsLeft ?? 0) > 0) {
        p.megaTurnsLeft! -= 1;
        if (p.megaTurnsLeft! <= 0) {
          if (p.preMegaWheel) {
            p.wheel = p.preMegaWheel;
            p.preMegaWheel = undefined;
          }
          if (p.preMegaMp != null) {
            p.baseMp = p.preMegaMp;
            p.preMegaMp = undefined;
          }
          p.name = p.name.replace(/^Mega\s+/, '');
          this.log(`${p.name} Mega ended.`);
        }
      }
    }
  }

  tryMove(targetNodeId: string): boolean {
    if (this.state.phase !== 'playing' || this.state.turnStep !== 'choose') return false;
    if (this.state.pendingPlateInstanceId) return false;
    if (!this.state.selectedUid) return false;
    if (!this.state.legalMoves.includes(targetNodeId)) return false;

    const piece = this.piece(this.state.selectedUid)!;
    if (!canMove(piece)) return false;

    this.closePlateWindow();

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
    this.state.actionSeq += 1;

    if (this.checkGoal(piece)) return true;

    this.resolveSurrounds();
    if (this.state.winner) return true;

    if (piece.location !== 'field') {
      this.endTurn();
      return true;
    }

    const foes = this.adjacentEnemies(piece.uid).filter(() => canInitiateBattle(piece));
    if (!foes.length || !canInitiateBattle(piece)) {
      this.endTurn();
    } else {
      this.log('Adjacent enemy — battle or end turn.');
    }
    return true;
  }

  tryBattleAdjacent(enemyUid: string): boolean {
    if (this.state.phase !== 'playing') return false;
    if (this.state.pendingPlateInstanceId) return false;
    if (!this.state.selectedUid) return false;

    const piece = this.piece(this.state.selectedUid)!;
    const enemy = this.piece(enemyUid);
    if (!piece || !enemy || piece.removed || enemy.removed) return false;
    if (piece.location !== 'field' || enemy.location !== 'field') return false;
    if (!piece.nodeId || !enemy.nodeId) return false;
    if (piece.owner !== this.state.turn || enemy.owner === piece.owner) return false;
    if (!neighbors(this.board.edges, piece.nodeId).includes(enemy.nodeId)) return false;
    if (!canInitiateBattle(piece)) return false;

    if (this.state.turnStep === 'post-move' && piece.uid !== this.state.movedUid) {
      return false;
    }

    this.closePlateWindow();
    this.state.phase = 'battle';
    this.state.battle = { attackerUid: piece.uid, defenderUid: enemy.uid };
    enemy.statuses = enemy.statuses.filter((s) => s !== 'sleep');
    this.log(`Battle: ${piece.name} vs ${enemy.name}`);
    this.state.actionSeq += 1;
    return true;
  }

  tryHeal(targetUid: string): boolean {
    if (this.state.phase !== 'playing' || this.state.turnStep !== 'choose') return false;
    if (this.state.pendingPlateInstanceId) return false;
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

    this.closePlateWindow();
    this.log(`${healer.name} cured ${target.name}.`);
    this.state.actionSeq += 1;
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

    let aWheel = applyTurnBuffToWheel(battleWheelFor(attacker), this.buffFor(attacker.uid));
    let dWheel = applyTurnBuffToWheel(battleWheelFor(defender), this.buffFor(defender.uid));

    let attackerSpin = prepareSpin(attacker, aWheel);
    let defenderSpin = prepareSpin(defender, dWheel);

    // Double Chance / Bright Powder respins (auto-apply better spin once)
    const aBuff = this.buffFor(attacker.uid);
    const dBuff = this.buffFor(defender.uid);
    if (aBuff?.respinOwn) {
      const alt = prepareSpin(attacker, aWheel);
      if (spinScore(alt) > spinScore(attackerSpin)) attackerSpin = alt;
      aBuff.respinOwn = false;
    }
    if (dBuff?.respinOwn) {
      const alt = prepareSpin(defender, dWheel);
      if (spinScore(alt) > spinScore(defenderSpin)) defenderSpin = alt;
      dBuff.respinOwn = false;
    }
    if (aBuff?.forceOpponentRespin) {
      const alt = prepareSpin(defender, dWheel);
      if (spinScore(alt) < spinScore(defenderSpin)) defenderSpin = alt;
      aBuff.forceOpponentRespin = false;
    }
    if (dBuff?.forceOpponentRespin) {
      const alt = prepareSpin(attacker, aWheel);
      if (spinScore(alt) < spinScore(attackerSpin)) attackerSpin = alt;
      dBuff.forceOpponentRespin = false;
    }

    // Multiply white attacks
    attackerSpin = resolveMultiplyDamage(attackerSpin, aWheel);
    defenderSpin = resolveMultiplyDamage(defenderSpin, dWheel);

    b.attackerSpin = attackerSpin;
    b.defenderSpin = defenderSpin;

    const outcome = resolveBattle(
      attacker,
      defender,
      attackerSpin,
      defenderSpin,
      (p, seg) => effectiveDamageWithBuffs(p, seg, this.buffFor(p.uid)),
    );
    let note = outcome.note;
    let playerResult: 'win' | 'lose' | 'draw' = 'draw';
    let sentToPcUid: string | null = null;

    if (outcome.type === 'ko') {
      const winPiece = outcome.winner === 'attacker' ? attacker : defender;
      const loser = outcome.winner === 'attacker' ? defender : attacker;
      playerResult = winPiece.owner === 'player' ? 'win' : 'lose';
      if (shouldBlockKo(loser, this.buffFor(loser.uid), outcome)) {
        note += ` ${loser.name} endured (plate)!`;
      } else {
        if (this.sendToPC(loser)) sentToPcUid = loser.uid;
        note += ` ${loser.name} → PC.`;
      }
    } else if (outcome.type === 'purple') {
      const winPiece = outcome.winner === 'attacker' ? attacker : defender;
      playerResult = winPiece.owner === 'player' ? 'win' : 'lose';
      const loser = outcome.winner === 'attacker' ? defender : attacker;
      const fx = applyPurpleEffect(outcome.effect, loser, this);
      note += ' ' + fx;
      if (fx.includes('BENCH')) {
        this.sendToBench(loser, true);
      }
      if (fx.includes('KNOCKBACK') && loser.nodeId && winPiece.nodeId) {
        this.applyKnockback(winPiece, loser);
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

  private applyKnockback(winner: Piece, loser: Piece) {
    if (!winner.nodeId || !loser.nodeId) return;
    const loserNode = loser.nodeId;
    const nbs = neighbors(this.board.edges, loserNode).filter(
      (n) => n !== winner.nodeId && !this.occupied().has(n),
    );
    if (!nbs.length) return;
    // Prefer further from winner
    const wNode = this.board.nodes.get(winner.nodeId)!;
    nbs.sort((a, b) => {
      const na = this.board.nodes.get(a)!;
      const nb = this.board.nodes.get(b)!;
      const da = Math.hypot(na.x - wNode.x, na.y - wNode.y);
      const db = Math.hypot(nb.x - wNode.x, nb.y - wNode.y);
      return db - da;
    });
    loser.nodeId = nbs[0];
    // Winner may take loser's space
    if (!this.occupied().has(loserNode) || this.piecesAt(loserNode)[0]?.uid === loser.uid) {
      // after move loser vacated
    }
    winner.nodeId = loserNode;
  }

  finishBattleAndContinue() {
    this.state.battle = null;
    if (this.state.phase === 'game-over') return;
    this.state.phase = 'playing';
    this.resolveSurrounds();
    if (this.state.winner) return;
    this.endTurn();
  }

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

  resolveSurrounds(): SurroundSend[] {
    const sent: SurroundSend[] = [];
    let changed = true;
    while (changed) {
      changed = false;
      for (const piece of [...this.activePieces()]) {
        if (piece.location !== 'field' || !piece.nodeId) continue;
        if (applyAbilityPassives(piece, 'surroundImmune')) continue;
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

  takeLastSurrounds(): SurroundSend[] {
    const s = this.lastSurrounds;
    this.lastSurrounds = [];
    return s;
  }

  takeLastPcEjects(): PcEject[] {
    const e = this.lastPcEjects;
    this.lastPcEjects = [];
    return e;
  }

  takeLastPcShifts(): PcShift[] {
    const s = this.lastPcShifts;
    this.lastPcShifts = [];
    return s;
  }

  takeLastPlateAnim() {
    const a = this.lastPlateAnim;
    this.lastPlateAnim = null;
    return a;
  }

  private hasLegalAction(side: PlayerId): boolean {
    // Unused plates that don't need targets can count — skip for wait-win simplicity
    const mine = this.activePieces(side).filter((p) => p.wait === 0 && !p.removed);
    for (const p of mine) {
      if (canMove(p)) {
        const mp = (() => {
          let m = p.baseMp - p.mpMarkers;
          if (!this.state.duelFirstMoveDone) m -= 1;
          m += applyAbilityPassives(p, 'mpBonus');
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
      if (p.location === 'field' && canInitiateBattle(p) && this.adjacentEnemies(p.uid).length) {
        return true;
      }
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
    for (const p of this.activePieces(this.state.turn)) {
      if (p.wait > 0) p.wait -= 1;
    }
    this.tickMega();

    this.state.turn = this.state.turn === 'player' ? 'opponent' : 'player';
    this.state.turnNumber += 1;
    this.state.turnStep = 'choose';
    this.state.plateWindowOpen = true;
    this.state.turnBuffs = [];
    this.state.movedUid = null;
    this.state.selectedUid = null;
    this.state.legalMoves = [];
    this.state.pendingPlateInstanceId = null;
    this.state.pendingPlateTargetUid = null;
    this.state.actionSeq += 1;

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

function spinScore(seg: WheelSegment): number {
  if (seg.color === 'blue') return 1000;
  if (seg.color === 'gold') return 500 + seg.damage;
  if (seg.color === 'purple') return 400 + seg.stars * 50;
  if (seg.color === 'white') return 200 + seg.damage;
  return 0;
}
