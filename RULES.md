# Authentic Pokémon Duel rules (source notes)

Primary source: [Pokemon.com — Prime Yourself for Pokémon Duels](https://www.pokemon.com/uk/strategy/prime-yourself-for-pokemon-duels)
Secondary: Serebii mechanics, Wikipedia, Pokémon Duel Archive wiki (Battle page snippets)

## Board
- 26 points + 2 goals = 28 spaces, connected by routes.
- 2 entry points per player at the corners of their side.
- 1 goal per player (opponent scores by landing on your goal).
- Topology: outer frame ring + inner square ring (adjacent only) + 4 corner diagonals + 2 spokes (inner top/bottom center → right of each goal).

## Turn structure
1. (Plates — not implemented yet) may be used at start of turn only.
2. You may **move one figure** along routes up to its current MP.
3. **Before or after moving**, if adjacent to an enemy, you may **initiate a battle**.
4. **Battle ends the turn immediately** when it concludes.
5. Therefore you cannot battle then move. You *can* move then battle.
6. **Heal**: an ally adjacent to a statused figure can cure it by “touching”; that **ends the turn**.
7. After a **move** completes, check **surrounds** before any battle is allowed.

## Movement
- One figure per turn.
- Entering from bench through an open entry costs **1 MP**; remaining MP may continue the same turn.
- The **first figure moved in the duel** has **−1 MP** for that action.
- Cannot enter or pass through an occupied point (ally or enemy).
- Sleeping Pokémon **can still move** but **cannot initiate battle**.
- Waiting Pokémon cannot move or act.
- Frozen Pokémon cannot take actions (no move / no battle); if somehow in battle, all Attacks miss.
- MP−1 markers reduce MP by 1 each.

## Battle colors (official)
- **Blue** defeats every other color. Most Blues have no KO; battle often null. Blue vs Blue = draw.
- **Gold** beats **Purple** (KO if Gold damage > 0). vs White/Gold → higher damage wins.
- **Purple** beats **White**; loses to Gold. Purple vs Purple → more ★ wins. Effects apply (usually no damage KO).
- **White** vs White/Gold → higher damage. Loses to Blue/Purple.
- **Miss (Red)** loses to every other color. Miss vs Miss = draw.
- Equal White/Gold damage or equal Purple ★ → draw, nothing changes.

## Surround
- A figure is surrounded if **every adjacent point it could move to** is occupied by an **opposing** figure.
- Checked **after movement ends**; KO happens before that figure can initiate battle.
- Surrounded → PC (same as battle KO).

## PC
- Max 2 per player.
- 3rd KO → oldest leaves PC to **bench** with **Wait 1** (may move again after one turn).
- PC clears special conditions.

## Win
- Land on opponent’s **goal**.
- **Wait Win**: opponent cannot make a legal action on their turn.
- Turn limit 300 / time-out (time not implemented).

## Status (official)
| Status | Effect |
|--------|--------|
| Poison | White/Gold damage −20 |
| Noxious | White/Gold damage −40 |
| Paralysis | Smallest Attack becomes Miss in battle |
| Burn | Damage −10 + smallest Attack → Miss |
| Confusion | Use next clockwise segment from spun result |
| Sleep | Cannot initiate battle; **can move** |
| Frozen | Cannot take actions; Attacks miss |
| Wait | Cannot act or move until expired |
| Curse | If KO’d, removed from duel |
| MP−1 | MP reduced by 1 |
