// Token Radar radar-2 entry (Node 22, standard library only).
//
// The program reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>), scores every
// pre-token protocol with the model in lib/model.ts, writes the ranked board to /output/board.json, and
// validates the ranks and farm steps, copies this repository's dashboard/ and screenshots/ to /output,
// then writes /output/dossier.json with the unchanged vendored make.fun library. The snapshot date and
// stable slug tie-breaks make every generated file deterministic across runs.
//
// The dashboard is a static radar terminal with no framework or network: index.html, app.css and app.js
// read data.js generated from this same radar model. The model's full breakdown and six-step farm plan
// are carried in both board.json and data.js so the board and detail view describe identical rows.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const flag = `--${name}`;
  const at = process.argv.indexOf(flag);
  if (at >= 0 && at + 1 < process.argv.length) {
    return process.argv[at + 1]!;
  }

  const withEquals = process.argv.find((value) => value.startsWith(`${flag}=`));
  if (withEquals === undefined) return fallback;

  return withEquals.slice(name.length + 3);
}

// Resolve the input argument as either an explicit JSON file or a directory containing snapshot.json.
// This keeps the CLI convenient for local runs while preserving the sealed input directory default.
const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');

if (!existsSync(inputFile)) {
  process.stderr.write(
    `token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`,
  );
  process.exit(2);
}

// --output wins when supplied; otherwise honor MAKEFUN_OUTPUT_DIR before falling back to /output.
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

// Read the snapshot once so every generated artifact comes from the same sealed input contents.
// Parsing keeps the model's existing validation and error messages in one place.
const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));

// Build the ranked board and dashboard payload from the same model result.
const { board, radar } = buildRadar(snapshot);

// The gate checks watchlist coverage, rank continuity, descending values and farm step sizes.
// Keep this check before directory creation and board writes, matching the existing CLI behavior.
const issue = boardIssue(board, snapshot);

if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

// Create the destination only after model validation succeeds.
mkdirSync(out, { recursive: true });

// Write board.json first and data.js second, preserving the scorer's expected output order.
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];

  mkdirSync(to, { recursive: true });
  const copied: string[] = [];

  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;

    const path = join(from, name);
    if (!statSync(path).isFile()) continue;

    copyFileSync(path, join(to, name));
    copied.push(name);
  }

  return copied;
}

// Copy the static dashboard before screenshots so the dossier is built from both directories.
copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));

// Keep the copied screenshot list for both validation and the final status message.
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));

if (shots.length < 3) {
  process.stderr.write(
    `token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`,
  );
  process.exit(1);
}

for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(
      `token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`,
    );
    process.exit(1);
  }
}

// Write the dossier last so its scorer rebuild sees the board, script, dashboard and screenshots.
// The limits below are the same fixed gate values used by the existing entry point.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: SCREENSHOT_CAPS,
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }),
);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (3 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
