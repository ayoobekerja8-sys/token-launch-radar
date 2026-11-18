// Radar-2 scores the sealed snapshot only; no protocol name receives special treatment.
// implied = max(1, round(C * TVL^0.85 * growthMult * maturityMult * breadthMult)).
// C = 250e6 / (1e9^0.85 * 0.775), where 0.775 is the one-year maturity factor;
// thus neutral growth, one year and one chain at $1bn implies about $250m. The
// sublinear exponent limits TVL dominance.
// Growth clamps to [-60,120] and uses +0.60 per 100% change; losses use a 1.25
// penalty weight because drawdowns erase liquidity confidence faster than rallies add it.
// Maturity = max(0.55, .55 + .45*sqrt(min(ageYears,4)/4)); unknown age assumes one year.
// Breadth = 1 + .05*min(max(chains-1,0),6), a modest distribution premium.

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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  exponent: number;
  calibration: number;
  growth_weight: number;
  loss_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_ceiling: number;
  maturity_years: number;
  unknown_age_days: number;
  breadth_step: number;
  breadth_cap: number;
}

export const MODEL: ModelConstants = {
  exponent: 0.85,
  calibration: 250_000_000 / (1_000_000_000 ** 0.85 * 0.775),
  growth_weight: 0.6,
  loss_weight: 0.75,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.55,
  maturity_ceiling: 1,
  maturity_years: 4,
  unknown_age_days: 365,
  breadth_step: 0.05,
  breadth_cap: 6,
};

export const MODEL_VERSION = 'radar-2';

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    tvl_term: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
    chain_count: number;
  };
  farm_steps: string[];
}

export interface RadarRow extends Omit<BoardRow, 'token_status' | 'farm_steps' | 'gecko_id' | 'symbol' | 'model'> {
  model: BoardRow['model'];
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  watchlist: string[];
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (!listedAt) return null;

  const asOfTime = Date.parse(asOf + 'T00:00:00Z');
  const listedTime = Date.parse(listedAt + 'T00:00:00Z');
  if (!Number.isFinite(asOfTime) || !Number.isFinite(listedTime)) return null;

  return Math.max(0, Math.floor((asOfTime - listedTime) / DAY_MS));
}

const r4 = (value: number) => Math.round(value * 1e4) / 1e4;

export function impliedValue(p: SnapshotProtocol, asOf: string, m: ModelConstants = MODEL) {
  const age = ageDays(asOf, p.listed_at);
  // Treat unknown protocol age as one year so missing dates do not imply zero maturity.
  const ageFor = age ?? m.unknown_age_days;
  const pct = Math.min(m.growth_cap, Math.max(m.growth_floor, p.change_7d ?? 0));
  // Negative changes use the heavier loss weight because drawdowns reduce liquidity confidence.
  const growth = 1 + (pct >= 0 ? pct / 100 * m.growth_weight : pct / 100 * m.loss_weight);
  const years = Math.min(ageFor / 365.2425, m.maturity_years);
  // Square root gives newer projects maturity credit without treating age as a linear multiplier.
  const maturity = m.maturity_floor + (m.maturity_ceiling - m.maturity_floor) * Math.sqrt(years / m.maturity_years);
  const chains = p.chains.length;
  const breadth = 1 + m.breadth_step * Math.min(Math.max(chains - 1, 0), m.breadth_cap);
  // The 0.85 exponent keeps TVL important while reducing its dominance over other signals.
  const tvlTerm = m.calibration * Math.pow(Math.max(0, p.tvl_usd), m.exponent);
  const implied = Math.max(1, Math.round(tvlTerm * growth * maturity * breadth));

  return {
    implied,
    tvlTerm,
    growthPct: pct,
    growthMult: growth,
    maturityMult: maturity,
    breadthMult: breadth,
    age,
    chainCount: chains,
  };
}

const versioned = /\s(?:v\d+(?:\.\d+)?|\d+\.\d+)$/i;

export function isPreToken(p: SnapshotProtocol) {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

export function isRankable(p: SnapshotProtocol) {
  return isPreToken(p) && p.category !== 'CEX' && !versioned.test(p.name);
}

const chainOf = (p: SnapshotProtocol) => p.chains[0] || 'its main chain';

const capFor = (p: SnapshotProtocol) =>
  p.tvl_usd >= 5e9 ? 250 : p.tvl_usd >= 1e9 ? 150 : p.tvl_usd >= 1e8 ? 100 : 50;

const holdDays = (age: number | null) =>
  age === null ? 45 : age < 180 ? 90 : age < 365 ? 60 : age < 1095 ? 45 : 30;

function actionFor(p: SnapshotProtocol, cap: number, chain: string) {
  const category = (p.category || '').toLowerCase();
  const name = p.name;

  if (/lend|cdp|collateral/.test(category)) {
    return `Supply $${cap} of USDC or another accepted asset to ${name} on ${chain}; record the rate and keep the receipt token.`;
  }
  if (/dex|exchange|amm/.test(category)) {
    return `Add $${cap} total value as a balanced pair to a liquid ${name} pool on ${chain}; save the pool receipt and note both assets.`;
  }
  if (/bridge|cross.chain/.test(category)) {
    return `Bridge $${cap} of a supported stablecoin through ${name} from a network you control to ${chain}; verify destination and retain funds there.`;
  }
  if (/staking|restak/.test(category)) {
    return `Stake $${cap} of the chain's native asset through ${name} on ${chain}; keep the receipt and check the unstaking delay before confirming.`;
  }
  if (/perpetual|derivative|options/.test(category)) {
    return `Deposit $${cap} USDC as isolated margin in ${name} on ${chain}; open a minimal hedged position and set a stop before submitting.`;
  }
  if (/prediction/.test(category)) {
    return `Fund ${name} with $${cap} on ${chain}, inspect market resolution rules, then take one small position and save its market ID.`;
  }
  if (/vault|curator|allocator/.test(category)) {
    return `Compare vault strategy and withdrawal terms in ${name}, then deposit $${cap} on ${chain} and retain the vault share receipt.`;
  }
  if (/stable/.test(category)) {
    return `Mint or deposit $${cap} through ${name} on ${chain}; check collateral and redemption terms first, then keep the issued receipt.`;
  }
  if (/rwa|real.world/.test(category)) {
    return `Review eligibility and redemption terms for ${name}; if eligible, acquire $${cap} of its yield asset on ${chain} and retain proof of ownership.`;
  }
  if (/insurance|cover/.test(category)) {
    return `Review exclusions and expiry in ${name}, then buy a small $${cap} cover position on ${chain} and save the policy details.`;
  }
  if (/yield|farm|leveraged/.test(category)) {
    return `Choose a simple, unlevered strategy in ${name}, deposit $${cap} on ${chain}, and record the share balance and exit conditions.`;
  }

  return `Connect a fresh wallet to ${name} on ${chain}, inspect the available non-custodial action, then commit $${cap} only after checking fees and withdrawal terms.`;
}

export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const cap = capFor(p);
  const hold = holdDays(age);
  const chain = chainOf(p);

  return [
    {
      text: 'Create a fresh wallet for this protocol, write its recovery phrase offline, and send only the planned funds to it.',
      cost: 'under $3 gas to fund; no protocol deposit yet',
      time: '5–10 minutes',
    },
    {
      text: actionFor(p, cap, chain),
      cost: `$${cap} working capital plus about $${cap >= 150 ? 8 : 4} gas; capital remains exposed`,
      time: '15–30 minutes',
    },
    {
      text: `Once each week, repeat a low-risk qualifying action available in ${p.name}, such as a small swap, deposit, repayment or vote; check the receipt after each transaction.`,
      cost: 'about $2–5 gas weekly plus any swap fee',
      time: '10–15 minutes each week',
    },
    {
      text: `Keep the position open for at least ${hold} days, review its value and withdrawal terms weekly, and exit sooner if the protocol or asset becomes unsafe.`,
      cost: `$${cap} remains committed; exit gas varies`,
      time: `${hold} days with a weekly review`,
    },
    {
      text: `Before claiming or withdrawing, visit ${p.name}'s official points or rewards page from its verified app navigation and confirm eligibility, network and claim terms.`,
      cost: 'free to check; reserve up to $3 gas only if a claim is confirmed',
      time: '10 minutes before claim',
    },
    {
      text: 'Record wallet address, date, chain, transaction IDs, capital, gas and position size in a private farm log; update it after every action and exit.',
      cost: 'no capital; ordinary network gas already counted',
      time: '5 minutes per log entry',
    },
  ];
}

export function stepText(s: FarmStep) {
  return `${s.text} Cost: ${s.cost}. Time: ${s.time}.`;
}

export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const wanted = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter(
    (p) => wanted.has(p.slug) || (p.tvl_usd < snapshot.floor_usd && isRankable(p)),
  );

  // Preserve watchlist entries even when their TVL or classification excluded them above.
  for (const slug of snapshot.watchlist) {
    if (chosen.some((p) => p.slug === slug)) continue;
    const protocol = snapshot.protocols.find((p) => p.slug === slug);
    if (protocol) chosen.push(protocol);
  }

  const scored = chosen
    .map((p) => ({ p, x: impliedValue(p, snapshot.as_of, model) }))
    .sort((a, b) => b.x.implied - a.x.implied || a.p.slug.localeCompare(b.p.slug, 'en'));

  return scored.map(({ p, x }, index) => ({
    rank: index + 1,
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
    token_status: 'pre-token',
    age_days: x.age,
    implied_value_usd: x.implied,
    model: {
      tvl_term: r4(x.tvlTerm),
      growth_pct: x.growthPct,
      growth_multiplier: r4(x.growthMult),
      maturity_multiplier: r4(x.maturityMult),
      breadth_multiplier: r4(x.breadthMult),
      age_days: x.age,
      chain_count: x.chainCount,
    },
    farm_steps: farmSteps(p, x.age).map(stepText),
  }));
}

export function liveRows(s: Snapshot): LiveRow[] {
  return s.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort(
      (a, b) =>
        (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) ||
        b.tvl_usd - a.tvl_usd ||
        a.slug.localeCompare(b.slug, 'en'),
    )
    .slice(0, 40)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

export function buildRadar(s: Snapshot) {
  const board = buildBoard(s);
  const live = liveRows(s);
  const radar: RadarData = {
    as_of: s.as_of,
    source: s.source,
    floor_usd: s.floor_usd,
    model: MODEL,
    model_version: MODEL_VERSION,
    watchlist_size: s.watchlist.length,
    watchlist: s.watchlist,
    board_size: board.length,
    early_size: board.filter((row) => !s.watchlist.includes(row.slug)).length,
    live_size: live.length,
    rows: board.map((row) => ({ ...row, model: row.model })),
    live,
  };

  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json is not an object');
  }
  if (
    typeof raw.as_of !== 'string' ||
    !Array.isArray(raw.protocols) ||
    !Array.isArray(raw.watchlist) ||
    typeof raw.floor_usd !== 'number'
  ) {
    throw new SnapshotError('snapshot.json is missing required fields');
  }

  const protocols = raw.protocols.map((p: any) => ({
    slug: String(p.slug),
    name: String(p.name),
    category: typeof p.category === 'string' ? p.category : null,
    chains: Array.isArray(p.chains) ? p.chains.filter((x: any) => typeof x === 'string') : [],
    tvl_usd: Number(p.tvl_usd),
    change_7d: Number.isFinite(p.change_7d) ? p.change_7d : null,
    mcap_usd: Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
    listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
    gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
    symbol: typeof p.symbol === 'string' ? p.symbol : null,
  }));

  return {
    as_of: raw.as_of,
    source: String(raw.source || ''),
    floor_usd: raw.floor_usd,
    protocols,
    watchlist: raw.watchlist,
  };
}

export function boardIssue(board: BoardRow[], s: Snapshot): string | null {
  const slugs = new Set(board.map((row) => row.slug));
  const missing = s.watchlist.filter((slug) => !slugs.has(slug));
  if (missing.length) return `missing watchlist: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `only ${board.length} rows`;

  const ranks = board.map((row) => row.rank).sort((a, b) => a - b);
  for (let index = 0; index < ranks.length; index++) {
    if (ranks[index] !== index + 1) return `rank ${index + 1} is ${ranks[index]}`;
  }
  for (let index = 1; index < board.length; index++) {
    if (board[index]!.implied_value_usd > board[index - 1]!.implied_value_usd) {
      return `implied rises at rank ${index + 1}`;
    }
  }
  if (board.length > 1 && board[0]!.implied_value_usd === board.at(-1)!.implied_value_usd) {
    return 'all implied values match';
  }

  const seen = new Set<string>();
  for (const row of board) {
    if (seen.has(row.slug)) return `duplicate slug ${row.slug}`;
    seen.add(row.slug);
    if (
      !Number.isSafeInteger(row.implied_value_usd) ||
      row.implied_value_usd < 1 ||
      row.implied_value_usd > 1e14
    ) {
      return `invalid implied value for ${row.slug}`;
    }
    if (row.farm_steps.length !== 6) return `${row.slug} has ${row.farm_steps.length} farm steps`;
    for (const farmStep of row.farm_steps) {
      if (farmStep.trim().length < 20 || farmStep.trim().length > 600) {
        return `${row.slug} farm step has ${farmStep.length} chars`;
      }
    }
  }

  return null;
}

export function dataScript(r: RadarData) {
  return `window.RADAR=${JSON.stringify(r)};\n`;
}
