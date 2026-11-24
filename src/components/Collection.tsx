import { motion } from 'motion/react'
import { useState } from 'react'
import { ITEMS, RANK_COLOR, type Rank } from '../data/roster'
import { Portrait } from './Portrait'

export function Collection({ owned }: { owned: Record<string, number> }) {
  const [filter, setFilter] = useState<Rank | 'ALL'>('ALL')
  const agents = ITEMS.filter((i) => i.kind === 'agent' && (filter === 'ALL' || i.rank === filter))
  const have = ITEMS.filter((i) => i.kind === 'agent' && owned[i.id]).length
  const total = ITEMS.filter((i) => i.kind === 'agent').length

  return (
    <div className="page">
      <header className="page-head">
        <h2>AGENT ROSTER</h2>
        <span className="muted">
          {have} / {total} recruited
        </span>
        <div className="filters">
          {(['ALL', 'S', 'A'] as const).map((f) => (
            <button key={f} className={`filter ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>
              {f}
            </button>
          ))}
        </div>
      </header>
      <div className="collection-grid">
        {agents.map((it, i) => {
          const n = owned[it.id] ?? 0
          return (
            <motion.div
              key={it.id}
              className={`ccard rank-${it.rank} ${n ? '' : 'locked'}`}
              style={{ ['--rc' as string]: RANK_COLOR[it.rank] }}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              whileHover={n ? { y: -8, rotateX: 6, rotateY: -6 } : {}}
            >
              <Portrait item={it} />
              <div className="rcard-shine" />
              <div className="rcard-info">
                <span className="rcard-rank">{it.rank}</span>
                <span className="rcard-name">{n ? it.name : '???'}</span>
              </div>
              {n > 0 && <span className="dupes">C{Math.min(n - 1, 6)}</span>}
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
