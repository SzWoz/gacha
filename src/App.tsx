import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { BannerView } from './components/BannerView'
import { Collection } from './components/Collection'
import { History } from './components/History'
import { PullSequence } from './components/PullSequence'
import { BANNERS, ITEMS, type Banner } from './data/roster'
import { PlayView } from './game/PlayView'
import type { PullResult } from './lib/gacha'
import { isMuted, setMuted, sfx } from './lib/sfx'
import { useSave } from './lib/store'
import { BackgroundScene } from './three/BackgroundScene'

type Tab = 'banners' | 'collection' | 'history' | 'play'

export default function App() {
  const { save, pull, topUp, reset } = useSave()
  const [tab, setTab] = useState<Tab>('banners')
  const [banner, setBanner] = useState<Banner>(BANNERS[0])
  const [results, setResults] = useState<PullResult[] | null>(devRevealFromUrl)
  const [muted, setM] = useState(isMuted())
  const [toast, setToast] = useState<string | null>(null)
  const [inGame, setInGame] = useState(false)

  const doPull = (n: number) => {
    sfx.click()
    const r = pull(banner, n)
    if (!r) {
      setToast('Za mało ◈ — doładuj w prawym górnym rogu')
      setTimeout(() => setToast(null), 2200)
      return
    }
    setResults(r)
  }

  return (
    <div className={`app ${inGame ? 'in-game' : ''}`}>
      {/* tło lobby nie renderuje się w grze ani pod animacją losowania (oszczędza GPU) */}
      {!inGame && !results && <BackgroundScene accent={tab === 'banners' ? banner.accent : '#7cffd4'} />}
      <div className="scanlines" />

      {!inGame && (
        <header className="topbar">
          <div className="logo">
            <span className="logo-mark">◢◤</span> SIGNAL<em>//</em>SEARCH
          </div>
          <nav className="tabs">
            {(['banners', 'collection', 'history', 'play'] as Tab[]).map((t) => (
              <button
                key={t}
                className={tab === t ? 'on' : ''}
                onMouseEnter={sfx.hover}
                onClick={() => {
                  sfx.click()
                  setTab(t)
                }}
              >
                {t}
                {tab === t && <motion.span layoutId="tab-ul" className="tab-ul" />}
              </button>
            ))}
          </nav>
          <div className="wallet">
            <motion.span key={save.currency} initial={{ scale: 1.3, color: '#7cffd4' }} animate={{ scale: 1, color: '#fff' }}>
              ◈ {save.currency.toLocaleString()}
            </motion.span>
            <button
              className="topup"
              title="Doładuj 1600 ◈ (10 pulli)"
              onClick={() => {
                sfx.click()
                topUp(1600)
              }}
            >
              +
            </button>
            <button
              className="topup"
              title="Doładuj 14400 ◈ (90 pulli)"
              onClick={() => {
                sfx.click()
                topUp(14400)
              }}
            >
              ++
            </button>
            <button
              className="mute"
              onClick={() => {
                setMuted(!muted)
                setM(!muted)
              }}
            >
              {muted ? '🔇' : '🔊'}
            </button>
          </div>
        </header>
      )}

      <main>
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.25 }}
            className="tab-content"
          >
            {tab === 'banners' && (
              <BannerView banner={banner} setBanner={setBanner} pity={save.pity[banner.kind]} currency={save.currency} onPull={doPull} />
            )}
            {tab === 'collection' && <Collection owned={save.owned} />}
            {tab === 'history' && <History save={save} onReset={reset} />}
            {tab === 'play' && <PlayView owned={save.owned} onInGame={setInGame} onReward={topUp} />}
          </motion.div>
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {toast && (
          <motion.div className="toast" initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}>
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {results && <PullSequence results={results} onClose={() => setResults(null)} />}
    </div>
  )
}

/** DEV: ?reveal=Jane%20Doe,Ellen%20Joe — od razu odpala animację losowania dla podanych agentów. */
function devRevealFromUrl(): PullResult[] | null {
  if (!import.meta.env.DEV) return null
  const q = new URLSearchParams(location.search).get('reveal')
  if (!q) return null
  const names = q.split(',').map((n) => n.trim().toLowerCase())
  const items = names.map((n) => ITEMS.find((i) => i.kind === 'agent' && i.name.toLowerCase() === n)).filter((i) => !!i)
  return items.length ? items.map((item) => ({ item, pityAt: 0, featured: true, lost5050: false, isNew: true })) : null
}
