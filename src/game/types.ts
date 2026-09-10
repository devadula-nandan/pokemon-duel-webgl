export type PlayerId = 'player' | 'opponent';

export type SegmentColor = 'white' | 'gold' | 'purple' | 'blue' | 'miss';

export type Status =
  | 'poison'
  | 'noxious'
  | 'paralysis'
  | 'sleep'
  | 'frozen'
  | 'burn'
  | 'confusion'
  | 'curse';

export type PlateTargeting =
  | 'none'
  | 'own-bench'
  | 'own-field'
  | 'own-pc'
  | 'own-any'
  | 'own-switch'
  | 'own-field-pair'
  | 'hurdle-jump';

export type PlateEffectId =
  | 'long_throw'
  | 'bright_powder'
  | 'max_revive'
  | 'double_chance'
  | 'focus_band'
  | 'full_heal'
  | 'scoop_up'
  | 'x_attack'
  | 'pokemon_switch'
  | 'swap_spot'
  | 'x_defend'
  | 'priority_recovery'
  | 'awakening'
  | 'paralyze_heal'
  | 'confuse_heal'
  | 'antidote'
  | 'goal_block'
  | 'ice_heal'
  | 'burn_heal'
  | 'x_speed'
  | 'recycle'
  | 'mega_evolve'
  | 'z_move'
  | 'hurdle_jump';

export interface WheelSegment {
  name: string;
  color: SegmentColor;
  size: number;
  damage: number;
  stars: number;
  effect?: string;
  multiply?: boolean;
}

export interface FigureDef {
  id: number;
  name: string;
  rarity: string;
  mp: number;
  ability?: string | null;
  /** Primary types for Energy plates / matchups (Phase 2+). */
  types?: string[];
  /** Mega form wheel override when mega-evolved. */
  megaWheel?: WheelSegment[];
  megaMp?: number;
  wheel: WheelSegment[];
}

export interface PlateDef {
  id: number;
  name: string;
  rarity: string;
  cost: number;
  endsTurn: boolean;
  targeting: PlateTargeting;
  effectId: PlateEffectId;
  description: string;
  megaSpecies?: string;
  megaTurns?: number;
}

export interface PlateInstance {
  instanceId: string;
  plateId: number;
  used: boolean;
}

/** Turn-scoped buffs from plates / abilities. */
export interface TurnBuff {
  pieceUid: string;
  damageBonus?: number;
  respinOwn?: boolean;
  forceOpponentRespin?: boolean;
  cannotKo?: boolean;
  xDefend?: boolean;
  whiteToGold?: boolean;
}

export interface Piece {
  uid: string;
  defId: number;
  name: string;
  owner: PlayerId;
  mp: number;
  baseMp: number;
  rarity: string;
  wheel: WheelSegment[];
  nodeId: string | null;
  location: 'bench' | 'field' | 'pc';
  /** Stable bench pad index (0–5); kept while on field/PC so others don’t reshuffle. */
  benchSlot: number;
  wait: number;
  statuses: Status[];
  mpMarkers: number;
  /** Permanently removed (Curse KO). */
  removed: boolean;
  /** Ability text snapshot from def. */
  ability?: string | null;
  types?: string[];
  /** Remaining turns of Mega Evolution (0 = not mega). */
  megaTurnsLeft?: number;
  /** Base wheel before mega. */
  preMegaWheel?: WheelSegment[];
  preMegaMp?: number;
}

export interface BoardNode {
  id: string;
  x: number;
  y: number;
  kind: 'normal' | 'entry' | 'goal';
  owner?: PlayerId;
}

export type GamePhase =
  | 'team-select'
  | 'playing'
  | 'battle'
  | 'game-over';

/** Sub-state while phase === 'playing'. */
export type TurnStep =
  | 'choose' // pick plate (start only), move and/or battle
  | 'post-move'; // moved; may battle adjacent or end turn

export interface BattleState {
  attackerUid: string;
  defenderUid: string;
  attackerSpin?: WheelSegment;
  defenderSpin?: WheelSegment;
  resultText?: string;
  pendingRespin?: 'attacker' | 'defender' | 'opponent-of';
}

export interface GameState {
  phase: GamePhase;
  turn: PlayerId;
  turnNumber: number;
  /** True after the first figure of the duel has moved (first-move −1 MP consumed). */
  duelFirstMoveDone: boolean;
  turnStep: TurnStep;
  /** True until player moves, battles, heals, or uses an endsTurn plate. */
  plateWindowOpen: boolean;
  /** Figure that already moved this turn (may still battle). */
  movedUid: string | null;
  pieces: Piece[];
  playerPlates: PlateInstance[];
  opponentPlates: PlateInstance[];
  turnBuffs: TurnBuff[];
  selectedUid: string | null;
  /** Plate awaiting target selection. */
  pendingPlateInstanceId: string | null;
  /** First target for two-target plates. */
  pendingPlateTargetUid: string | null;
  legalMoves: string[];
  battle: BattleState | null;
  winner: PlayerId | null;
  winReason: string | null;
  log: string[];
  /** Online / replay: last committed action id. */
  actionSeq: number;
}

/** Serializable action for online sync (Phase 4). */
export type NetAction =
  | { seq: number; type: 'select'; uid: string | null }
  | { seq: number; type: 'move'; uid: string; nodeId: string }
  | { seq: number; type: 'battle'; uid: string; enemyUid: string }
  | { seq: number; type: 'heal'; uid: string; targetUid: string }
  | { seq: number; type: 'end-turn' }
  | {
      seq: number;
      type: 'plate';
      instanceId: string;
      targets: string[];
    }
  | { seq: number; type: 'resign'; winner: PlayerId };
