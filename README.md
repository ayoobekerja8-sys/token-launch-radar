# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/ayoobekerja8-sys/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/ayoobekerja8-sys/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A snapshot-only token launch radar with a dark terminal board, protocol detail and six-step farm plans. It ranks the complete watchlist plus every rankable pre-token protocol below the TVL floor; protocols with a token already trading are kept in a separate live market-cap table. Each pre-token row uses the same name-agnostic radar-2 function: `max(1, round(C × TVL^0.85 × growth × maturity × breadth))`. Calibration `C` makes a neutral $1bn TVL, one-year, one-chain protocol imply about $250m. Seven-day growth is clamped to −60%/+120% with asymmetric downside weight; maturity rises quickly from a 0.55 floor and saturates at four years; chain breadth adds a small capped premium. The dashboard exposes each factor, sortable columns and category/chain/search/watchlist filters, plus a local slider sandbox that re-ranks the embedded snapshot without network access.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Node.js 22.18 or later, standard library only. The program writes the ranked board to `out/board.json`, the dashboard data to `out/data.js`, and copies `dashboard/` and `screenshots/` plus `dossier.json` into `out/`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=5cf2xhyj&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
