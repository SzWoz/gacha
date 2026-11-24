import { ITEMS, byId, type Banner, type Item, type Rank } from '../data/roster'

export const PULL_COST = 160
export const HARD_PITY_S = 90
export const SOFT_PITY_S = 74
export const BASE_S = 0.006
export const BASE_A = 0.094
export const HARD_PITY_A = 10

export interface PityState {
  s: number // pulls since last S
  a: number // pulls since last A (or better)
  guaranteedS: boolean // lost last 50/50
  guaranteedA: boolean
}

export const freshPity = (): PityState => ({ s: 0, a: 0, guaranteedS: false, guaranteedA: false })

export interface PullResult {
  item: Item
  pityAt: number // pull count at which it dropped (for S/A)
  featured: boolean
  lost5050: boolean
  isNew: boolean
}

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]

export function sRate(pullNo: number): number {
  if (pullNo >= HARD_PITY_S) return 1
  if (pullNo < SOFT_PITY_S) return BASE_S
  return Math.min(1, BASE_S + (pullNo - SOFT_PITY_S + 1) * 0.06)
}

const A_AGENTS = ITEMS.filter((i) => i.rank === 'A')
const B_ITEMS = ITEMS.filter((i) => i.rank === 'B')

/** Performs a single pull and mutates `pity` in-place. */
export function pullOnce(banner: Banner, pity: PityState, owned: Record<string, number>): PullResult {
  pity.s += 1
  pity.a += 1
  const r = Math.random()
  let rank: Rank
  if (r < sRate(pity.s)) rank = 'S'
  else if (pity.a >= HARD_PITY_A || r < sRate(pity.s) + BASE_A) rank = 'A'
  else rank = 'B'

  let item: Item
  let featured = false
  let lost5050 = false
  let pityAt = 0

  if (rank === 'S') {
    pityAt = pity.s
    if (banner.kind === 'limited' && banner.featuredS) {
      if (pity.guaranteedS || Math.random() < 0.5) {
        item = byId[banner.featuredS]
        featured = true
        pity.guaranteedS = false
      } else {
        item = byId[pick(banner.standardS)]
        lost5050 = true
        pity.guaranteedS = true
      }
    } else {
      item = byId[pick(banner.standardS)]
    }
    pity.s = 0
    pity.a = 0
  } else if (rank === 'A') {
    pityAt = pity.a
    if (banner.featuredA?.length && (pity.guaranteedA || Math.random() < 0.5)) {
      item = byId[pick(banner.featuredA)]
      featured = true
      pity.guaranteedA = false
    } else {
      item = pick(A_AGENTS)
      if (banner.featuredA?.length) {
        featured = banner.featuredA.includes(item.id)
        pity.guaranteedA = !featured
      }
    }
    pity.a = 0
  } else {
    item = pick(B_ITEMS)
  }

  const isNew = item.kind === 'agent' && !owned[item.id]
  owned[item.id] = (owned[item.id] ?? 0) + 1
  return { item, pityAt, featured, lost5050, isNew }
}

export const rankValue = (r: Rank) => (r === 'S' ? 2 : r === 'A' ? 1 : 0)
