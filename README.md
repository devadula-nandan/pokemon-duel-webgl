# Duel Field — Pokémon Duel (WebGL)

A modern Three.js / WebGL recreation of **Pokémon Duel** core rules.

## Run

```bash
cd pokemon-duel-webgl
npm install
npm run dev
```

Open the Vite URL (includes base path `/pokemon-duel-webgl/`).

## Rules

See [RULES.md](./RULES.md) — mechanics aligned to the official Pokémon.com Duel guide (turn structure, colors, statuses, surrounds, PC, **plates**).

Combat color matrix is covered by `src/game/combat.test.ts`.

## Implemented (parity roadmap)

**Phase 1**
- Core plate deck (cost ≤ 8), start-of-turn use, 3D plate row between bench and PC
- Match actions / trainer chips in Three.js HUD
- Plate use microanims + status icons on figures

**Phase 2**
- Ability text hooks (e.g. surround immunity, MP bonuses)
- Multiply white attacks; expanded purple (knock-back, range KO tags)

**Phase 3**
- Mega evolution via mega stone plates (Salamencite / Charizardite X)
- Evolution / Z-Move helpers in `src/game/evolution.ts`

**Phase 4**
- Action sync layer (`src/game/net.ts`) with local transport + optional WebSocket hook

## Still expanding

- Full plate catalog / Energy plates / every purple edge-case
- Complete ability text for all figures
- Live multiplayer rooms / matchmaking
- Level / chain-level wheel edits

## Disclaimer

Fan project for personal / educational use. Pokémon is © Nintendo / Creatures / GAME FREAK. Not affiliated with The Pokémon Company.
