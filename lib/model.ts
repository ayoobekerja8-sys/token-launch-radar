// The token radar's model (radar-3): one sealed snapshot in, one ranked board out.
//
// A protocol's implied value is its TVL times a category multiple, a seven-day growth factor and a
// maturity factor. The multiple is the category median of market cap over TVL among the protocols that
// already trade, shrunk toward the house's global median so a category with few comparables does not
// swing the board; growth is a bounded tanh of the seven-day change; maturity rises with the protocol's
// age, because a protocol that has run without a token for longer has more of a track record to price.
//
// Nothing here is keyed to a protocol name: every row is scored by the same three factors, and a farm
// plan is derived from the protocol's own category, chains, TVL and age.

/** One protocol: exactly the ten fields the sealed snapshot carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  global_median: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_ceiling: number;
  unknown_age_days: number;
  shrinkage: number;
}

export const MODEL: ModelConstants = {
  global_median: 0.2459877056611089,
  growth_weight: 0.45,
  growth_floor: -80,
  growth_cap: 200,
  maturity_floor: 0.7,
  maturity_ceiling: 1,
  unknown_age_days: 365,
  shrinkage: 8,
};

/** The model's version label. */
export const MODEL_VERSION = 'radar-3';

/** Comparables' market cap over TVL is clamped into this band before taking a median. */
const RATIO_FLOOR = 0.02;
const RATIO_CEILING = 1.5;

/** The age at which maturity reaches its ceiling: four years of running with no token. */
const MATURITY_SPAN_DAYS = 1461;

/** How many live-token protocols the dashboard's Live view carries, best market cap first. */
const LIVE_ROWS = 18;

/** A farm step: its action, what it costs and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json, and of data.js's rows: the ranked board's row. */
export interface BoardRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  implied_value_usd: number;
  age_days: number | null;
  multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  rank: number;
  token_status: 'pre-token';
  farm_steps: string[];
}

/** The dashboard's row: data.js carries the board rows themselves. */
export type RadarRow = BoardRow;

/** A live-token protocol: the market's own value, never the model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** Everything data.js carries: the board, the live set and the model it ran. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  watchlist: string[];
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** Whole days from `listedAt` to `asOf`; null when the protocol records no listing day. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const from = Date.parse(`${asOf}T00:00:00Z`);
  const to = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.max(0, Math.floor((from - to) / DAY_MS));
}

/** The median of a list of numbers: the middle value, or the mean of the two middle ones. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = n >> 1;
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Each category's shrunk multiple: the median of its comparables' clamped market-cap-to-TVL ratios,
 * pulled toward the global median by `shrinkage` pseudo-comparables. A category with no comparables is
 * not in the map, and the lookup falls back to the global median.
 */
function categoryMultiples(snapshot: Snapshot, model: ModelConstants): Map<string, number> {
  const ratios = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || !(p.tvl_usd > 0)) continue;
    const ratio = Math.min(RATIO_CEILING, Math.max(RATIO_FLOOR, p.mcap_usd / p.tvl_usd));
    const key = p.category ?? '';
    if (key === '') continue;
    const list = ratios.get(key);
    if (list === undefined) ratios.set(key, [ratio]);
    else list.push(ratio);
  }
  const out = new Map<string, number>();
  for (const [category, list] of ratios) {
    const n = list.length;
    out.set(category, (n * median(list) + model.shrinkage * model.global_median) / (n + model.shrinkage));
  }
  return out;
}

/** The multiple a category gets, from the shrunk medians or the global median. */
export type MultipleLookup = (category: string | null) => number;

/** The three multipliers and the implied value one protocol gets under the model. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  lookup: MultipleLookup,
): { implied: number; multiple: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const multiple = lookup(protocol.category);
  const growthMult =
    protocol.change_7d === null
      ? 1
      : 1 + model.growth_weight * Math.tanh(Math.min(model.growth_cap, Math.max(model.growth_floor, protocol.change_7d)) / 30);
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = Math.min(
    model.maturity_ceiling,
    model.maturity_floor + ((model.maturity_ceiling - model.maturity_floor) * Math.log(ageForModel + 1)) / Math.log(MATURITY_SPAN_DAYS),
  );
  const implied = Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult);
  return { implied, multiple, growthMult, maturityMult, age };
}

/** Categories that are a bridged, staked or custodial product of another protocol's token. */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** A name ending in a release marker is a pool or a version of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A name carrying a whole word wrapped, staked or staking is a wrapped or staked product. */
const WRAPPED = /\b(?:wrapped|staked|staking)\b/i;

/** A name that begins with an exchange's name is that exchange's own product. */
const EXCHANGE_BRAND = /^(?:Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: no token recorded, not a wrapped, staked or branded product. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED.test(p.name)) return false;
  if (EXCHANGE_BRAND.test(p.name)) return false;
  return true;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd < 100_000_000) return 50;
  if (p.tvl_usd < 1_000_000_000) return 100;
  return 150;
}

/** How long to hold so activity spans more than one snapshot: younger protocols need longer. */
function holdDaysFor(age: number | null): number {
  const ageForModel = age ?? MODEL.unknown_age_days;
  if (ageForModel >= 365) return 30;
  if (ageForModel >= 180) return 45;
  return 60;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The category's one action sentence, in the words a farmer can follow. */
function actionText(p: SnapshotProtocol, capital: number, chain: string): string {
  const amount = `$${capital}`;
  const name = p.name;
  switch (p.category) {
    case 'CDP':
    case 'CDP Manager':
    case 'Lending':
    case 'Uncollateralized Lending':
      return `Supply ${amount} of USDC to ${name} on ${chain}.`;
    case 'Onchain Capital Allocator':
    case 'Risk Curators':
      return `Deposit ${amount} into a ${name} vault on ${chain}.`;
    case 'Dexs':
    case 'Indexes':
    case 'Yield':
    case 'Yield Aggregator':
      return `Provide ${amount} of liquidity to ${name} on ${chain}.`;
    case 'Derivatives':
    case 'Interest Rate Derivatives':
      return `Deposit ${amount} margin into ${name} and open one small hedge.`;
    case 'Dual-Token Stablecoin':
    case 'Stablecoin Wrapper':
      return `Mint or deposit ${amount} of the stable asset through ${name}.`;
    case 'RWA':
      return `Mint ${name}'s ${amount} yield asset.`;
    case 'Restaking':
    case 'Staking Pool':
      return `Stake ${amount} of the chain asset through ${name}.`;
    case 'Cross Chain Bridge':
      return `Bridge ${amount} of USDC through ${name} to ${chain}.`;
    case 'Prediction Market':
      return `Fund ${name} with ${amount} and place one position.`;
    case 'Insurance':
      return `Buy ${amount} of cover from ${name}.`;
    default:
      return `Deposit ${amount} of USDC into ${name} on ${chain}.`;
  }
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time, derived from the protocol's
 * record (category, chains, TVL, age) rather than from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const gas = capital === 150 ? 8 : 4;
  const hold = holdDaysFor(age);
  return [
    {
      text: `Create a fresh wallet for ${p.name}, write its seed phrase offline, and fund it.`,
      cost: 'under $3 gas',
      time: '5 minutes',
    },
    {
      text: actionText(p, capital, chain),
      cost: `$${capital} capital and about $${gas} gas`,
      time: '15 minutes',
    },
    {
      text: `Make one qualifying deposit, borrow, swap or vote each week on ${p.name}.`,
      cost: 'about $2 gas per week',
      time: '10 minutes weekly',
    },
    {
      text: `Keep the position active for at least ${hold} days so activity spans more than one snapshot.`,
      cost: 'capital remains committed',
      time: `${hold} days`,
    },
    {
      text: `Before withdrawing, check ${p.name}'s own points or rewards page and claim only from a link it publishes; never pay to claim.`,
      cost: '$0 to check',
      time: '10 minutes',
    },
    {
      text: `Log the wallet, dates and transactions for ${p.name}, then use the log to repeat or unwind the position.`,
      cost: 'no added cost',
      time: '5 minutes',
    },
  ];
}

/** One farm step as the sentence board.json carries: action, cost, time. */
export function stepText(step: FarmStep): string {
  return `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const multiples = categoryMultiples(snapshot, model);
  const lookup: MultipleLookup = (category) =>
    category === null ? model.global_median : (multiples.get(category) ?? model.global_median);
  const scored = snapshot.protocols.filter(isRankable).map((p) => {
    const { implied, multiple, growthMult, maturityMult, age } = impliedValue(p, snapshot.as_of, model, lookup);
    return { p, implied, multiple, growthMult, maturityMult, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    implied_value_usd: s.implied,
    age_days: s.age,
    multiple: s.multiple,
    growth_multiplier: s.growthMult,
    maturity_multiplier: s.maturityMult,
    rank: i + 1,
    token_status: 'pre-token',
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** The live-token protocols, by market cap, with exactly the snapshot's ten fields. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
    }));
}

/** A board row as data.js carries it: the board rows are the dashboard's rows. */
export function radarRow(row: BoardRow): RadarRow {
  return row;
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchlist.has(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    watchlist: snapshot.watchlist,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    } satisfies SnapshotProtocol;
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (slugs.size !== board.length) return 'the board names a slug twice';
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
