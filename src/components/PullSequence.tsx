import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { RANK_COLOR } from '../data/roster'
import { rankValue, type PullResult } from '../lib/gacha'
import { sfx } from '../lib/sfx'
import { WarpScene } from '../three/WarpScene'
import { Portrait } from './Portrait'
import { ResultCard } from './ResultCard'

type Phase = 'warp' | 'flash' | 'reveal' | 'summary'

export function PullSequence({ results, onClose }: { results: PullResult[]; onClose: () => void }) {
  const tier = Math.max(...results.map((r) => rankValue(r.item.rank)))
  const [phase, setPhase] = useState<Phase>('warp')
  const [idx, setIdx] = useState(0)

  const reveals = useMemo(() => {
    const special = results.filter((r) => r.item.rank !== 'B')
    return special.length ? special : results.length === 1 ? results : []
  }, [results])

  useEffect(() => {
    sfx.warp()
  }, [])

  const toFlash = () => {
    if (phase !== 'warp') return
    sfx.burst(tier)
    setPhase('flash')
    setTimeout(() => setPhase(reveals.length ? 'reveal' : 'summary'), tier === 2 ? 1100 : 700)
  }

  const next = () => {
    if (phase === 'warp') return toFlash()
    if (phase === 'reveal') {
      if (idx + 1 < reveals.length) setIdx(idx + 1)
      else setPhase(results.length > 1 ? 'summary' : 'summary')
    }
  }

  const skip = (e: React.MouseEvent) => {
    e.stopPropagation()
    sfx.click()
    setPhase('summary')
  }

  return (
    <div className="pull-overlay" onClick={next}>
      {(phase === 'warp' || phase === 'flash') && <WarpScene tier={tier} duration={tier === 2 ? 3.2 : 2.6} onDone={toFlash} />}

      <AnimatePresence>
        {phase === 'flash' && (
          <motion.div
            key="flash"
            className="flash"
            style={{ ['--flash' as string]: RANK_COLOR[(['B', 'A', 'S'] as const)[tier]] }}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 1, 0] }}
            transition={{ duration: tier === 2 ? 1.1 : 0.7, times: [0, 0.15, 0.5, 1] }}
          >
            {tier === 2 && (
              <>
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="shockwave"
                    initial={{ scale: 0, opacity: 1 }}
                    animate={{ scale: 6, opacity: 0 }}
                    transition={{ duration: 1, delay: i * 0.12, ease: 'easeOut' }}
                  />
                ))}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {phase === 'reveal' && reveals[idx] && <Splash key={idx} r={reveals[idx]} />}
      </AnimatePresence>

      {phase === 'summary' && <Summary results={results} onClose={onClose} />}

      {phase !== 'summary' && (
        <button className="skip-btn" onClick={skip}>
          SKIP ▸▸
        </button>
      )}
      {phase === 'warp' && <div className="tap-hint">tap to accelerate</div>}
    </div>
  )
}

function Splash({ r }: { r: PullResult }) {
  const { item } = r
  const color = RANK_COLOR[item.rank]
  const isS = item.rank === 'S'

  useEffect(() => {
    sfx.reveal(rankValue(item.rank))
  }, [item.rank])

  return (
    <motion.div
      className={`splash rank-${item.rank}`}
      style={{ ['--rc' as string]: color }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, x: -80, filter: 'blur(8px)' }}
      transition={{ duration: 0.3 }}
    >
      <motion.div
        className="splash-stripes"
        initial={{ x: '-100%' }}
        animate={{ x: '0%' }}
        transition={{ duration: 0.5, ease: [0.2, 0.9, 0.2, 1] }}
      />
      {isS && <Sparks color={color} />}

      <motion.div
        className="splash-art"
        initial={{ x: 300, opacity: 0, skewX: -12, scale: 1.2 }}
        animate={{ x: 0, opacity: 1, skewX: 0, scale: 1 }}
        transition={{ delay: 0.15, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      >
        <Portrait item={item} className="big" />
        <div className="art-glow" />
      </motion.div>

      <div className="splash-text">
        <motion.div
          className="rank-stamp"
          initial={{ scale: 4, opacity: 0, rotate: -30 }}
          animate={{ scale: 1, opacity: 1, rotate: -8 }}
          transition={{ delay: 0.45, type: 'spring', stiffness: 260, damping: 14 }}
        >
          {item.rank}
        </motion.div>
        <motion.div className="splash-title" initial={{ x: -60, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.3 }}>
          {item.title}
        </motion.div>
        <motion.h1 className="splash-name" initial={{ x: -200, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.35, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}>
          {item.name.split('').map((ch, i) => (
            <motion.span key={i} initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.4 + i * 0.03 }}>
              {ch === ' ' ? ' ' : ch}
            </motion.span>
          ))}
        </motion.h1>
        <motion.div className="chips" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }}>
          {item.element && <span className="chip">{item.element}</span>}
          {item.role && <span className="chip">{item.role}</span>}
          {item.faction && <span className="chip ghost">{item.faction}</span>}
          {r.isNew && <span className="chip new">NEW</span>}
          {r.lost5050 && <span className="chip lost">50/50 LOST</span>}
          {r.featured && item.rank === 'S' && <span className="chip won">FEATURED</span>}
          {r.pityAt > 0 && <span className="chip ghost">pity {r.pityAt}</span>}
        </motion.div>
        {item.quote && (
          <motion.blockquote initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1 }}>
            “{item.quote}”
          </motion.blockquote>
        )}
      </div>
      <div className="tap-hint">tap to continue</div>
    </motion.div>
  )
}

function Sparks({ color }: { color: string }) {
  const sparks = useMemo(
    () =>
      Array.from({ length: 40 }, () => ({
        a: Math.random() * Math.PI * 2,
        d: 200 + Math.random() * 600,
        s: 2 + Math.random() * 5,
        delay: Math.random() * 0.3,
      })),
    [],
  )
  return (
    <div className="sparks">
      {sparks.map((s, i) => (
        <motion.i
          key={i}
          style={{ width: s.s, height: s.s * 6, background: color, rotate: `${(s.a * 180) / Math.PI + 90}deg` }}
          initial={{ x: 0, y: 0, opacity: 1 }}
          animate={{ x: Math.cos(s.a) * s.d, y: Math.sin(s.a) * s.d, opacity: 0 }}
          transition={{ duration: 1.2, delay: 0.2 + s.delay, ease: 'easeOut' }}
        />
      ))}
    </div>
  )
}

function Summary({ results, onClose }: { results: PullResult[]; onClose: () => void }) {
  return (
    <motion.div className="summary" initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={(e) => e.stopPropagation()}>
      <motion.h2 initial={{ letterSpacing: '1em', opacity: 0 }} animate={{ letterSpacing: '0.3em', opacity: 1 }} transition={{ duration: 0.6 }}>
        SIGNAL RESULTS
      </motion.h2>
      <div className={`summary-grid n${results.length}`}>
        {results.map((r, i) => (
          <ResultCard key={i} r={r} delay={0.1 + i * 0.08} />
        ))}
      </div>
      <motion.button
        className="btn primary"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 + results.length * 0.08 }}
        onClick={() => {
          sfx.click()
          onClose()
        }}
      >
        CONFIRM
      </motion.button>
    </motion.div>
  )
}
