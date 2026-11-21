# Token Launch Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/ayoobekerja8-sys/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/ayoobekerja8-sys/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar that ranks pre-token protocols by implied value — 198 rows scored (158 early, 40 on the watchlist), built for the make.fun bounty https://make.fun/bounty/token-radar-01

## How to run

`mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json` reads the sealed snapshot, scores every pre-token protocol with the radar-3 model, and writes the ranked board (`board.json`), the dashboard dataset (`data.js`) and the dossier (`dossier.json`) — deterministic. Open `dashboard/index.html` in a browser to explore the board.
