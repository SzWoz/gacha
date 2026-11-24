import { motion } from 'motion/react'
import { useEffect } from 'react'
import { RANK_COLOR } from '../data/roster'
import type { PullResult } from '../lib/gacha'
import { sfx } from '../lib/sfx'
import { Portrait } from './Portrait'

export function ResultCard({ r, delay }: { r: PullResult; delay: number }) {
  const { item } = r
  useEffect(() => {
    const t = setTimeout(() => sfx.flip(), delay * 1000)
    return () => clearTimeout(t)
  }, [delay])

  return (
    <motion.div
      className={`rcard rank-${item.rank}`}
      style={{ ['--rc' as string]: RANK_COLOR[item.rank] }}
      initial={{ rotateY: 180, y: 60, opacity: 0 }}
      animate={{ rotateY: 0, y: 0, opacity: 1 }}
      transition={{ delay, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -10, scale: 1.04 }}
    >
      <Portrait item={item} />
      <div className="rcard-shine" />
      <div className="rcard-info">
        <span className="rcard-rank">{item.rank}</span>
        <span className="rcard-name">{item.name}</span>
      </div>
      {r.isNew && <span className="badge-new">NEW</span>}
    </motion.div>
  )
}
