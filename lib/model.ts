export interface SnapshotProtocol { slug:string;

 name:string;

 category:string|null;

 chains:string[];

 tvl_usd:number;

 change_7d:number|null;

 mcap_usd:number|null;

 listed_at:string|null;

 gecko_id:string|null;

 symbol:string|null }

export interface Snapshot { as_of:string;

 source:string;

 floor_usd:number;

 protocols:SnapshotProtocol[];

 watchlist:string[] }

export const MODEL_VERSION='radar-3';


export interface ModelConstants { global_median:number;

 growth_weight:number;

 growth_floor:number;

 growth_cap:number;

 maturity_floor:number;

 maturity_ceiling:number;

 unknown_age_days:number;

 shrinkage:number }

export const MODEL:ModelConstants={global_median:0,
growth_weight:.45,
growth_floor:-80,
growth_cap:200,
maturity_floor:.7,
maturity_ceiling:1,
unknown_age_days:365,
shrinkage:8};


export class SnapshotError extends Error {}
const day=86400000,
 clamp=(x:number,
a:number,
b:number)=>Math.max(a,
Math.min(b,
x)),
 med=(x:number[])=>{x=x.slice().sort((a,
b)=>a-b);

return x.length%2?x[(x.length-1)/2]!:((x[x.length/2-1]!+x[x.length/2]!)/2)};


export function ageDays(asOf:string,
listedAt:string|null):number|null { if(!listedAt)return null;

const a=Date.parse(asOf+'T00:00:00Z'),
b=Date.parse(listedAt+'T00:00:00Z');

return Number.isFinite(a)&&Number.isFinite(b)?Math.max(0,
Math.floor((a-b)/day)):null }

export function parseSnapshot(text:string):Snapshot { let o:any;

try{o=JSON.parse(text)}catch{throw new SnapshotError('snapshot.json is malformed JSON')} if(!o||typeof o!=='object'||!Array.isArray(o.protocols)||!Array.isArray(o.watchlist)||!/^\d{4}-\d\d-\d\d$/.test(o.as_of||''))throw new SnapshotError('snapshot.json has an invalid shape');

 const protocols=o.protocols.map((p:any,
i:number)=>{if(!p||typeof p.slug!=='string'||typeof p.name!=='string'||!Number.isFinite(p.tvl_usd))throw new SnapshotError('invalid protocol record '+i);

return {slug:p.slug,
name:p.name,
category:typeof p.category==='string'?p.category:null,
chains:Array.isArray(p.chains)?p.chains.filter((x:any)=>typeof x==='string'):[],
tvl_usd:p.tvl_usd,
change_7d:Number.isFinite(p.change_7d)?p.change_7d:null,
mcap_usd:Number.isFinite(p.mcap_usd)?p.mcap_usd:null,
listed_at:typeof p.listed_at==='string'?p.listed_at:null,
gecko_id:typeof p.gecko_id==='string'?p.gecko_id:null,
symbol:typeof p.symbol==='string'?p.symbol:null}});

 return {as_of:o.as_of,
source:String(o.source||''),
floor_usd:Number(o.floor_usd)||0,
protocols,
watchlist:o.watchlist} }
const blocked=new Set(['CEX',
'Bridge',
'Canonical Bridge',
'Liquid Staking',
'Liquid Restaking',
'Restaked BTC']);


const version=/\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;


const exchange=/^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;


export const rankable=(p:SnapshotProtocol)=>p.mcap_usd===null&&p.gecko_id===null&&p.symbol===null&&!blocked.has(p.category||'')&&!version.test(p.name)&&!/\b(wrapped|staked|staking)\b/i.test(p.name)&&!exchange.test(p.name);


// Comparable multiple with shrinkage toward the global median.
export function comparableMultiple(category:string|null,
 snapshot:Snapshot,
 global=MODEL.global_median):number {const live=snapshot.protocols.filter(p=>p.mcap_usd!==null&&p.mcap_usd>0&&p.category!=='CEX'),
 peers=live.filter(p=>p.category===category&&p.tvl_usd>0).map(p=>clamp(p.mcap_usd!/p.tvl_usd,
.02,
1.5));

if(!peers.length)return global;

return (peers.length*med(peers)+8*global)/(peers.length+8)}
// Tanh growth factor and log maturity factor shape the implied value.
export function impliedValue(p:SnapshotProtocol,
s:Snapshot,
global:number,
weight=.45,
floor=.7){const age=ageDays(s.as_of,
p.listed_at),
a=age??365,
g=1+weight*Math.tanh(clamp(p.change_7d??0,
-80,
200)/30),
m=clamp(floor+(1-floor)*Math.log(1+a)/Math.log(1461),
floor,
1);

return {value:Math.max(1,
Math.round(p.tvl_usd*comparableMultiple(p.category,
s,
global)*g*m)),
age,
growth:g,
maturity:m,
multiple:comparableMultiple(p.category,
s,
global)}}

function cap(p:SnapshotProtocol){return p.tvl_usd>=5e9?250:p.tvl_usd>=1e9?150:p.tvl_usd>=1e8?100:50}
// Build the six-step farm plan for the protocol category.
function farmSteps(p:SnapshotProtocol,
age:number|null):string[]{const c=cap(p),
chain=p.chains[0]||'its main chain',
cat=(p.category||'').toLowerCase(),
name=p.name;

let action=`deposit $${c} of USDC into ${name} on ${chain}`;

if(/lend|cdp/.test(cat))action=`supply $${c} of USDC to ${name} on ${chain}`;

else if(/dex|yield/.test(cat))action=`provide $${c} of liquidity to ${name} on ${chain}`;

else if(cat.includes('bridge'))action=`bridge $${c} of USDC through ${name} to ${chain}`;

else if(/staking|restak/.test(cat))action=`stake $${c} of the chain asset through ${name}`;

else if(/perpetual|derivative/.test(cat))action=`deposit $${c} margin into ${name} and open one small hedge`;

else if(cat.includes('prediction'))action=`fund ${name} with $${c} and place one position`;

else if(/curator|allocator/.test(cat))action=`deposit $${c} into a ${name} vault on ${chain}`;

else if(cat.includes('stable'))action=`mint or deposit $${c} of the stable asset through ${name}`;

else if(cat==='rwa'||cat.includes('rwa'))action=`mint ${name}'s $${c} yield asset`;

else if(cat.includes('insurance'))action=`buy $${c} of cover from ${name}`;

const hold=age===null||age>=365?30:age<180?60:45;

return [`Create a fresh wallet for ${name}, write its seed phrase offline, and fund it. Cost: under $3 gas. Time: 5 minutes.`,
`${action[0]!.toUpperCase()}${action.slice(1)}. Cost: $${c} capital and about $${c>=150?8:4} gas. Time: 15 minutes.`,
`Make one qualifying deposit, borrow, swap or vote each week on ${name}. Cost: about $2 gas per week. Time: 10 minutes weekly.`,
`Keep the position active for at least ${hold} days so activity spans more than one snapshot. Cost: capital remains committed. Time: ${hold} days.`,
`Before withdrawing, check ${name}'s own points or rewards page and claim only from a link it publishes; never pay to claim. Cost: $0 to check. Time: 10 minutes.`,
`Log the wallet, dates and transactions for ${name}, then use the log to repeat or unwind the position. Cost: no added cost. Time: 5 minutes.`]}

export interface BoardRow extends SnapshotProtocol { rank:number;

 token_status:'pre-token';

 age_days:number|null;

 implied_value_usd:number;

 multiple:number;

 growth_multiplier:number;

 maturity_multiplier:number;

 farm_steps:string[] }

export function liveRows(s:Snapshot){return s.protocols.filter(p=>p.mcap_usd!==null||p.gecko_id!==null||p.symbol!==null).sort((a,
b)=>(b.mcap_usd||0)-(a.mcap_usd||0)||a.slug.localeCompare(b.slug)).slice(0,
24).filter(p=>p.category!=='CEX')}
// Board construction and ranking.
export function buildBoard(s:Snapshot):BoardRow[]{const live=s.protocols.filter(p=>p.mcap_usd!==null&&p.mcap_usd>0&&p.category!=='CEX'),
global=live.length?med(live.map(p=>p.mcap_usd!/p.tvl_usd).filter(Number.isFinite)):0;

const scored=s.protocols.filter(rankable).map(p=>({...p,
...(()=>{const v=impliedValue(p,
s,
global);

return {implied_value_usd:v.value,
age_days:v.age,
multiple:v.multiple,
growth_multiplier:v.growth,
maturity_multiplier:v.maturity}})(),
rank:0 as number,
token_status:'pre-token' as const,
farm_steps:farmSteps(p,
ageDays(s.as_of,
p.listed_at))})).sort((a,
b)=>b.implied_value_usd-a.implied_value_usd||a.slug.localeCompare(b.slug));

scored.forEach((r,
i)=>r.rank=i+1);

return scored}

export function boardIssue(b:BoardRow[],
s:Snapshot):string|null {const have=new Set(b.map(r=>r.slug)),
missing=s.watchlist.filter(x=>!have.has(x));

if(missing.length)return `missing watchlist slug: ${missing.slice(0,5).join(', ')}`;

if(!b.length)return 'rankable board is empty';

for(let i=0;

i<b.length;

i++){const r=b[i]!;

if(r.rank!==i+1)return `invalid rank at row ${i+1}`;

if(i&&b[i-1]!.implied_value_usd<r.implied_value_usd)return `bad implied ordering at row ${i+1}`;

if(i&&b[i-1]!.implied_value_usd===r.implied_value_usd)return `duplicate implied value at rows ${i} and ${i+1}`;

if(i&&b[i-1]!.implied_value_usd===r.implied_value_usd&&b[i-1]!.slug>r.slug)return `bad slug tie-break at row ${i+1}`;

if(r.farm_steps.length!==6||r.farm_steps.some(x=>x.length<20||x.length>600))return `bad farm steps for ${r.slug}`}return null}

export function buildRadar(s:Snapshot){const board=buildBoard(s),
live=liveRows(s),
ratios=s.protocols.filter(p=>p.mcap_usd!==null&&p.mcap_usd>0&&p.category!=='CEX').map(p=>p.mcap_usd!/p.tvl_usd).filter(Number.isFinite);

const model={...MODEL,
global_median:ratios.length?med(ratios):0};

return {board,
radar:{as_of:s.as_of,
source:s.source,
floor_usd:s.floor_usd,
watchlist:s.watchlist,
model,
model_version:MODEL_VERSION,
watchlist_size:s.watchlist.length,
board_size:board.length,
early_size:board.length-s.watchlist.length,
live_size:live.length,
rows:board,
live}}}

export function dataScript(r:any){return `window.RADAR=${JSON.stringify(r)};\n`}
