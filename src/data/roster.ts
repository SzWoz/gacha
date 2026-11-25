// ─────────────────────────────────────────────────────────────
//  ROSTER — generowany automatycznie z plików w /public:
//    public/agents/<ranga>-rank/<Imię>.png     → agenci
//    public/w-engines/<ranga>-rank/<Nazwa>.png → W-Engines (gear)
//    public/bangboo/<ranga>-rank/<Nazwa>.png   → Bangboo
//  Nazwa pliku (bez rozszerzenia) = nazwa postaci. Wrzuć/usuń plik,
//  a roster się zaktualizuje. Dodatkowe dane (element, rola, cytat…)
//  można dopisać w EXTRA poniżej, po nazwie postaci.
// ─────────────────────────────────────────────────────────────

import portraits from 'virtual:portraits'
import { AGENT_META } from './agentMeta'

export type Rank = 'S' | 'A' | 'B'
export type Element =
  | 'Fire' | 'Ice' | 'Electric' | 'Physical' | 'Ether'
  | 'Frost' | 'Wind' | 'Lumiflux' | 'Auric Ink' | 'Honed Edge' | 'Genesis Flare'
export type Role = 'Attack' | 'Stun' | 'Anomaly' | 'Support' | 'Defense' | 'Rupture' | 'Armorer'

export interface Item {
  id: string
  name: string
  title: string
  rank: Rank
  kind: 'agent' | 'gear' | 'bangboo'
  element?: Element
  role?: Role
  faction?: string
  image?: string
  quote?: string
}

export const ELEMENT_COLORS: Record<Element, [string, string]> = {
  Fire: ['#ff4d2e', '#ffb02e'],
  Ice: ['#3fd8ff', '#c9f6ff'],
  Electric: ['#4d7cff', '#b07cff'],
  Physical: ['#ffcc00', '#fff3a8'],
  Ether: ['#ff3ea5', '#7cffd4'],
  Frost: ['#7fd6ff', '#eaf9ff'],
  Wind: ['#3fe0a0', '#c8ffe4'],
  Lumiflux: ['#ffd84d', '#fff8d1'],
  'Auric Ink': ['#d4a84b', '#f3e2b5'],
  'Honed Edge': ['#b8c4d8', '#ffffff'],
  'Genesis Flare': ['#ff7a3d', '#ffd9a0'],
}

export const ELEMENT_GLYPH: Record<Element, string> = {
  Fire: '◆',
  Ice: '❄',
  Electric: 'ϟ',
  Physical: '■',
  Ether: '✦',
  Frost: '❅',
  Wind: '≋',
  Lumiflux: '☀',
  'Auric Ink': '✒',
  'Honed Edge': '⟋',
  'Genesis Flare': '✸',
}

export const RANK_COLOR: Record<Rank, string> = {
  S: '#ffb800',
  A: '#c56bff',
  B: '#3fa9ff',
}

type Kind = Item['kind']

const KINDS: { dir: keyof typeof portraits; kind: Kind; title: string }[] = [
  { dir: 'agents', kind: 'agent', title: 'Agent' },
  { dir: 'w-engines', kind: 'gear', title: 'W-Engine' },
  { dir: 'bangboo', kind: 'bangboo', title: 'Bangboo' },
]

/** Opcjonalne metadane per nazwa (nazwa pliku bez rozszerzenia). */
const EXTRA: Record<string, Partial<Omit<Item, 'id' | 'name' | 'rank' | 'kind' | 'image'>>> = AGENT_META

const slug = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

export const ITEMS: Item[] = KINDS.flatMap(({ dir, kind, title }) =>
  (['S', 'A', 'B'] as Rank[]).flatMap((rank) =>
    (portraits[dir][rank] ?? []).map((file): Item => {
      const name = file.replace(/\.[^.]+$/, '')
      return { id: `${kind}-${rank}-${slug(name)}`.toLowerCase(), name, title, rank, kind, image: file, ...EXTRA[name] }
    }),
  ),
)

export const byId = Object.fromEntries(ITEMS.map((i) => [i.id, i])) as Record<string, Item>

export type BannerKind = 'limited' | 'standard' | 'gear'

export interface Banner {
  id: string
  kind: BannerKind
  name: string
  subtitle: string
  featuredS?: string
  featuredA?: string[]
  /** S-ranki dostępne gdy przegrasz 50/50 lub na stałym banerze */
  standardS: string[]
  /** Pula A-rang (domyślnie wszystkie A-rangi) */
  poolA?: string[]
  accent: string
}

const agentsOf = (rank: Rank) => ITEMS.filter((i) => i.kind === 'agent' && i.rank === rank)
/** id agenta po nazwie (jeśli plik istnieje), inaczej kolejny z puli */
const pickAgent = (rank: Rank, name: string, skip: string[] = []) =>
  (agentsOf(rank).find((i) => i.name === name) ?? agentsOf(rank).find((i) => !skip.includes(i.id)))?.id

const itemsOf = (rank: Rank, kinds: Kind[]) => ITEMS.filter((i) => i.rank === rank && kinds.includes(i.kind))
const GEAR_KINDS: Kind[] = ['gear', 'bangboo']
const gearS = itemsOf('S', GEAR_KINDS)
const gearA = itemsOf('A', GEAR_KINDS)
const findIn = (pool: Item[], name: string) => (pool.find((i) => i.name === name) ?? pool[0])?.id
const gearFeaturedS = findIn(gearS, 'Sharpened Stinger')
const gearFeaturedA = [findIn(gearA, 'Steel Cushion'), findIn(gearA, 'Luckyboo')].filter((x, i, a): x is string => !!x && a.indexOf(x) === i)

const STANDARD_S = agentsOf('S').map((i) => i.id)

const lim1S = pickAgent('S', 'Jane Doe')
const lim2S = pickAgent('S', 'Burnice White', [lim1S ?? ''])
const lim1A = [pickAgent('A', 'Seth Lowell'), pickAgent('A', 'Soukaku')].filter((x): x is string => !!x)
const lim2A = [pickAgent('A', 'Piper Wheel'), pickAgent('A', 'Ben Bigger')].filter((x): x is string => !!x)

// ── dodatkowe banery: każdy S-agent ma własny limitowany baner, A-rangi rotują parami ──
const BANNER_NAMES = [
  'Signal Overload', 'Hollow Pulse', 'Midnight Static', 'Neon Requiem', 'Ether Bloom', 'Zero Hour',
  'Ghost Frequency', 'Crimson Relay', 'Silent Ether', 'Glass Horizon', 'Feedback Loop', 'Wild Card',
  'Dead Air', 'Afterglow', 'Overdrive', 'Static Bloom', 'Red Line', 'Cold Open', 'Full Volume',
  'Low Orbit', 'Night Shift', 'Echo Chamber', 'Blue Hour', 'Wavelength', 'Chain Reaction',
  'Last Call', 'Iron Lullaby', 'Paper Moon', 'High Voltage', 'Lost Channel', 'Prime Time',
  'Burning Rubber', 'Black Box', 'Sky Dive', 'Moonlit Cipher', 'Undertow', 'Hard Reset',
  'Velvet Thunder', 'Free Fall', 'Open Mic', 'Stray Signal', 'Daybreak', 'White Noise',
  'Rogue Wave', 'Slow Burn', 'Encore', 'Sudden Death', 'Crossfade', 'Pale Fire', 'Hot Wire',
]
const usedS = new Set([lim1S, lim2S])
const A_IDS = agentsOf('A').map((i) => i.id)
const EXTRA_LIMITED: Banner[] = agentsOf('S')
  .filter((i) => !usedS.has(i.id))
  .map((it, k) => ({
    id: `lim-x-${k}`,
    kind: 'limited' as const,
    name: BANNER_NAMES[k % BANNER_NAMES.length],
    subtitle: 'Exclusive Channel',
    featuredS: it.id,
    featuredA: A_IDS.length ? [A_IDS[(k * 2) % A_IDS.length], A_IDS[(k * 2 + 1) % A_IDS.length]].filter((x, i, a) => a.indexOf(x) === i) : [],
    standardS: STANDARD_S,
    accent: it.element ? ELEMENT_COLORS[it.element][0] : '#7cffd4',
  }))

export const BANNERS: Banner[] = [
  {
    id: 'lim-1',
    kind: 'limited',
    name: 'No Match Found',
    subtitle: 'Exclusive Channel',
    featuredS: lim1S,
    featuredA: lim1A,
    standardS: STANDARD_S,
    accent: '#4d7cff',
  },
  {
    id: 'lim-2',
    kind: 'limited',
    name: 'Born to Burn',
    subtitle: 'Exclusive Channel',
    featuredS: lim2S,
    featuredA: lim2A,
    standardS: STANDARD_S,
    accent: '#ff4d2e',
  },
  ...EXTRA_LIMITED,
  {
    id: 'gear',
    kind: 'gear',
    name: 'Dissonant Sonata',
    subtitle: 'W-Engine Channel',
    featuredS: gearFeaturedS,
    featuredA: gearFeaturedA,
    standardS: gearS.map((i) => i.id).filter((id) => id !== gearFeaturedS),
    poolA: gearA.map((i) => i.id),
    accent: '#3fd8ff',
  },
  {
    id: 'standard',
    kind: 'standard',
    name: 'Stable Channel',
    subtitle: 'Permanent Channel',
    standardS: STANDARD_S,
    accent: '#ffb800',
  },
]
