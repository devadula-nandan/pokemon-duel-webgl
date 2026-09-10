import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { DuelEngine } from '../game/engine';
import type { BoardNode, Piece, PlayerId } from '../game/types';
import {
  createMpBadgeTexture,
  createNameBandTexture,
  createStatusIconsTexture,
  createWaitBadgeTexture,
} from './token';
import { pokemonColor } from './pokemonColor';
import {
  createPlaceholderOrbTexture,
  getPokemonOrbTexture,
  orbGlassColor,
} from './pokemonArt';
import { createArenaFloorTexture, createArenaRoughnessTexture } from './arenaTexture';
import { createWoodBumpTexture, createWoodTexture } from './woodTexture';
import { MatchHud3D } from './MatchHud3D';
import { entryNodes, shortestPath, shortestPathFromBench } from '../game/board';

/** Rocky arena floor Y. */
export const FLOOR_Y = -0.08;
/** Timer / board height (cylinder diameter). */
export const BOARD_THICK = 0.11;
/** Board top surface Y — field nodes, routes, and pieces sit on this. */
export const BOARD_TOP = FLOOR_Y + BOARD_THICK;
/** Timer tube outer radius (= half board thickness). */
const TIMER_R = BOARD_THICK / 2;

/** Goal outline-triangle size (tip at ±GOAL_ARROW_S on X). */
const GOAL_ARROW_S = 0.2;
/** Same radius as path line cylinders. */
const ROUTE_RADIUS = 0.022;
/** Hockey-puck node radius (wider than the route so joints read as pads). */
const NODE_RADIUS = 0.1;
/** Flat puck height — sits on the board / arena floor. */
const PUCK_H = 0.04;
/** Legal-path node diameter scale (in-between / destination). */
const PATH_NODE_SCALE = 1.4;
const PATH_DEST_SCALE = 1.55;
/** Square path bar width (top-down); height matches puck. */
const ROUTE_SIDE = ROUTE_RADIUS * 2;
/** Slightly wider green highlight bars; same height as pucks. */
const PATH_HIGHLIGHT_SIDE = ROUTE_SIDE * 1.65;
/** Route / node center height (through puck midsection). */
const ROUTE_Y = BOARD_TOP + PUCK_H / 2;
/** PC pad center height on the arena floor. */
const FLOOR_PUCK_Y = FLOOR_Y + PUCK_H / 2;

/** Lift green overlays so they don’t z-fight the base path when orbiting. */
const HIGHLIGHT_Y_BIAS = 0.004;

/**
 * Visual board matching the official Pokémon Duel look:
 * thin routes, hockey-puck nodes, concentric entries, outline goal arrows,
 * rocky arena, portrait framing, blue/red team bases.
 */
export class BoardView {
  readonly root = new THREE.Group();
  private nodeMeshes = new Map<string, THREE.Object3D>();
  private pieceMeshes = new Map<string, THREE.Group>();
  private highlight = new THREE.Group();
  readonly markers = this.highlight;
  private plateTargetUids: string[] = [];
  private plateFocusUid: string | null = null;
  private engine: DuelEngine;
  private viewCamera: THREE.Camera | null = null;
  private routeMat: THREE.MeshLambertMaterial;
  private dimRouteMat: THREE.MeshLambertMaterial;
  private boardRouteMeshes: THREE.Mesh[] = [];
  /** PC pads / floor links — dim whenever a move path is shown. */
  private auxRouteMeshes: THREE.Mesh[] = [];
  private moveAnims = new Map<
    string,
    {
      waypoints: THREE.Vector3[];
      hop: number;
      t0: number;
      hopMs: number;
      hopHeight: number;
      /** `fall` = ease-in; `stomp` = hang then slam; default ease-in-out hop. */
      ease?: 'fall' | 'hop' | 'stomp';
      landed: Set<number>;
      resolve: () => void;
      onHop?: () => void;
      onLand?: () => void;
    }
  >();
  /** Hold mesh at a world pos (e.g. during battle UI before PC hop). */
  private pinnedPos = new Map<string, THREE.Vector3>();
  private clash: {
    attackerUid: string;
    defenderUid: string;
    atkHome: THREE.Vector3;
    defHome: THREE.Vector3;
    /** Horizontal unit vector from attacker toward defender. */
    dir: THREE.Vector3;
    windupDist: number;
    strikeDist: number;
    knockDist: number;
    t0: number;
    ms: number;
    resolve: () => void;
  } | null = null;
  /** Turn-timer tubes at bench/field dividers (player / opponent). */
  private turnTimers: Record<
    PlayerId,
    { root: THREE.Group; fill: THREE.Mesh; glow: THREE.Mesh; length: number }
  > | null = null;
  readonly matchHud: MatchHud3D;
  private statusFlash = new Map<string, number>();
  private groundMat: THREE.MeshStandardMaterial | null = null;
  private boardTopMat: THREE.MeshStandardMaterial | null = null;
  private boardSideMats: THREE.MeshStandardMaterial[] = [];
  private floorMapDark: THREE.CanvasTexture | null = null;
  private floorMapLight: THREE.CanvasTexture | null = null;
  private woodTopDark: THREE.CanvasTexture | null = null;
  private woodTopLight: THREE.CanvasTexture | null = null;
  private woodSideDark: THREE.CanvasTexture | null = null;
  private woodSideLight: THREE.CanvasTexture | null = null;
  private woodBump: THREE.CanvasTexture | null = null;
  private benchRingMats: THREE.MeshBasicMaterial[] = [];
  private worldTheme: 'light' | 'dark' = 'dark';
  private lastLegal: string[] = [];
  private lastSelectedNode: string | null = null;

  constructor(engine: DuelEngine) {
    this.engine = engine;
    this.matchHud = new MatchHud3D(engine);
    this.routeMat = new THREE.MeshLambertMaterial({
      color: 0xffffff,
    });
    this.dimRouteMat = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
    });

    this.buildEnvironment();
    this.buildRoutes();
    this.buildNodes();
    this.buildBenches();
    this.layoutPlateHud();
    this.root.add(this.highlight);
    this.root.add(this.matchHud.root);
  }

  private layoutPlateHud() {
    const layout = this.benchLayout('player');
    const pc = this.pcWorldSlots('player');
    // Keep clear of figure tubes (r≈0.36) — tuck beside the PC, not midway into a bench slot.
    const figureClear = layout.rightEdge + layout.mirror * 0.5;
    const nearPc = pc[0].x - layout.mirror * 0.42;
    const x =
      layout.mirror > 0
        ? Math.max(figureClear, nearPc)
        : Math.min(figureClear, nearPc);
    this.matchHud.setPlateSlot(x, layout.zNear, layout.mirror);
  }

  /** Flash token when status applied. */
  flashStatus(uid: string) {
    this.statusFlash.set(uid, performance.now());
  }

  setCamera(camera: THREE.Camera) {
    this.viewCamera = camera;
    this.matchHud.setCamera(camera);
  }

  /** Day (light) / night (dark) albedo + accents for arena, board, routes. */
  setWorldTheme(theme: 'light' | 'dark') {
    this.worldTheme = theme;
    const day = theme === 'light';
    this.ensureThemeTextures(theme);

    if (this.groundMat) {
      const floor = day ? this.floorMapLight : this.floorMapDark;
      if (floor) this.groundMat.map = floor;
      this.groundMat.color.setHex(0xffffff);
      this.groundMat.emissive.setHex(day ? 0x000000 : 0x1a0c08);
      this.groundMat.emissiveIntensity = day ? 0 : 0.22;
      this.groundMat.metalness = day ? 0.02 : 0.06;
      this.groundMat.needsUpdate = true;
    }

    if (this.boardTopMat) {
      const wood = day ? this.woodTopLight : this.woodTopDark;
      if (wood) this.boardTopMat.map = wood;
      this.boardTopMat.color.setHex(0xffffff);
      this.boardTopMat.roughness = day ? 0.58 : 0.68;
      this.boardTopMat.needsUpdate = true;
    }

    const sideMap = day ? this.woodSideLight : this.woodSideDark;
    for (const m of this.boardSideMats) {
      if (sideMap) m.map = sideMap;
      m.color.setHex(day ? 0xfff8f0 : 0xe8e4e0);
      m.needsUpdate = true;
    }

    // Paths must contrast the board: white on night charcoal, ink on day oak
    this.routeMat.color.setHex(day ? 0x3a2818 : 0xffffff);
    this.routeMat.needsUpdate = true;
    this.dimRouteMat.color.copy(this.routeMat.color);
    this.dimRouteMat.opacity = day ? 0.18 : 0.2;
    this.dimRouteMat.needsUpdate = true;

    for (const m of this.benchRingMats) {
      m.color.setHex(day ? 0x5a4030 : 0xffffff);
      m.opacity = day ? 0.45 : 0.5;
      m.needsUpdate = true;
    }

    // Refresh move markers so green accent matches the new theme
    this.setHighlights(this.lastLegal, this.lastSelectedNode);
  }

  /** Legal-move green — tuned per theme for contrast on board/path. */
  private moveAccent() {
    if (this.worldTheme === 'light') {
      // Deep emerald on cream oak — cool hue, high sat, dark enough to punch
      return {
        color: 0x1a7f5c,
        emissive: 0x146349,
        emissiveIntensity: 0.35,
        opacity: 0.94,
      };
    }
    // Teal-mint on charcoal — cooler cyan bias, saturated, mid-dark luminance
    return {
      color: 0x14b89a,
      emissive: 0x0e9a80,
      emissiveIntensity: 0.45,
      opacity: 0.94,
    };
  }

  private moveAccentMat(pulse = true) {
    const a = this.moveAccent();
    // Unlit — Standard materials shimmer under lights when the camera orbits
    const mat = new THREE.MeshBasicMaterial({
      color: a.color,
      transparent: true,
      opacity: a.opacity,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    return { mat, accent: a, pulse };
  }

  /** Build day maps lazily so boot only pays for the active theme. */
  private ensureThemeTextures(theme: 'light' | 'dark') {
    if (theme === 'dark') {
      if (!this.floorMapDark) this.floorMapDark = createArenaFloorTexture(2560, 'dark');
      if (!this.woodTopDark) this.woodTopDark = createWoodTexture(1536, 'dark');
      if (!this.woodSideDark) {
        this.woodSideDark = createWoodTexture(512, 'dark');
        this.woodSideDark.repeat.set(1, 0.18);
        this.woodSideDark.wrapS = THREE.RepeatWrapping;
        this.woodSideDark.wrapT = THREE.ClampToEdgeWrapping;
      }
      return;
    }
    if (!this.floorMapLight) this.floorMapLight = createArenaFloorTexture(2560, 'light');
    if (!this.woodTopLight) this.woodTopLight = createWoodTexture(1536, 'light');
    if (!this.woodSideLight) {
      this.woodSideLight = createWoodTexture(512, 'light');
      this.woodSideLight.repeat.set(1, 0.18);
      this.woodSideLight.wrapS = THREE.RepeatWrapping;
      this.woodSideLight.wrapT = THREE.ClampToEdgeWrapping;
    }
  }

  private buildEnvironment() {
    this.ensureThemeTextures('dark');
    const roughMap = createArenaRoughnessTexture(1280);
    roughMap.wrapS = THREE.ClampToEdgeWrapping;
    roughMap.wrapT = THREE.ClampToEdgeWrapping;

    this.groundMat = new THREE.MeshStandardMaterial({
      map: this.floorMapDark!,
      roughnessMap: roughMap,
      color: 0xffffff,
      roughness: 1,
      metalness: 0.06,
      emissive: 0x1a0c08,
      emissiveIntensity: 0.22,
    });
    const ground = new THREE.Mesh(new THREE.CircleGeometry(48, 96), this.groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = FLOOR_Y;
    ground.receiveShadow = true;
    this.root.add(ground);

    this.woodBump = createWoodBumpTexture(768);
    this.boardTopMat = new THREE.MeshStandardMaterial({
      map: this.woodTopDark!,
      bumpMap: this.woodBump,
      bumpScale: 0.012,
      color: 0xffffff,
      roughness: 0.68,
      metalness: 0.03,
    });
    const sideMat = new THREE.MeshStandardMaterial({
      map: this.woodSideDark!,
      color: 0xe8e4e0,
      roughness: 0.78,
      metalness: 0.02,
    });
    this.boardSideMats = [
      sideMat,
      sideMat.clone(),
      sideMat.clone(),
      sideMat.clone(),
      sideMat.clone(),
    ];
    // Slightly rounded corners (radius capped by board thickness)
    const boardGeo = new RoundedBoxGeometry(5.2, BOARD_THICK, 5.6, 4, TIMER_R * 0.85);
    // Materials: +x -x +y -y +z -z
    const board = new THREE.Mesh(boardGeo, [
      this.boardSideMats[0],
      this.boardSideMats[1],
      this.boardTopMat,
      this.boardSideMats[2],
      this.boardSideMats[3],
      this.boardSideMats[4],
    ]);
    board.position.y = BOARD_TOP - BOARD_THICK / 2;
    board.castShadow = true;
    board.receiveShadow = true;
    this.root.add(board);

    // Transparent turn-timer cylinders (replace old yellow divider lines)
    this.turnTimers = {
      player: this.makeTurnTimerCylinder(3.2),
      opponent: this.makeTurnTimerCylinder(-3.2),
    };
    this.root.add(this.turnTimers.player.root);
    this.root.add(this.turnTimers.opponent.root);
  }

  /** Glass tube along X; fill depletes with remaining move time. */
  private makeTurnTimerCylinder(z: number): {
    root: THREE.Group;
    fill: THREE.Mesh;
    glow: THREE.Mesh;
    length: number;
  } {
    const length = 5.2; // match board width
    const outerR = TIMER_R;
    const innerR = TIMER_R * 0.78;
    const root = new THREE.Group();
    // Rest on the arena floor (not the duel board)
    root.position.set(0, FLOOR_Y + outerR, z);

    // Thin glass wall (outer + inner surface), very transparent
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xf2f7fc,
      transparent: true,
      opacity: 0.1,
      roughness: 0.12,
      metalness: 0.02,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const outer = new THREE.Mesh(
      new THREE.CylinderGeometry(outerR, outerR, length, 36, 1, true),
      wallMat,
    );
    outer.rotation.z = Math.PI / 2;
    root.add(outer);

    const inner = new THREE.Mesh(
      new THREE.CylinderGeometry(innerR, innerR, length, 36, 1, true),
      wallMat.clone(),
    );
    (inner.material as THREE.MeshStandardMaterial).opacity = 0.07;
    inner.rotation.z = Math.PI / 2;
    root.add(inner);

    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(outerR + 0.002, outerR + 0.002, length, 36, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.08,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    rim.rotation.z = Math.PI / 2;
    root.add(rim);

    for (const x of [-length / 2, length / 2]) {
      const cap = new THREE.Mesh(
        new THREE.RingGeometry(innerR, outerR, 36),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.14,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      cap.rotation.y = Math.PI / 2;
      cap.position.x = x;
      root.add(cap);
    }

    const fill = new THREE.Mesh(
      new THREE.CylinderGeometry(TIMER_R * 0.62, TIMER_R * 0.62, 1, 28),
      new THREE.MeshStandardMaterial({
        color: 0xffe082,
        emissive: 0xffab00,
        emissiveIntensity: 2.4,
        transparent: true,
        opacity: 0.95,
        roughness: 0.25,
        metalness: 0.05,
        toneMapped: false,
      }),
    );
    fill.rotation.z = Math.PI / 2;
    root.add(fill);

    const glow = new THREE.Mesh(
      new THREE.CylinderGeometry(TIMER_R * 0.88, TIMER_R * 0.88, 1, 28),
      new THREE.MeshBasicMaterial({
        color: 0xffc107,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    glow.rotation.z = Math.PI / 2;
    root.add(glow);

    return { root, fill, glow, length };
  }

  /**
   * Update turn-timer fills. `fraction` is remaining time 0–1 for the active side;
   * the inactive side stays empty.
   */
  setTurnTimer(active: PlayerId | null, fraction: number) {
    if (!this.turnTimers) return;
    const t = Math.max(0, Math.min(1, fraction));
    for (const owner of ['player', 'opponent'] as PlayerId[]) {
      const tube = this.turnTimers[owner];
      const fill = tube.fill;
      const glow = tube.glow;
      const mat = fill.material as THREE.MeshStandardMaterial;
      const glowMat = glow.material as THREE.MeshBasicMaterial;
      const on = active === owner;
      const f = on ? t : 0;
      const len = tube.length * f;
      const sy = Math.max(0.001, len);
      fill.scale.set(1, sy, 1);
      glow.scale.set(1, sy, 1);
      // Anchor fill to the left end (−X), depleting toward empty from the right
      const x = -tube.length / 2 + len / 2;
      fill.position.x = x;
      glow.position.x = x;
      fill.visible = f > 0.001;
      glow.visible = f > 0.001;
      if (on) {
        const urgent = t <= 0.17;
        mat.color.setHex(urgent ? 0xff8a80 : 0xffe082);
        mat.emissive.setHex(urgent ? 0xff1744 : 0xffab00);
        mat.emissiveIntensity = urgent ? 3.2 : 2.4;
        glowMat.color.setHex(urgent ? 0xff5252 : 0xffc107);
        glowMat.opacity = urgent ? 0.55 : 0.45;
      }
    }
  }

  private buildRoutes() {
    const seen = new Set<string>();
    for (const [a, list] of this.engine.board.edges) {
      for (const b of list) {
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const na = this.engine.board.nodes.get(a)!;
        const nb = this.engine.board.nodes.get(b)!;
        let wa = this.world(na);
        let wb = this.world(nb);
        if (na.kind === 'goal') {
          wa = this.goalLineAttach(wa, wb, na.owner === 'player' ? 1 : -1);
        }
        if (nb.kind === 'goal') {
          wb = this.goalLineAttach(wb, wa, nb.owner === 'player' ? 1 : -1);
        }
        this.root.add(this.makeRoute(wa, wb, ROUTE_Y, key));
      }
    }
  }

  /**
   * Path meets the outline triangle centerline:
   * toward tip → tip vertex; toward base → base midpoint.
   * dirSign +1 = tip +X (blue), −1 = tip −X (red).
   */
  private goalLineAttach(
    goal: THREE.Vector3,
    other: THREE.Vector3,
    dirSign: 1 | -1,
  ): THREE.Vector3 {
    const tipX = dirSign * GOAL_ARROW_S;
    const baseX = dirSign * (-GOAL_ARROW_S / 2);
    const towardOther = Math.sign(other.x - goal.x) || 1;
    if (towardOther === dirSign) {
      return goal.clone().add(new THREE.Vector3(tipX, 0, 0));
    }
    return goal.clone().add(new THREE.Vector3(baseX, 0, 0));
  }

  /** Bar along a→b — width × puck height, upright on the board. */
  private makeSquareBar(
    a: THREE.Vector3,
    b: THREE.Vector3,
    y: number,
    width: number,
    mat: THREE.Material,
  ) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    if (len < 1e-6) return new THREE.Group();
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, PUCK_H, len), mat);
    mesh.position.set(mid.x, y, mid.z);
    mesh.rotation.y = Math.atan2(dir.x, dir.z);
    return mesh;
  }

  /** Thin square route — board path lines. */
  private makeRoute(a: THREE.Vector3, b: THREE.Vector3, y = ROUTE_Y, edgeKey?: string) {
    const mesh = this.makeSquareBar(a, b, y, ROUTE_SIDE, this.routeMat);
    if (mesh instanceof THREE.Mesh) {
      mesh.userData.routePart = true;
      if (edgeKey) {
        mesh.userData.edgeKey = edgeKey;
        this.boardRouteMeshes.push(mesh);
      }
    }
    return mesh;
  }

  /** Hockey-puck node — flat cylinder, same material as path lines. */
  private makeNodePuck(radius = NODE_RADIUS, y = ROUTE_Y) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, PUCK_H, 28),
      this.routeMat,
    );
    mesh.position.y = y;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.nodePuck = true;
    return mesh;
  }

  /** Single square-tube ring around an entry (same bar profile as path lines). */
  private makeEntryRing(radius = 0.22) {
    const hw = ROUTE_SIDE / 2;
    const hh = PUCK_H / 2;
    const shape = new THREE.Shape();
    shape.moveTo(-hw, -hh);
    shape.lineTo(hw, -hh);
    shape.lineTo(hw, hh);
    shape.lineTo(-hw, hh);
    shape.closePath();

    const segs = 64;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= segs; i++) {
      const t = (i / segs) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(t) * radius, 0, Math.sin(t) * radius));
    }
    const path = new THREE.CatmullRomCurve3(pts, true);
    const geo = new THREE.ExtrudeGeometry(shape, {
      steps: segs,
      bevelEnabled: false,
      extrudePath: path,
    });
    const mesh = new THREE.Mesh(geo, this.routeMat);
    mesh.position.y = ROUTE_Y;
    mesh.userData.entryRing = true;
    return mesh;
  }

  /** Outline triangle: same bars as paths + cube joints at corners. */
  private makeGoalArrowOutline(y = ROUTE_Y): THREE.Group {
    const s = GOAL_ARROW_S;
    const hy = (s * Math.sqrt(3)) / 2;
    const tip = new THREE.Vector3(s, y, 0);
    const b0 = new THREE.Vector3(-s / 2, y, hy);
    const b1 = new THREE.Vector3(-s / 2, y, -hy);

    const g = new THREE.Group();
    g.add(this.makeRoute(tip, b0, y));
    g.add(this.makeRoute(tip, b1, y));
    g.add(this.makeRoute(b0, b1, y));

    for (const p of [tip, b0, b1]) {
      const joint = new THREE.Mesh(
        new THREE.BoxGeometry(ROUTE_SIDE, PUCK_H, ROUTE_SIDE),
        this.routeMat,
      );
      joint.position.copy(p);
      joint.userData.routePart = true;
      g.add(joint);
    }
    return g;
  }

  private buildNodes() {
    for (const node of this.engine.board.nodes.values()) {
      const g = this.makeNode(node);
      this.nodeMeshes.set(node.id, g);
      this.root.add(g);
    }
  }

  private makeNode(node: BoardNode) {
    const g = new THREE.Group();
    const w = this.world(node);
    g.position.set(w.x, 0, w.z);
    g.userData.nodeId = node.id;

    if (node.kind === 'entry') {
      g.add(this.makeNodePuck());
      g.add(this.makeEntryRing());
    } else if (node.kind === 'goal') {
      // Flat team-color background (not a raised puck)
      const isBottom = node.owner === 'player';
      const color = isBottom ? 0x1565c0 : 0xb71c1c;

      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(0.28, 32),
        new THREE.MeshLambertMaterial({
          color,
          side: THREE.DoubleSide,
        }),
      );
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = BOARD_TOP + 0.004;
      disc.userData.goalDecor = true;
      disc.userData.baseOpacity = 1;
      g.add(disc);

      const rim = new THREE.Mesh(
        new THREE.RingGeometry(0.28, 0.34, 32),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.9,
          side: THREE.DoubleSide,
        }),
      );
      rim.rotation.x = -Math.PI / 2;
      rim.position.y = BOARD_TOP + 0.006;
      rim.userData.goalDecor = true;
      rim.userData.baseOpacity = 0.9;
      g.add(rim);

      // Same height as path lines so the outline joins the routes
      const arrow = this.makeGoalArrowOutline();
      if (!isBottom) arrow.rotation.y = Math.PI;
      g.add(arrow);
    } else {
      g.add(this.makeNodePuck());
    }

    const hit = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 0.12, 16),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    hit.position.y = BOARD_TOP + 0.02;
    hit.userData.nodeId = node.id;
    g.add(hit);

    return g;
  }

  private buildBenches() {
    for (const owner of ['player', 'opponent'] as PlayerId[]) {
      const slots = this.benchWorldSlots(owner);
      for (const pos of slots) {
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.5,
          side: THREE.DoubleSide,
        });
        this.benchRingMats.push(ringMat);
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.34, 28), ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(pos.x, FLOOR_Y + 0.002, pos.z);
        this.root.add(ring);
      }

      // PC pads — same hockey pucks as board nodes, linked by a route
      const pcSlots = this.pcWorldSlots(owner);
      for (const pos of pcSlots) {
        const puck = this.makeNodePuck(NODE_RADIUS, FLOOR_PUCK_Y);
        puck.position.x = pos.x;
        puck.position.z = pos.z;
        this.auxRouteMeshes.push(puck);
        this.root.add(puck);
      }
      if (pcSlots.length >= 2) {
        const link = this.makeFloorRoute(pcSlots[0], pcSlots[1]);
        if (link instanceof THREE.Mesh) this.auxRouteMeshes.push(link);
        this.root.add(link);
      }
    }
  }

  /** Route segment on the arena floor (PC queue link). */
  private makeFloorRoute(a: THREE.Vector3, b: THREE.Vector3) {
    const mesh = this.makeSquareBar(a, b, FLOOR_PUCK_Y, ROUTE_SIDE, this.routeMat);
    if (mesh instanceof THREE.Mesh) mesh.userData.routePart = true;
    return mesh;
  }

  /**
   * Olympic-rings layout: player on the left, opponent mirrored on the right.
   */
  benchWorldSlots(owner: PlayerId): THREE.Vector3[] {
    const { zNear, zFar, xs } = this.benchLayout(owner);
    return [
      ...xs.front.map((x) => new THREE.Vector3(x, FLOOR_Y, zNear)),
      ...xs.back.map((x) => new THREE.Vector3(x, FLOOR_Y, zFar)),
    ];
  }

  /** Shared bench geometry so PC can line up on the same row. */
  private benchLayout(owner: PlayerId) {
    const d = 0.88;
    const row = d * Math.sqrt(3) * 0.5;
    const zNear = owner === 'player' ? 3.85 : -3.85;
    const zFar = owner === 'player' ? zNear + row : zNear - row;
    // Opponent (red) is mirrored on X
    const mirror = owner === 'opponent' ? -1 : 1;
    const front = [-d, 0, d].map((x) => x * mirror);
    const back = [-d * 0.5, d * 0.5, d * 1.5].map((x) => x * mirror);
    const mid = [...front, ...back].reduce((a, b) => a + b, 0) / 6;
    const xShift = -1.05 * mirror;
    const xs = {
      front: front.map((x) => x - mid + xShift),
      back: back.map((x) => x - mid + xShift),
    };
    const leftEdge = Math.min(...xs.front, ...xs.back);
    const rightEdge = Math.max(...xs.front, ...xs.back);
    return { zNear, zFar, xs, leftEdge, rightEdge, mirror };
  }

  /**
   * PC queue on the bottom bench row (back row toward the camera).
   * Stays inside the board edge (±2.6).
   */
  pcWorldSlots(owner: PlayerId): THREE.Vector3[] {
    const { zFar, mirror } = this.benchLayout(owner);
    const gap = 0.75;
    const y = FLOOR_Y;
    const boardEnd = 2.6; // half of board width 5.2
    const padHalf = gap / 2 + 0.48;
    const xCenter = mirror * (boardEnd - padHalf);
    const xFront = xCenter - mirror * (gap / 2);
    const xBack = xCenter + mirror * (gap / 2);
    return [
      new THREE.Vector3(xFront, y, zFar),
      new THREE.Vector3(xBack, y, zFar),
    ];
  }

  world(node: BoardNode) {
    // board y (north) → -world z so opponent is away from camera
    return new THREE.Vector3(node.x, 0, -node.y);
  }

  pieceWorldPos(uid: string): THREE.Vector3 | null {
    const g = this.pieceMeshes.get(uid);
    return g ? g.position.clone() : null;
  }

  isAnimating(uid?: string): boolean {
    if (uid) {
      return (
        this.moveAnims.has(uid) ||
        this.clash?.attackerUid === uid ||
        this.clash?.defenderUid === uid
      );
    }
    return this.moveAnims.size > 0 || !!this.clash;
  }

  /**
   * Attack intro: wind-up → lunge into the defender → knockback, then settle.
   */
  animateBattleIntro(attackerUid: string, defenderUid: string): Promise<void> {
    const ga = this.pieceMeshes.get(attackerUid);
    const gb = this.pieceMeshes.get(defenderUid);
    if (!ga || !gb) return Promise.resolve();

    const atkHome = ga.position.clone();
    const defHome = gb.position.clone();

    const dir = defHome.clone().sub(atkHome);
    dir.y = 0;
    const dist = dir.length();
    if (dist < 1e-4) dir.set(1, 0, 0);
    else dir.normalize();

    // Short close-in bump — reads as a hit without leaving the pads.
    const strikeDist = Math.min(0.14, Math.max(0.08, dist * 0.18));
    const windupDist = Math.min(0.05, dist * 0.06);
    const knockDist = Math.min(0.07, Math.max(0.04, dist * 0.08));

    if (this.clash) {
      this.clash.resolve();
      this.clash = null;
    }

    return new Promise((resolve) => {
      this.clash = {
        attackerUid,
        defenderUid,
        atkHome,
        defHome,
        dir,
        windupDist,
        strikeDist,
        knockDist,
        t0: performance.now(),
        ms: 480,
        resolve,
      };
    });
  }

  pinPiece(uid: string, pos: THREE.Vector3) {
    this.pinnedPos.set(uid, pos.clone());
    const g = this.pieceMeshes.get(uid);
    if (g) {
      g.position.copy(pos);
      g.scale.set(1, 1, 1);
    }
  }

  clearPin(uid: string) {
    this.pinnedPos.delete(uid);
  }

  /** World position of a piece's stable bench slot. */
  benchWorldForPiece(uid: string): THREE.Vector3 | null {
    const piece = this.engine.piece(uid);
    if (!piece) return null;
    const slots = this.benchWorldSlots(piece.owner);
    const i = Math.min(Math.max(0, piece.benchSlot), slots.length - 1);
    return slots[i].clone();
  }

  /** World position of a PC pad by slot index (for eject anim start). */
  pcWorldSlot(owner: PlayerId, slot: number): THREE.Vector3 {
    const slots = this.pcWorldSlots(owner);
    return slots[Math.min(Math.max(0, slot), slots.length - 1)].clone();
  }

  /** World position of a piece's current PC slot (FIFO queue index). */
  pcWorldForPiece(uid: string): THREE.Vector3 | null {
    const piece = this.engine.piece(uid);
    if (!piece || piece.location !== 'pc') return null;
    const i = this.engine.pcSlotIndex(uid);
    if (i < 0) return null;
    const slots = this.pcWorldSlots(piece.owner);
    return slots[Math.min(i, slots.length - 1)].clone();
  }

  /** Hop along world waypoints (include start). Resolves when the last land finishes. */
  animateAlongPath(
    uid: string,
    waypoints: THREE.Vector3[],
    opts?: {
      hopMs?: number;
      hopHeight?: number;
      delayMs?: number;
      ease?: 'fall' | 'hop' | 'stomp';
      onHop?: () => void;
      onLand?: () => void;
    },
  ): Promise<void> {
    const pts = waypoints.map((p) => p.clone());
    if (pts.length < 2) return Promise.resolve();
    const g = this.pieceMeshes.get(uid);
    if (g) g.position.copy(pts[0]);

    return new Promise((resolve) => {
      this.moveAnims.set(uid, {
        waypoints: pts,
        hop: 0,
        t0: performance.now() + (opts?.delayMs ?? 0),
        hopMs: opts?.hopMs ?? 280,
        hopHeight: opts?.hopHeight ?? 0.55,
        ease: opts?.ease ?? 'hop',
        landed: new Set(),
        resolve,
        onHop: opts?.onHop,
        onLand: opts?.onLand,
      });
    });
  }

  /**
   * Match-start intro: bench figures drop from above onto their pads (staggered).
   */
  playBenchDropIntro(opts?: { onLand?: () => void }): Promise<void> {
    const DROP_H = 3.2;
    const pieces = this.engine.state.pieces.filter(
      (p) => !p.removed && p.location === 'bench',
    );
    const promises: Promise<void>[] = [];

    for (const piece of pieces) {
      let g = this.pieceMeshes.get(piece.uid);
      if (!g) {
        g = this.makePiece(piece);
        this.pieceMeshes.set(piece.uid, g);
        this.root.add(g);
      }
      const slots = this.benchWorldSlots(piece.owner);
      const i = Math.min(Math.max(0, piece.benchSlot), slots.length - 1);
      const dest = slots[i].clone();
      const start = dest.clone();
      start.y += DROP_H;
      g.position.copy(start);
      g.scale.set(1, 1, 1);

      // Same slot on both sides drops together
      const delayMs = piece.benchSlot * 85;
      promises.push(
        this.animateAlongPath(piece.uid, [start, dest], {
          hopMs: 480,
          hopHeight: 0,
          delayMs,
          ease: 'fall',
          onLand: opts?.onLand,
        }),
      );
    }

    return Promise.all(promises).then(() => undefined);
  }

  private updateMoveAnims(now: number) {
    for (const [uid, anim] of [...this.moveAnims]) {
      const g = this.pieceMeshes.get(uid);
      if (!g) {
        anim.resolve();
        this.moveAnims.delete(uid);
        continue;
      }

      const from = anim.waypoints[anim.hop];
      const to = anim.waypoints[anim.hop + 1];
      if (!from || !to) {
        anim.resolve();
        this.moveAnims.delete(uid);
        continue;
      }

      // Hold at start until delayed t0
      if (now < anim.t0) {
        g.position.copy(from);
        continue;
      }

      if (anim.hop === 0 && !anim.landed.has(-1)) {
        anim.landed.add(-1);
        anim.onHop?.();
      }

      const u = Math.min(1, (now - anim.t0) / anim.hopMs);
      let xzEase = u;
      let hopFactor = Math.sin(Math.PI * u);
      if (anim.ease === 'fall') {
        xzEase = u * u;
        hopFactor = Math.sin(Math.PI * u);
      } else if (anim.ease === 'stomp') {
        // Commit sideways early, hang in the air, then slam down
        xzEase = 1 - Math.pow(1 - u, 2.4);
        if (u < 0.32) {
          const t = u / 0.32;
          hopFactor = Math.sin((t * Math.PI) / 2);
        } else {
          const t = (u - 0.32) / 0.68;
          hopFactor = 1 - t * t * t; // ease-in drop
        }
      } else {
        xzEase = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      }

      g.position.x = from.x + (to.x - from.x) * xzEase;
      g.position.z = from.z + (to.z - from.z) * xzEase;
      const baseY = from.y + (to.y - from.y) * xzEase;
      g.position.y = baseY + hopFactor * anim.hopHeight;

      if (anim.ease === 'fall') {
        const stretch = 1 + Math.sin(Math.PI * u) * 0.08;
        const squash = u > 0.85 ? 1 - (u - 0.85) * 0.35 : 1;
        g.scale.set(1 / stretch, stretch * squash, 1 / stretch);
      } else if (anim.ease === 'stomp') {
        // Impact squash eases back out so the land doesn't pop
        if (u > 0.86) {
          const s = (u - 0.86) / 0.14;
          const squash = 1 - Math.sin(s * Math.PI) * 0.16;
          g.scale.set(1 / squash, squash, 1 / squash);
        } else {
          g.scale.set(1, 1, 1);
        }
      } else {
        g.scale.set(1, 1, 1);
      }

      if (u >= 1) {
        g.position.copy(to);
        g.position.y = to.y;
        if (!anim.landed.has(anim.hop + 1)) {
          anim.landed.add(anim.hop + 1);
          anim.onLand?.();
        }
        anim.hop += 1;
        anim.t0 = now;
        if (anim.hop >= anim.waypoints.length - 1) {
          g.scale.set(1, 1, 1);
          anim.resolve();
          this.moveAnims.delete(uid);
        } else {
          anim.onHop?.();
        }
      }
    }
  }

  private updateClashAnim(now: number) {
    const c = this.clash;
    if (!c) return;

    const u = Math.min(1, (now - c.t0) / c.ms);
    const ga = this.pieceMeshes.get(c.attackerUid);
    const gb = this.pieceMeshes.get(c.defenderUid);
    const smooth = (t: number) => t * t * (3 - 2 * t);

    // Phases: wind-up → strike → impact hold → recover
    let atkAlong = 0;
    let defAlong = 0;
    let atkHop = 0;
    let defHop = 0;
    let atkSx = 1;
    let atkSy = 1;
    let defSx = 1;
    let defSy = 1;

    if (u < 0.16) {
      // Wind-up: slight pull back
      const t = smooth(u / 0.16);
      atkAlong = -c.windupDist * t;
      atkSx = 1 + 0.03 * t;
      atkSy = 1 - 0.04 * t;
    } else if (u < 0.38) {
      // Strike: quick nudge into the defender
      const t = smooth((u - 0.16) / 0.22);
      atkAlong = -c.windupDist + (c.windupDist + c.strikeDist) * t;
      atkHop = Math.sin(Math.PI * t) * 0.05;
      atkSx = 1 - 0.03 * t;
      atkSy = 1 + 0.06 * t;
    } else if (u < 0.48) {
      // Soft impact + tiny defender rock
      const t = (u - 0.38) / 0.1;
      const hit = Math.sin(Math.min(1, t) * Math.PI);
      atkAlong = c.strikeDist;
      defAlong = c.knockDist * smooth(Math.min(1, t * 1.3));
      atkHop = 0.01;
      defHop = hit * 0.035;
      atkSx = 1.05 - 0.03 * t;
      atkSy = 0.94 + 0.04 * t;
      defSx = 1.05;
      defSy = 0.94 + 0.04 * t;
    } else {
      // Settle home
      const t = smooth((u - 0.48) / 0.52);
      atkAlong = c.strikeDist * (1 - t);
      defAlong = c.knockDist * (1 - t);
      atkHop = Math.sin(Math.PI * (1 - t)) * 0.015 * (1 - t);
      defHop = Math.sin(Math.PI * (1 - t)) * 0.02 * (1 - t);
      atkSx = 1 + 0.02 * (1 - t);
      atkSy = 1 - 0.02 * (1 - t);
      defSx = 1 + 0.02 * (1 - t);
      defSy = 1 - 0.02 * (1 - t);
    }

    if (ga) {
      ga.position.set(
        c.atkHome.x + c.dir.x * atkAlong,
        c.atkHome.y + atkHop,
        c.atkHome.z + c.dir.z * atkAlong,
      );
      ga.scale.set(atkSx, atkSy, atkSx);
    }
    if (gb) {
      gb.position.set(
        c.defHome.x + c.dir.x * defAlong,
        c.defHome.y + defHop,
        c.defHome.z + c.dir.z * defAlong,
      );
      gb.scale.set(defSx, defSy, defSx);
    }

    if (u >= 1) {
      if (ga) {
        ga.position.copy(c.atkHome);
        ga.scale.set(1, 1, 1);
      }
      if (gb) {
        gb.position.copy(c.defHome);
        gb.scale.set(1, 1, 1);
      }
      c.resolve();
      this.clash = null;
    }
  }

  syncPieces(pieces: Piece[], t = 0) {
    const now = performance.now();
    this.updateMoveAnims(now);
    this.updateClashAnim(now);

    const live = new Set(pieces.filter((p) => !p.removed).map((p) => p.uid));
    for (const [id, g] of this.pieceMeshes) {
      if (!live.has(id)) {
        this.root.remove(g);
        this.pieceMeshes.delete(id);
        this.moveAnims.delete(id);
      }
    }

    const selectedUid = this.engine.state.selectedUid;
    const clashUids = this.clash
      ? new Set([this.clash.attackerUid, this.clash.defenderUid])
      : null;

    for (const piece of pieces) {
      if (piece.removed) continue;
      if (piece.location !== 'field' && piece.location !== 'bench' && piece.location !== 'pc') {
        continue;
      }

      let g = this.pieceMeshes.get(piece.uid);
      if (!g) {
        g = this.makePiece(piece);
        this.pieceMeshes.set(piece.uid, g);
        this.root.add(g);
      }

      const animating = this.moveAnims.has(piece.uid);
      const pinned = this.pinnedPos.get(piece.uid);
      const clashing = !!clashUids?.has(piece.uid);

      let target: THREE.Vector3;
      if (piece.location === 'field' && piece.nodeId) {
        const node = this.engine.board.nodes.get(piece.nodeId)!;
        target = this.world(node);
        target.y = BOARD_TOP;

      } else if (piece.location === 'pc') {
        const slots = this.pcWorldSlots(piece.owner);
        const i = Math.max(0, this.engine.pcSlotIndex(piece.uid));
        target = slots[Math.min(i, slots.length - 1)].clone();
      } else {
        const slots = this.benchWorldSlots(piece.owner);
        const i = Math.min(Math.max(0, piece.benchSlot), slots.length - 1);
        target = slots[i].clone();
      }

      if (animating) {
        // move anim owns the transform
      } else if (pinned) {
        g.position.copy(pinned);
      } else if (!clashing) {
        g.position.x += (target.x - g.position.x) * 0.3;
        g.position.z += (target.z - g.position.z) * 0.3;
        g.position.y = target.y;
      }

      const waiting = piece.wait > 0;
      this.syncPieceBadge(g, piece);
      this.syncStatusIcons(g, piece, t);
      const selected = piece.uid === selectedUid && !animating && !pinned && !clashing;
      const isPlateTarget = this.plateTargetUids.includes(piece.uid);
      const isPlateFocus = piece.uid === this.plateFocusUid;

      const selectRing = g.userData.selectRing as THREE.Mesh | undefined;
      if (selectRing) {
        selectRing.visible = selected || isPlateTarget;
        if (selected || isPlateTarget) {
          const mat = selectRing.material as THREE.MeshStandardMaterial;
          if (isPlateTarget) {
            mat.color.setHex(isPlateFocus ? 0xffab40 : 0x40c4ff);
            mat.emissive.setHex(isPlateFocus ? 0xff6d00 : 0x00b0ff);
          } else {
            mat.color.setHex(0xffe66d);
            mat.emissive.setHex(0xffc107);
          }
          mat.opacity = 0.72 + Math.sin(t * 5) * 0.16;
          mat.emissiveIntensity = (isPlateTarget ? 0.75 : 0.5) + Math.sin(t * 5) * 0.2;
        }
      }

      if (!animating && !pinned && !clashing) {
        const orbRoot = g.userData.orb as THREE.Object3D | undefined;
        const statusPlane = g.userData.statusPlane as THREE.Object3D | undefined;
        g.traverse((o) => {
          if (o === selectRing) return;
          if (o === statusPlane) return;
          if (orbRoot && (o === orbRoot || o.parent === orbRoot)) return;
          if (o instanceof THREE.Mesh && o.material instanceof THREE.Material) {
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) {
              m.transparent = true;
              m.opacity = waiting ? 0.72 : 1;
            }
          }
          if (o instanceof THREE.Sprite && o.material instanceof THREE.SpriteMaterial) {
            o.material.opacity = waiting ? 0.72 : 1;
          }
        });
        g.scale.setScalar(isPlateTarget ? 1.08 + Math.sin(t * 4) * 0.03 : 1);
      }

      // Inverted test-tube + art facing the camera
      const orb = g.userData.orb as THREE.Group | undefined;
      if (orb) {
        const baseY = (g.userData.orbBaseY as number) ?? 0.185;
        orb.position.y = baseY;
      }
      const art = g.userData.orbArt as THREE.Mesh | undefined;
      if (art && this.viewCamera) {
        art.lookAt(this.viewCamera.position);
      }
    }

    this.matchHud.sync(t);
  }

  pickPlate(raycaster: THREE.Raycaster) {
    return this.matchHud.pickPlate(raycaster);
  }

  private makePiece(piece: Piece) {
    const g = new THREE.Group();
    const team = piece.owner === 'player' ? 0x1565c0 : 0xb71c1c;
    const teamCss = piece.owner === 'player' ? '#1565c0' : '#b71c1c';
    const orbCol = pokemonColor(piece.name);

    // Thick token base — team color (blue / red)
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.36, 0.16, 28),
      new THREE.MeshStandardMaterial({
        color: team,
        metalness: 0.45,
        roughness: 0.38,
        emissive: team,
        emissiveIntensity: 0.18,
      }),
    );
    base.position.y = 0.08;
    base.castShadow = true;
    base.receiveShadow = true;
    g.add(base);

    // Selection ring (yellow when selected; plate targets override in sync)
    const selectRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.016, 10, 36),
      new THREE.MeshStandardMaterial({
        color: 0xffe66d,
        emissive: 0xffc107,
        emissiveIntensity: 0.5,
        transparent: true,
        opacity: 0.88,
        roughness: 0.45,
        metalness: 0.05,
      }),
    );
    selectRing.rotation.x = Math.PI / 2;
    selectRing.position.y = 0.02;
    selectRing.visible = false;
    g.userData.selectRing = selectRing;
    g.add(selectRing);

    // White name wrapped around the base (static)
    const nameMap = createNameBandTexture(piece.name);
    const bandH = 0.16 * 0.9;
    const nameBand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.341, 0.361, bandH, 48, 1, true),
      new THREE.MeshStandardMaterial({
        map: nameMap,
        transparent: true,
        alphaTest: 0.05,
        depthWrite: false,
        roughness: 0.45,
        metalness: 0.05,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    );
    nameBand.position.y = 0.08;
    // Center the label on the player / camera side (+Z)
    nameBand.rotation.y = Math.PI;
    g.add(nameBand);

    // Soft cork pad the tube sits on
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.36, 0.04, 24),
      new THREE.MeshStandardMaterial({
        color: 0x121820,
        metalness: 0.4,
        roughness: 0.5,
      }),
    );
    pad.position.y = 0.18;
    g.add(pad);

    // Inverted glass test tube (open rim down, rounded dome up)
    const tubeR = 0.34;
    const tubeH = 0.3;
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: orbGlassColor(orbCol),
      emissive: orbCol,
      emissiveIntensity: 0.08,
      metalness: 0.05,
      roughness: 0.06,
      transparent: true,
      opacity: 0.28,
      // Write depth so floor plates behind/under the tube stay occluded.
      depthWrite: true,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      side: THREE.DoubleSide,
    });

    const orbRoot = new THREE.Group();
    orbRoot.position.y = 0.2;
    g.add(orbRoot);

    // Open cylinder body
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(tubeR, tubeR, tubeH, 36, 1, true),
      glassMat,
    );
    body.position.y = tubeH / 2;
    body.castShadow = true;
    body.renderOrder = 3;
    orbRoot.add(body);

    // Closed dome on top
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(tubeR, 36, 18, 0, Math.PI * 2, 0, Math.PI / 2),
      glassMat,
    );
    dome.position.y = tubeH;
    dome.renderOrder = 3;
    orbRoot.add(dome);

    // Soft highlight on the dome
    const shine = new THREE.Mesh(
      new THREE.SphereGeometry(tubeR * 0.98, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.32),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
      }),
    );
    shine.position.set(-0.03, tubeH + 0.02, 0.04);
    orbRoot.add(shine);

    // Pokémon art sealed inside the tube
    const placeholder = createPlaceholderOrbTexture(orbCol);
    const artMat = new THREE.MeshBasicMaterial({
      map: placeholder,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    // Large enough to read; kept in the cylinder body so angled lookAt won't pierce the dome.
    const artR = tubeR * 0.78;
    const art = new THREE.Mesh(new THREE.CircleGeometry(artR, 40), artMat);
    art.position.y = tubeH * 0.48;
    art.renderOrder = 2;
    orbRoot.add(art);

    g.userData.orb = orbRoot;
    g.userData.orbArt = art;
    g.userData.orbBaseY = 0.2;
    g.userData.orbMat = artMat;

    void getPokemonOrbTexture(piece.name, orbCol).then((tex) => {
      const mat = g.userData.orbMat as THREE.MeshBasicMaterial | undefined;
      if (!mat) return;
      const prev = mat.map;
      mat.map = tex;
      mat.needsUpdate = true;
      prev?.dispose();
    });

    // MP / Wait badge at the front corner of the disc
    const mpMap = createMpBadgeTexture(piece.baseMp, teamCss);
    const badge = new THREE.Group();
    const badgeBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 0.048, 20),
      new THREE.MeshStandardMaterial({
        color: team,
        metalness: 0.35,
        roughness: 0.4,
      }),
    );
    badgeBody.castShadow = true;
    badge.add(badgeBody);

    const badgeFace = new THREE.Mesh(
      new THREE.CircleGeometry(0.086, 24),
      new THREE.MeshBasicMaterial({
        map: mpMap,
        side: THREE.DoubleSide,
        toneMapped: false,
        depthWrite: true,
      }),
    );
    badgeFace.rotation.x = -Math.PI / 2;
    badgeFace.position.y = 0.025;
    badge.add(badgeFace);

    // Front rim / corner of the token; tilt face toward the camera (+Z)
    badge.position.set(0, 0.22, 0.28);
    badge.rotation.x = 0.55;
    g.add(badge);

    g.userData.pieceUid = piece.uid;
    g.userData.badgeBody = badgeBody;
    g.userData.badgeFace = badgeFace;
    g.userData.mpMap = mpMap;
    g.userData.waitMap = null as THREE.CanvasTexture | null;
    g.userData.badgeWaitCount = 0;
    g.userData.teamColor = team;

    // Status icon strip above the tube
    const statusPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.55, 0.14),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    statusPlane.position.set(0, 0.95, 0);
    g.add(statusPlane);
    g.userData.statusPlane = statusPlane;
    g.userData.statusKey = '';
    g.userData.statusPop = 0;

    return g;
  }

  private syncStatusIcons(g: THREE.Group, piece: Piece, t?: number) {
    const plane = g.userData.statusPlane as THREE.Mesh | undefined;
    if (!plane) return;
    const key = piece.statuses.join(',');
    const mat = plane.material as THREE.MeshBasicMaterial;
    if (g.userData.statusKey !== key) {
      g.userData.statusKey = key;
      mat.map?.dispose();
      if (piece.statuses.length) {
        mat.map = createStatusIconsTexture(piece.statuses);
        mat.opacity = 1;
        g.userData.statusPop = performance.now();
        this.statusFlash.set(piece.uid, performance.now());
      } else {
        mat.map = null;
        mat.opacity = 0;
      }
      mat.needsUpdate = true;
    }
    const pop = g.userData.statusPop as number;
    if (pop && performance.now() - pop < 280) {
      const u = (performance.now() - pop) / 280;
      plane.scale.setScalar(0.6 + Math.sin(u * Math.PI) * 0.55);
    } else {
      plane.scale.setScalar(1);
    }
    const flash = this.statusFlash.get(piece.uid);
    if (flash && performance.now() - flash < 350) {
      const base = g.children[0];
      if (base instanceof THREE.Mesh && base.material instanceof THREE.MeshStandardMaterial) {
        base.material.emissiveIntensity =
          0.18 + 0.7 * (1 - (performance.now() - flash) / 350);
      }
    }
    if (this.viewCamera) plane.quaternion.copy(this.viewCamera.quaternion);
    void t;
  }

  private syncPieceBadge(g: THREE.Group, piece: Piece) {
    const wait = Math.max(0, piece.wait | 0);
    const waiting = wait > 0;
    if (waiting && g.userData.badgeWaitCount === wait) return;
    if (!waiting && g.userData.badgeWaitCount === 0) return;

    const face = g.userData.badgeFace as THREE.Mesh;
    const body = g.userData.badgeBody as THREE.Mesh;
    const faceMat = face.material as THREE.MeshBasicMaterial;
    const bodyMat = body.material as THREE.MeshStandardMaterial;

    // Dispose prior wait texture when regenerating / clearing
    const oldWait = g.userData.waitMap as THREE.CanvasTexture | null;
    if (oldWait) {
      oldWait.dispose();
      g.userData.waitMap = null;
    }

    if (waiting) {
      const waitMap = createWaitBadgeTexture(wait);
      g.userData.waitMap = waitMap;
      g.userData.badgeWaitCount = wait;
      faceMat.map = waitMap;
      bodyMat.color.setHex(0x111111);
      bodyMat.emissive.setHex(0x000000);
      bodyMat.emissiveIntensity = 0;
    } else {
      g.userData.badgeWaitCount = 0;
      faceMat.map = g.userData.mpMap as THREE.CanvasTexture;
      bodyMat.color.setHex(g.userData.teamColor as number);
      bodyMat.emissive.setHex(g.userData.teamColor as number);
      bodyMat.emissiveIntensity = 0;
    }
    faceMat.needsUpdate = true;
  }

  setPlateTargets(uids: string[], focusUid: string | null = null) {
    this.plateTargetUids = uids;
    this.plateFocusUid = focusUid;
  }

  setHighlights(legal: string[], selectedNode: string | null) {
    this.lastLegal = legal;
    this.lastSelectedNode = selectedNode;

    while (this.highlight.children.length) {
      const c = this.highlight.children[0];
      this.highlight.remove(c);
      if (c instanceof THREE.Mesh) {
        c.geometry.dispose();
        const m = c.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    }

    const { nodeIds, edges } = this.legalPathGraph(legal);
    const edgeKeys = new Set(edges.map(([a, b]) => (a < b ? `${a}|${b}` : `${b}|${a}`)));
    this.syncNetworkDim(legal.length ? nodeIds : null, legal.length ? edgeKeys : null);

    // Enlarge path pucks; green stroke radius matches that diameter
    this.resetNodeScales();
    for (const id of nodeIds) {
      const isDest = legal.includes(id);
      const diameter = isDest ? PATH_DEST_SCALE : PATH_NODE_SCALE;
      this.setNodeDiameterScale(id, diameter);
      this.highlight.add(this.makeHighlightPuck(id, isDest ? 1 : 0.72, diameter));
    }

    for (const [a, b] of edges) {
      this.highlight.add(this.makeHighlightRoute(a, b));
    }

    if (selectedNode) {
      const node = this.engine.board.nodes.get(selectedNode);
      if (node) {
        const w = this.world(node);
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.32, 0.018, 10, 40),
          new THREE.MeshStandardMaterial({
            color: 0xffe66d,
            emissive: 0xffc107,
            emissiveIntensity: 0.5,
            transparent: true,
            opacity: 0.9,
            roughness: 0.45,
            metalness: 0.05,
            depthWrite: false,
          }),
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.set(w.x, ROUTE_Y + PUCK_H * 0.55, w.z);
        this.highlight.add(ring);
      }
    }

    // Plate target markers under valid figures.
    for (const uid of this.plateTargetUids) {
      const piece = this.engine.piece(uid);
      if (!piece) continue;
      const g = this.pieceMeshes.get(uid);
      if (!g) continue;
      const focus = uid === this.plateFocusUid;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(focus ? 0.42 : 0.36, focus ? 0.028 : 0.022, 10, 40),
        new THREE.MeshStandardMaterial({
          color: focus ? 0xffab40 : 0x40c4ff,
          emissive: focus ? 0xff6d00 : 0x00b0ff,
          emissiveIntensity: focus ? 0.85 : 0.7,
          transparent: true,
          opacity: 0.95,
          roughness: 0.4,
          metalness: 0.1,
          depthWrite: false,
        }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(g.position.x, BOARD_TOP + 0.02, g.position.z);
      ring.userData.pulse = true;
      ring.userData.pulseEmissive = focus ? 0.85 : 0.7;
      ring.userData.pulseOpacity = 0.95;
      this.highlight.add(ring);
    }
  }

  /** Shortest-path nodes + edges for the current legal-move set. */
  private legalPathGraph(legal: string[]): {
    nodeIds: Set<string>;
    edges: [string, string][];
  } {
    const nodeIds = new Set<string>();
    const edgeKeys = new Set<string>();
    const edges: [string, string][] = [];

    const addPath = (path: string[] | null) => {
      if (!path?.length) return;
      for (const id of path) nodeIds.add(id);
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i];
        const b = path[i + 1];
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (edgeKeys.has(key)) continue;
        edgeKeys.add(key);
        edges.push([a, b]);
      }
    };

    const uid = this.engine.state.selectedUid;
    const piece = uid ? this.engine.piece(uid) : null;
    if (!piece || legal.length === 0) {
      for (const id of legal) nodeIds.add(id);
      return { nodeIds, edges };
    }

    const occ = this.engine.occupied();
    if (piece.location === 'field' && piece.nodeId) {
      const occ2 = new Set(occ);
      occ2.delete(piece.nodeId);
      for (const goal of legal) {
        addPath(shortestPath(this.engine.board.edges, piece.nodeId, goal, occ2));
      }
    } else if (piece.location === 'bench') {
      const entries = entryNodes(this.engine.board.nodes, piece.owner);
      for (const goal of legal) {
        addPath(shortestPathFromBench(this.engine.board.edges, entries, goal, occ));
      }
    } else {
      for (const id of legal) nodeIds.add(id);
    }
    return { nodeIds, edges };
  }

  /**
   * Dim board network outside the active legal path.
   * Pass null sets to restore full brightness.
   */
  private syncNetworkDim(pathNodes: Set<string> | null, pathEdges: Set<string> | null) {
    const active = !!(pathNodes && pathNodes.size > 0);

    for (const mesh of this.boardRouteMeshes) {
      const key = mesh.userData.edgeKey as string;
      const onPath = active && !!pathEdges?.has(key);
      mesh.material = !active || onPath ? this.routeMat : this.dimRouteMat;
    }

    for (const mesh of this.auxRouteMeshes) {
      mesh.material = active ? this.dimRouteMat : this.routeMat;
    }

    const day = this.worldTheme === 'light';
    const benchBase = day ? 0.45 : 0.5;
    for (const m of this.benchRingMats) {
      m.opacity = active ? benchBase * 0.28 : benchBase;
    }

    for (const [id, g] of this.nodeMeshes) {
      const onPath = active && !!pathNodes?.has(id);
      const routeMat = !active || onPath ? this.routeMat : this.dimRouteMat;
      g.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        if (o.userData.nodePuck || o.userData.entryRing || o.userData.routePart) {
          o.material = routeMat;
        }
        if (o.userData.goalDecor) {
          const m = o.material as THREE.MeshLambertMaterial | THREE.MeshBasicMaterial;
          const base = (o.userData.baseOpacity as number | undefined) ?? 1;
          m.transparent = true;
          m.opacity = !active || onPath ? base : base * 0.22;
          m.needsUpdate = true;
        }
      });
    }
  }

  private resetNodeScales() {
    for (const g of this.nodeMeshes.values()) {
      g.scale.set(1, 1, 1);
      g.traverse((o) => {
        if (o.userData.nodePuck) o.scale.set(1, 1, 1);
      });
    }
  }

  /** Scale only the puck diameter; entry rings stay fixed. */
  private setNodeDiameterScale(nodeId: string, diameter: number) {
    const g = this.nodeMeshes.get(nodeId);
    if (!g) return;
    const node = this.engine.board.nodes.get(nodeId);
    if (node?.kind === 'goal') return;
    g.traverse((o) => {
      if (o.userData.nodePuck) o.scale.set(diameter, 1, diameter);
    });
  }

  private makeHighlightPuck(nodeId: string, strength = 1, diameter = PATH_NODE_SCALE) {
    const node = this.engine.board.nodes.get(nodeId);
    if (!node) return new THREE.Group();
    const w = this.world(node);
    const { mat, accent } = this.moveAccentMat();
    mat.opacity = accent.opacity * strength;
    // Same radius as highlight lines (destinations slightly larger caps)
    const r = NODE_RADIUS * diameter;
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, PUCK_H, 28),
      mat,
    );
    mesh.position.set(w.x, ROUTE_Y + HIGHLIGHT_Y_BIAS, w.z);
    mesh.userData.pulse = true;
    mesh.userData.pulseOpacity = accent.opacity * strength;
    mesh.renderOrder = 2;
    return mesh;
  }

  private makeHighlightRoute(aId: string, bId: string) {
    const na = this.engine.board.nodes.get(aId);
    const nb = this.engine.board.nodes.get(bId);
    if (!na || !nb) return new THREE.Group();
    let wa = this.world(na);
    let wb = this.world(nb);
    if (na.kind === 'goal') {
      wa = this.goalLineAttach(wa, wb, na.owner === 'player' ? 1 : -1);
    }
    if (nb.kind === 'goal') {
      wb = this.goalLineAttach(wb, wa, nb.owner === 'player' ? 1 : -1);
    }

    const { mat, accent } = this.moveAccentMat();
    const mesh = this.makeSquareBar(wa, wb, ROUTE_Y + HIGHLIGHT_Y_BIAS, PATH_HIGHLIGHT_SIDE, mat);
    if (mesh instanceof THREE.Mesh) {
      mesh.userData.pulse = true;
      mesh.userData.pulseOpacity = accent.opacity;
      mesh.renderOrder = 2;
    }
    return mesh;
  }

  pickNode(raycaster: THREE.Raycaster): string | null {
    const objs: THREE.Object3D[] = [];
    for (const g of this.nodeMeshes.values()) g.traverse((o) => objs.push(o));
    const hits = raycaster.intersectObjects(objs, false);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o) {
        if (o.userData.nodeId) return o.userData.nodeId as string;
        o = o.parent;
      }
    }
    return null;
  }

  pickPiece(raycaster: THREE.Raycaster): string | null {
    const objs: THREE.Object3D[] = [];
    for (const g of this.pieceMeshes.values()) g.traverse((o) => objs.push(o));
    const hits = raycaster.intersectObjects(objs, false);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o) {
        if (o.userData.pieceUid) return o.userData.pieceUid as string;
        o = o.parent;
      }
    }
    return null;
  }
}
