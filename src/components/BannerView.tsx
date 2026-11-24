import { AnimatePresence, motion } from 'motion/react'
import { BANNERS, byId, RANK_COLOR, type Banner } from '../data/roster'
import { HARD_PITY_A, HARD_PITY_S, PULL_COST, type PityState } from '../lib/gacha'
import { sfx } from '../lib/sfx'
import { Portrait } from './Portrait'

interface Props {
  banner: Banner
  setBanner: (b: Banner) => void
  pity: PityState
  currency: number
  onPull: (n: number) => void
}

export function BannerView({ banner, setBanner, pity, currency, onPull }: Props) {
  const featured = banner.featuredS ? byId[banner.featuredS] : null
  const showcase = featured ?? byId[banner.standardS[0]]

  return (
    <div className="banner-layout">
      <nav className="banner-tabs">
        {BANNERS.map((b) => {
          const it = byId[b.featuredS ?? b.standardS[0]]
          return (
            <motion.button
              key={b.id}
              className={`banner-tab ${b.id === banner.id ? 'active' : ''}`}
              style={{ ['--acc' as string]: b.accent }}
              whileHover={{ x: 6 }}
              onMouseEnter={sfx.hover}
              onClick={() => {
                sfx.click()
                setBanner(b)
              }}
            >
              <Portrait item={it} className="thumb" />
              <div>
                <small>{b.subtitle}</small>
                <strong>{b.name}</strong>
              </div>
            </motion.button>
          )
        })}
      </nav>

      <AnimatePresence mode="wait">
        <motion.section
          key={banner.id}
          className="banner-main"
          style={{ ['--acc' as string]: banner.accent }}
          initial={{ opacity: 0, x: 60, filter: 'blur(10px)' }}
          animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, x: -60, filter: 'blur(10px)' }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="banner-bg-text">{banner.name.toUpperCase()}</div>
          <div className="banner-hero">
            <motion.div
              className="hero-art"
              initial={{ scale: 1.15, rotate: 3 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
            >
              <Portrait item={showcase} className="big" />
            </motion.div>
            <div className="hero-info">
              <span className="kicker">{banner.subtitle}</span>
              <h1 className="glitch" data-text={banner.name}>
                {banner.name}
              </h1>
              {featured ? (
                <>
                  <p className="rate-up">
                    <b style={{ color: RANK_COLOR.S }}>S</b> rate-up · <strong>{featured.name}</strong> — {featured.title}
                  </p>
                  <div className="featured-a">
                    {banner.featuredA?.map((id) => (
                      <div key={id} className="mini">
                        <Portrait item={byId[id]} className="thumb" />
                        <span>
                          <b style={{ color: RANK_COLOR.A }}>A</b> {byId[id].name}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="rate-up">Permanent channel. Every standard S-rank is up for grabs.</p>
              )}

              <div className="pity-box">
                <PityBar label="S pity" value={pity.s} max={HARD_PITY_S} color={RANK_COLOR.S} soft={74} />
                <PityBar label="A pity" value={pity.a} max={HARD_PITY_A} color={RANK_COLOR.A} />
                {banner.kind === 'limited' && (
                  <div className="guarantee">
                    Next S: <b className={pity.guaranteedS ? 'on' : ''}>{pity.guaranteedS ? 'GUARANTEED FEATURED' : '50 / 50'}</b>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="pull-buttons">
            {[1, 10].map((n) => (
              <motion.button
                key={n}
                className={`btn pull ${n === 10 ? 'primary' : ''}`}
                disabled={currency < n * PULL_COST}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onMouseEnter={sfx.hover}
                onClick={() => onPull(n)}
              >
                <span>SIGNAL ×{n}</span>
                <small>◈ {n * PULL_COST}</small>
              </motion.button>
            ))}
          </div>
        </motion.section>
      </AnimatePresence>
    </div>
  )
}

function PityBar({ label, value, max, color, soft }: { label: string; value: number; max: number; color: string; soft?: number }) {
  return (
    <div className="pity">
      <div className="pity-label">
        <span>{label}</span>
        <span>
          {value} / {max}
        </span>
      </div>
      <div className="pity-track">
        {soft && <div className="pity-soft" style={{ left: `${(soft / max) * 100}%` }} />}
        <motion.div className="pity-fill" style={{ background: color }} animate={{ width: `${(value / max) * 100}%` }} transition={{ type: 'spring', stiffness: 80 }} />
      </div>
    </div>
  )
}
