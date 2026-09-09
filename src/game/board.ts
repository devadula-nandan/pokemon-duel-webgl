import type { BoardNode, PlayerId } from './types';

/**
 * Authentic Pokémon Duel field (28 spaces = 26 points + 2 goals).
 *
 * Picture-frame topology matching the official board:
 * - Outer rectangle ring (20 nodes)
 * - Inner square ring (8 nodes, adjacent only — no opposite/cross links)
 * - 4 corner diagonals (entry ↔ inner corner)
 * - 2 goal-adjacent spokes (inner top/bottom center → node right of each goal)
 *
 * Goals themselves have no inward spoke; approach them along the outer ring.
 */
const OUTER: string[] = [
  // bottom edge L→R (player side)
  'n0_0', 'n1_0', 'n2_0', 'n3_0', 'n4_0', 'n5_0', 'n6_0',
  // right edge B→T
  'n6_1', 'n6_2', 'n6_3',
  // top edge R→L (opponent side)
  'n6_4', 'n5_4', 'n4_4', 'n3_4', 'n2_4', 'n1_4', 'n0_4',
  // left edge T→B
  'n0_3', 'n0_2', 'n0_1',
];

const INNER_RING: string[] = [
  'n2_1', 'n3_1', 'n4_1', 'n4_2', 'n4_3', 'n3_3', 'n2_3', 'n2_2',
];

/** Non-uniform spacing: outer frame + inset inner square (official silhouette). */
const X_POS = [-2.2, -1.45, -0.75, 0, 0.75, 1.45, 2.2];
const Y_POS = [-2.4, -1.0, 0, 1.0, 2.4];

export function createBoard(): {
  nodes: Map<string, BoardNode>;
  edges: Map<string, string[]>;
} {
  const nodes = new Map<string, BoardNode>();
  const edges = new Map<string, string[]>();

  const add = (id: string, gx: number, gy: number, kind: BoardNode['kind'] = 'normal', owner?: PlayerId) => {
    nodes.set(id, { id, x: X_POS[gx], y: Y_POS[gy], kind, owner });
    edges.set(id, []);
  };

  const link = (a: string, b: string) => {
    if (!edges.has(a) || !edges.has(b)) return;
    if (!edges.get(a)!.includes(b)) edges.get(a)!.push(b);
    if (!edges.get(b)!.includes(a)) edges.get(b)!.push(a);
  };

  // --- create all 28 nodes ---
  for (const id of OUTER) {
    const [, xs, ys] = /^n(\d+)_(\d+)$/.exec(id)!;
    const gx = +xs;
    const gy = +ys;
    let kind: BoardNode['kind'] = 'normal';
    let owner: PlayerId | undefined;
    if ((gx === 0 || gx === 6) && (gy === 0 || gy === 4)) {
      kind = 'entry';
      owner = gy === 0 ? 'player' : 'opponent';
    } else if (gx === 3 && gy === 0) {
      kind = 'goal';
      owner = 'player';
    } else if (gx === 3 && gy === 4) {
      kind = 'goal';
      owner = 'opponent';
    }
    add(id, gx, gy, kind, owner);
  }
  for (const id of INNER_RING) {
    const [, xs, ys] = /^n(\d+)_(\d+)$/.exec(id)!;
    add(id, +xs, +ys);
  }

  // 1) Outer perimeter ring
  for (let i = 0; i < OUTER.length; i++) {
    link(OUTER[i], OUTER[(i + 1) % OUTER.length]);
  }

  // 2) Inner square ring
  for (let i = 0; i < INNER_RING.length; i++) {
    link(INNER_RING[i], INNER_RING[(i + 1) % INNER_RING.length]);
  }

  // 3) Corner diagonals (outer entry ↔ inner corner)
  link('n0_0', 'n2_1'); // SW
  link('n6_0', 'n4_1'); // SE
  link('n0_4', 'n2_3'); // NW
  link('n6_4', 'n4_3'); // NE

  // 4) Inner top/bottom center → node to the right of each side's goal
  link('n4_0', 'n3_1'); // bottom: right of player goal
  link('n2_4', 'n3_3'); // top: right of opponent goal (from that side)

  return { nodes, edges };
}

export function neighbors(edges: Map<string, string[]>, nodeId: string): string[] {
  return edges.get(nodeId) ?? [];
}

export function reachable(
  edges: Map<string, string[]>,
  start: string,
  mp: number,
  occupied: Set<string>,
): string[] {
  if (mp <= 0) return [];
  const best = new Map<string, number>();
  const q: { id: string; dist: number }[] = [{ id: start, dist: 0 }];

  while (q.length) {
    const { id, dist } = q.shift()!;
    for (const n of neighbors(edges, id)) {
      const nd = dist + 1;
      if (nd > mp) continue;
      if (occupied.has(n)) continue;
      if (best.has(n) && best.get(n)! <= nd) continue;
      best.set(n, nd);
      q.push({ id: n, dist: nd });
    }
  }
  return [...best.keys()];
}

export function reachableFromBench(
  edges: Map<string, string[]>,
  entries: string[],
  mp: number,
  occupied: Set<string>,
): string[] {
  if (mp < 1) return [];
  const found = new Set<string>();
  for (const entry of entries) {
    if (occupied.has(entry)) continue;
    found.add(entry);
    for (const n of reachable(edges, entry, mp - 1, occupied)) found.add(n);
  }
  return [...found];
}

/** Shortest path including start and goal. Occupied nodes are blocked except start/goal. */
export function shortestPath(
  edges: Map<string, string[]>,
  start: string,
  goal: string,
  occupied: Set<string> = new Set(),
): string[] | null {
  if (start === goal) return [start];
  const prev = new Map<string, string | null>();
  prev.set(start, null);
  const q = [start];
  while (q.length) {
    const id = q.shift()!;
    for (const n of neighbors(edges, id)) {
      if (prev.has(n)) continue;
      if (occupied.has(n) && n !== goal) continue;
      prev.set(n, id);
      if (n === goal) {
        const path: string[] = [];
        let cur: string | null = goal;
        while (cur) {
          path.push(cur);
          cur = prev.get(cur) ?? null;
        }
        path.reverse();
        return path;
      }
      q.push(n);
    }
  }
  return null;
}

/** Bench → field: shortest path via an entry point (entry is first field node). */
export function shortestPathFromBench(
  edges: Map<string, string[]>,
  entries: string[],
  goal: string,
  occupied: Set<string> = new Set(),
): string[] | null {
  let best: string[] | null = null;
  for (const entry of entries) {
    if (occupied.has(entry) && entry !== goal) continue;
    const rest =
      entry === goal ? [entry] : shortestPath(edges, entry, goal, occupied);
    if (!rest) continue;
    if (!best || rest.length < best.length) best = rest;
  }
  return best;
}

export function entryNodes(nodes: Map<string, BoardNode>, owner: PlayerId): string[] {
  return [...nodes.values()]
    .filter((n) => n.kind === 'entry' && n.owner === owner)
    .map((n) => n.id);
}

export function goalNode(nodes: Map<string, BoardNode>, scoringPlayer: PlayerId): string {
  const targetOwner: PlayerId = scoringPlayer === 'player' ? 'opponent' : 'player';
  return [...nodes.values()].find((n) => n.kind === 'goal' && n.owner === targetOwner)!.id;
}

export function gridLabel(nodeId: string): string {
  const m = /^n(\d+)_(\d+)$/.exec(nodeId);
  return m ? `(${m[1]},${m[2]})` : nodeId;
}
