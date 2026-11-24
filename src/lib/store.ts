import { useCallback, useEffect, useState } from 'react'
import type { Banner } from '../data/roster'
import { PULL_COST, freshPity, pullOnce, type PityState, type PullResult } from './gacha'

const KEY = 'signal-gacha:v1'

export interface HistoryEntry {
  t: number
  id: string
  banner: string
  pityAt: number
  featured: boolean
  lost5050: boolean
}

export interface SaveState {
  currency: number
  pity: { limited: PityState; standard: PityState }
  owned: Record<string, number>
  history: HistoryEntry[]
  totalPulls: number
  spent: number
}

const initial = (): SaveState => ({
  currency: 16000,
  pity: { limited: freshPity(), standard: freshPity() },
  owned: {},
  history: [],
  totalPulls: 0,
  spent: 0,
})

function load(): SaveState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return initial()
    return { ...initial(), ...JSON.parse(raw) }
  } catch {
    return initial()
  }
}

export function useSave() {
  const [save, setSave] = useState<SaveState>(load)

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(save))
  }, [save])

  const pull = useCallback(
    (banner: Banner, count: number): PullResult[] | null => {
      const cost = PULL_COST * count
      if (save.currency < cost) return null
      const pity = structuredClone(save.pity[banner.kind])
      const owned = { ...save.owned }
      const results: PullResult[] = []
      for (let i = 0; i < count; i++) results.push(pullOnce(banner, pity, owned))
      const now = Date.now()
      const entries: HistoryEntry[] = results.map((r, i) => ({
        t: now + i,
        id: r.item.id,
        banner: banner.id,
        pityAt: r.pityAt,
        featured: r.featured,
        lost5050: r.lost5050,
      }))
      setSave((s) => ({
        ...s,
        currency: s.currency - cost,
        pity: { ...s.pity, [banner.kind]: pity },
        owned,
        history: [...entries.reverse(), ...s.history].slice(0, 5000),
        totalPulls: s.totalPulls + count,
        spent: s.spent + cost,
      }))
      return results
    },
    [save],
  )

  const topUp = useCallback((amount: number) => setSave((s) => ({ ...s, currency: s.currency + amount })), [])
  const reset = useCallback(() => setSave(initial()), [])

  return { save, pull, topUp, reset }
}
