// ─────────────────────────────────────────────────────────────
//  ROSTER — edytuj śmiało.
//  Obrazki: /public/<typ>/<ranga>-rank/<name>.png (lub .webp/.jpg),
//  gdzie typ = agents | w-engines (gear) | bangboo — np.
//  public/agents/S-rank/Jane Doe.png. Dopasowuje po `name`, potem po `id`.
//  `image` może nadpisać: sama nazwa pliku w folderze rangi albo pełna
//  ścieżka (/...). Bez obrazka karta generuje proceduralny portret.
// ─────────────────────────────────────────────────────────────

export type Rank = 'S' | 'A' | 'B'
export type Element = 'Fire' | 'Ice' | 'Electric' | 'Physical' | 'Ether'
export type Role = 'Attack' | 'Stun' | 'Anomaly' | 'Support' | 'Defense'

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
}

export const ELEMENT_GLYPH: Record<Element, string> = {
  Fire: '◆',
  Ice: '❄',
  Electric: 'ϟ',
  Physical: '■',
  Ether: '✦',
}

export const RANK_COLOR: Record<Rank, string> = {
  S: '#ffb800',
  A: '#c56bff',
  B: '#3fa9ff',
}

const S = (o: Omit<Item, 'rank' | 'kind'>): Item => ({ ...o, rank: 'S', kind: 'agent' })
const A = (o: Omit<Item, 'rank' | 'kind'>): Item => ({ ...o, rank: 'A', kind: 'agent' })
const B = (id: string, name: string, title: string): Item => ({ id, name, title, rank: 'B', kind: 'gear' })

export const ITEMS: Item[] = [
  // ── S-rank ─────────────────────────────────────────────
  S({ id: 'vex', name: 'Vex Arclight', title: 'Overclock Duelist', element: 'Electric', role: 'Attack', faction: 'Static Saints', quote: 'Blink and you missed the whole fight.' }),
  S({ id: 'marrow', name: 'Marrow', title: 'Furnace Queen', element: 'Fire', role: 'Attack', faction: 'Rust Syndicate', quote: 'Everything burns. I just pick the order.' }),
  S({ id: 'yuki', name: 'Yuki Hanamori', title: 'Frostline Ronin', element: 'Ice', role: 'Attack', faction: 'Ninth Precinct', quote: 'One cut. Clean. Cold.' }),
  S({ id: 'oro', name: 'Oro Blackbell', title: 'Iron Sentinel', element: 'Physical', role: 'Stun', faction: 'Velvet Union', quote: 'Lean on me. I don’t bend.' }),
  S({ id: 'nyx', name: 'Nyx-07', title: 'Void Sampler', element: 'Ether', role: 'Anomaly', faction: 'Hollow Bureau', quote: 'Signal acquired. Reality optional.' }),
  S({ id: 'calla', name: 'Calla Vane', title: 'Neon Conductor', element: 'Ether', role: 'Support', faction: 'Neon Hounds', quote: 'Stay on beat and nobody gets hurt.' }),
  S({ id: 'drax', name: 'Drax Halberd', title: 'Riot Breaker', element: 'Fire', role: 'Stun', faction: 'Ninth Precinct', quote: 'Order is a fist. I am the fist.' }),

  // ── A-rank ─────────────────────────────────────────────
  A({ id: 'pip', name: 'Pip Rivets', title: 'Scrap Mechanic', element: 'Physical', role: 'Defense', faction: 'Rust Syndicate' }),
  A({ id: 'luma', name: 'Luma', title: 'Glowstick Medic', element: 'Ether', role: 'Support', faction: 'Neon Hounds' }),
  A({ id: 'kade', name: 'Kade Osric', title: 'Shock Courier', element: 'Electric', role: 'Stun', faction: 'Static Saints' }),
  A({ id: 'fen', name: 'Fen Holloway', title: 'Ash Runner', element: 'Fire', role: 'Anomaly', faction: 'Hollow Bureau' }),
  A({ id: 'sora', name: 'Sora Kiri', title: 'Mist Sniper', element: 'Ice', role: 'Attack', faction: 'Velvet Union' }),
  A({ id: 'bram', name: 'Bram', title: 'Bouncer Bot', element: 'Physical', role: 'Stun', faction: 'Velvet Union' }),
  A({ id: 'zia', name: 'Zia Coil', title: 'Wire Witch', element: 'Electric', role: 'Anomaly', faction: 'Neon Hounds' }),
  A({ id: 'tess', name: 'Tess Rook', title: 'Patrol Cadet', element: 'Ice', role: 'Support', faction: 'Ninth Precinct' }),

  // ── B-rank (gear / śmieci) ─────────────────────────────
  B('g1', 'Rusty Pipe', 'Gear'),
  B('g2', 'Street Tape', 'Gear'),
  B('g3', 'Cheap Amp', 'Gear'),
  B('g4', 'Bent Antenna', 'Gear'),
  B('g5', 'Spare Battery', 'Gear'),
  B('g6', 'Cracked Visor', 'Gear'),
  B('g7', 'Lucky Dice', 'Gear'),
  B('g8', 'Old Cassette', 'Gear'),
]

export const byId = Object.fromEntries(ITEMS.map((i) => [i.id, i])) as Record<string, Item>

export type BannerKind = 'limited' | 'standard'

export interface Banner {
  id: string
  kind: BannerKind
  name: string
  subtitle: string
  featuredS?: string
  featuredA?: string[]
  /** S-ranki dostępne gdy przegrasz 50/50 lub na stałym banerze */
  standardS: string[]
  accent: string
}

const STANDARD_S = ['oro', 'nyx', 'calla', 'drax', 'yuki']

export const BANNERS: Banner[] = [
  {
    id: 'lim-vex',
    kind: 'limited',
    name: 'Overclock Rush',
    subtitle: 'Exclusive Channel',
    featuredS: 'vex',
    featuredA: ['kade', 'zia'],
    standardS: STANDARD_S,
    accent: '#4d7cff',
  },
  {
    id: 'lim-marrow',
    kind: 'limited',
    name: 'Furnace Heart',
    subtitle: 'Exclusive Channel',
    featuredS: 'marrow',
    featuredA: ['fen', 'pip'],
    standardS: STANDARD_S,
    accent: '#ff4d2e',
  },
  {
    id: 'standard',
    kind: 'standard',
    name: 'Stable Frequency',
    subtitle: 'Standard Channel',
    standardS: STANDARD_S,
    accent: '#ffb800',
  },
]
