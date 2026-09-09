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
  wheel: WheelSegment[];
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
  | 'choose' // pick move and/or battle
  | 'post-move'; // moved; may battle adjacent or end turn

export interface BattleState {
  attackerUid: string;
  defenderUid: string;
  attackerSpin?: WheelSegment;
  defenderSpin?: WheelSegment;
  resultText?: string;
}

export interface GameState {
  phase: GamePhase;
  turn: PlayerId;
  turnNumber: number;
  /** True after the first figure of the duel has moved (first-move −1 MP consumed). */
  duelFirstMoveDone: boolean;
  turnStep: TurnStep;
  /** Figure that already moved this turn (may still battle). */
  movedUid: string | null;
  pieces: Piece[];
  selectedUid: string | null;
  legalMoves: string[];
  battle: BattleState | null;
  winner: PlayerId | null;
  winReason: string | null;
  log: string[];
}
