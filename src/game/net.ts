/**
 * Online / local multiplayer sync layer (Phase 4).
 * Authoritative action stream with seedable RNG hook for replays.
 * Default transport is local (hotseat / AI); WebSocket host can be attached later.
 */

import type { DuelEngine } from './engine';
import type { NetAction, PlayerId } from './types';

export type NetTransport = {
  send(action: NetAction): void;
  onRemote(handler: (action: NetAction) => void): void;
  disconnect(): void;
};

/** In-process loopback (single client + optional second local seat). */
export class LocalTransport implements NetTransport {
  private handlers: Array<(a: NetAction) => void> = [];
  send(action: NetAction) {
    queueMicrotask(() => {
      for (const h of this.handlers) h(action);
    });
  }
  onRemote(handler: (action: NetAction) => void) {
    this.handlers.push(handler);
  }
  disconnect() {
    this.handlers = [];
  }
}

/**
 * Applies committed NetActions to the engine.
 * Caller should only send after local validation; remote applies blindly with seq check.
 */
export class MatchNet {
  private transport: NetTransport;
  private engine: DuelEngine;
  private lastApplied = 0;
  private applyRemote: (action: NetAction) => void;

  constructor(
    engine: DuelEngine,
    transport: NetTransport = new LocalTransport(),
    applyRemote?: (action: NetAction) => void,
  ) {
    this.engine = engine;
    this.transport = transport;
    this.applyRemote =
      applyRemote ??
      ((action) => {
        this.applyAction(action);
      });
    this.transport.onRemote((a) => {
      if (a.seq <= this.lastApplied) return;
      this.applyRemote(a);
      this.lastApplied = a.seq;
    });
  }

  /** Broadcast a locally validated action. */
  commit(action: NetAction) {
    this.transport.send(action);
    this.lastApplied = action.seq;
  }

  applyAction(action: NetAction) {
    switch (action.type) {
      case 'select':
        this.engine.selectPiece(action.uid);
        break;
      case 'move':
        this.engine.selectPiece(action.uid);
        this.engine.tryMove(action.nodeId);
        break;
      case 'battle':
        this.engine.selectPiece(action.uid);
        this.engine.tryBattleAdjacent(action.enemyUid);
        break;
      case 'heal':
        this.engine.selectPiece(action.uid);
        this.engine.tryHeal(action.targetUid);
        break;
      case 'end-turn':
        this.engine.endTurnManually();
        break;
      case 'plate': {
        const owner = this.engine.state.turn;
        // Drive pending targets
        this.engine.trySelectPlate(action.instanceId);
        for (const t of action.targets) {
          this.engine.selectPiece(t);
        }
        void owner;
        break;
      }
      case 'resign':
        this.engine.state.phase = 'game-over';
        this.engine.state.winner = action.winner;
        this.engine.state.winReason = 'Opponent resigned.';
        break;
    }
  }

  snapshot(): {
    actionSeq: number;
    turn: PlayerId;
    turnNumber: number;
    winner: PlayerId | null;
  } {
    const s = this.engine.state;
    return {
      actionSeq: s.actionSeq,
      turn: s.turn,
      turnNumber: s.turnNumber,
      winner: s.winner,
    };
  }

  disconnect() {
    this.transport.disconnect();
  }
}

/**
 * Optional WebSocket room URL helper. Not connected by default — call when hosting.
 * Protocol: JSON NetAction messages.
 */
export function createWebSocketTransport(url: string): NetTransport {
  const ws = new WebSocket(url);
  const handlers: Array<(a: NetAction) => void> = [];
  ws.addEventListener('message', (ev) => {
    try {
      const action = JSON.parse(String(ev.data)) as NetAction;
      for (const h of handlers) h(action);
    } catch {
      /* ignore */
    }
  });
  return {
    send(action) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(action));
    },
    onRemote(handler) {
      handlers.push(handler);
    },
    disconnect() {
      ws.close();
    },
  };
}
