import { motion } from 'motion/react'
import { useCallback, useState } from 'react'
import { Portrait } from '../components/Portrait'
import { ELEMENT_COLORS, ITEMS, RANK_COLOR, type Item } from '../data/roster'
import { sfx } from '../lib/sfx'
import { enterLandscape, isTouch } from './device'
import { Game } from './Game'

/** "play" tab: pick an owned agent, then drop into the arena. */
export function PlayView({ owned, onInGame, onReward }: { owned: Record<string, number>; onInGame: (v: boolean) => void; onReward?: (amount: number) => void }) {
  const [agent, setAgent] = useState<Item | null>(null)
  const agents = ITEMS.filter((i) => i.kind === 'agent')
  const mine = agents.filter((i) => owned[i.id])
  const list = mine.length ? mine : agents

  const start = (a: Item) => {
    sfx.click()
    if (isTouch()) void enterLandscape()
    setAgent(a)
    onInGame(true)
  }
  const exit = useCallback(() => {
    setAgent(null)
    onInGame(false)
  }, [onInGame])

  if (agent) return <Game agent={agent} onExit={exit} onChangeAgent={exit} onReward={onReward} />

  return (
    <div className="page">
      <header className="page-head">
        <h2>NEW ERIDU · WYBIERZ AGENTA</h2>
        <span className="muted">{mine.length ? `${mine.length} dostępnych` : 'Nie masz jeszcze agentów — wylosuj agentów w bannerach (na razie możesz grać każdym)'}</span>
      </header>
      <div className="collection-grid">
        {list.map((it, i) => (
          <motion.button
            key={it.id}
            className={`ccard rank-${it.rank} play-pick`}
            style={{ ['--rc' as string]: RANK_COLOR[it.rank], ['--el' as string]: it.element ? ELEMENT_COLORS[it.element][0] : '#7cffd4' }}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.03, 0.6) }}
            whileHover={{ y: -8 }}
            onMouseEnter={sfx.hover}
            onClick={() => start(it)}
          >
            <Portrait item={it} />
            <div className="rcard-shine" />
            <div className="rcard-info">
              <span className="rcard-rank">{it.rank}</span>
              <span className="rcard-name">{it.name}</span>
            </div>
            <span className="play-go">▶ GRAJ</span>
          </motion.button>
        ))}
      </div>
    </div>
  )
}
