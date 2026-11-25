import { createPortal } from 'react-dom'
import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react'
import { ELEMENT_COLORS, RANK_COLOR, type Item } from '../data/roster'
import { GameEngine, type GameAction, type HudState } from './engine'

const isTouch = () => typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window)

export function Game({ agent, onExit, onChangeAgent, onReward }: { agent: Item; onExit: () => void; onChangeAgent: () => void; onReward?: (amount: number) => void }) {
  const rewardRef = useRef(onReward)
  rewardRef.current = onReward
  const mount = useRef<HTMLDivElement>(null)
  const engine = useRef<GameEngine | null>(null)
  const [hud, setHud] = useState<HudState | null>(null)
  const [touch] = useState(isTouch)

  useEffect(() => {
    const eng = new GameEngine(mount.current!, { agent, onHud: setHud, onReward: (n) => rewardRef.current?.(n) })
    engine.current = eng
    return () => {
      eng.dispose()
      engine.current = null
    }
  }, [agent])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit()
      else if (e.key === 'Enter' && hud?.gameOver) engine.current?.restart()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onExit, hud?.gameOver])

  const color = agent.element ? ELEMENT_COLORS[agent.element][0] : '#7cffd4'
  const hpPct = hud ? (hud.hp / hud.maxHp) * 100 : 100
  const spPct = hud ? (1 - hud.special / hud.specialMax) * 100 : 100

  return createPortal(
    <div className="game-root" style={{ ['--el' as string]: color }}>
      <div ref={mount} className="game-mount" />

      <div className="game-hud">
        <div className="hud-left">
          <div className="hud-name">
            <span className="hud-rank" style={{ color: RANK_COLOR[agent.rank] }}>
              {agent.rank}
            </span>
            {agent.name}
          </div>
          <div className="hud-bar hp">
            <i style={{ width: `${hpPct}%` }} />
            <span>
              {Math.ceil(hud?.hp ?? 0)} / {hud?.maxHp ?? 0}
            </span>
          </div>
          <div className="hud-cds">
            <div className={`hud-cd ${hud && hud.special <= 0 ? 'ready' : ''}`} title={hud?.superName}>
              <i style={{ height: `${spPct}%` }} />
              <b>K</b>
              <small title={hud?.superName}>{hud && hud.special > 0 ? hud.special.toFixed(1) : 'SUPER'}</small>
            </div>
            <div className={`hud-cd ${hud && hud.dodge > 0 ? 'ready' : ''} ${hud?.counter ? 'counter' : ''}`}>
              <i style={{ height: `${hud ? hud.dodgeT * 100 : 100}%` }} />
              <b className="pips">
                {Array.from({ length: hud?.dodgeMax ?? 2 }, (_, k) => (
                  <em key={k} className={hud && k < hud.dodge ? 'on' : ''} />
                ))}
              </b>
              <small>{hud?.counter ? 'KONTRA' : 'UNIK Q'}</small>
            </div>
          </div>
        </div>
        <div className="hud-right">
          <div className="hud-wave">POZIOM {hud?.level ?? 1}</div>
          <div className="hud-stat muted">{hud?.biome}</div>
          <div className="hud-stat">
            Fala <b>{(((hud?.wave ?? 1) - 1) % 3) + 1}/3</b>
          </div>
          <div className="hud-stat">
            Pokonani <b>{hud?.kills ?? 0}</b>
          </div>
          <div className="hud-stat">
            Wynik <b>{(hud?.score ?? 0).toLocaleString()}</b>
          </div>
          <div className="hud-stat coin">
            Zarobione <b>+{(hud?.earned ?? 0).toLocaleString()} ◈</b>
          </div>
          <div className="hud-stat muted">Wrogowie: {hud?.enemies ?? 0}</div>
        </div>
        <button className="game-exit" onClick={onExit}>
          ✕ WYJDŹ
        </button>
        {!touch && (
          <div className="game-help">
            <span><b>Klik</b> złap mysz · <b>Mysz</b>/<b>Z C</b> kamera</span>
            <span><b>WASD</b> ruch</span>
            <span><b>J</b>/<b>LPM</b> atak (combo ×3)</span>
            <span><b>K</b>/<b>PPM</b> specjalny</span>
            <span><b>Spacja</b> skok (2× = salto)</span>
            <span><b>Q</b> unik ×2 (też w locie, tuż przed ciosem = kontra)</span>
            <span><b>Esc</b> wyjście</span>
          </div>
        )}
        {hud?.modelKind && (
          <div className="game-model-tag">
            {hud.modelKind === 'model' ? `model 3D${hud.credit ? ` · ${hud.credit}` : ''}` : 'placeholder (brak modelu)'}
          </div>
        )}
      </div>

      {hud?.hint && !hud.gameOver && !hud.stats && <div className="game-hint">⚠ {hud.hint}</div>}

      {hud?.stats && !hud.gameOver && (
        <div className="level-stats">
          <h3>
            POZIOM {hud.stats.level} UKOŃCZONY <small>{hud.stats.biome}</small>
          </h3>
          <div className="ls-grid">
            <span>Czas</span>
            <b>
              {Math.floor(hud.stats.time / 60)}:{String(Math.floor(hud.stats.time % 60)).padStart(2, '0')}
            </b>
            <span>Pokonani</span>
            <b>{hud.stats.kills}</b>
            <span>…przez otoczenie</span>
            <b>{hud.stats.envKills}</b>
            <span>Zadane obrażenia</span>
            <b>{hud.stats.dealt.toLocaleString()}</b>
            <span>Otrzymane obrażenia</span>
            <b>{hud.stats.taken.toLocaleString()}</b>
            <span>Najdłuższe combo</span>
            <b>{hud.stats.maxCombo}×</b>
            <span>Perfekcyjne uniki</span>
            <b>{hud.stats.perfect}</b>
            <span>Monety z platform</span>
            <b>{hud.stats.coins}</b>
            <span>Apteczki</span>
            <b>{hud.stats.heals}</b>
            <span>Zarobione</span>
            <b className="coin">+{hud.stats.earned.toLocaleString()} ◈</b>
          </div>
          <p>Wejdź w portal w arenie bossa, żeby przejść na nową mapę →</p>
        </div>
      )}

      {hud?.boss && !hud.gameOver && (
        <div className="boss-bar">
          <span>BOSS</span>
          <i style={{ width: `${(hud.boss.hp / hud.boss.max) * 100}%` }} />
        </div>
      )}

      {hud?.banner && !hud.gameOver && (
        <div key={hud.banner} className="game-banner">
          {hud.banner}
        </div>
      )}

      {(!hud || hud.loading) && <div className="game-loading">ładowanie modelu…</div>}

      {hud?.gameOver && (
        <div className="game-over">
          <h2>KONIEC GRY</h2>
          <p>
            Poziom <b>{hud.level}</b> · Fala <b>{hud.wave}</b> · Pokonani <b>{hud.kills}</b> · Wynik <b>{hud.score.toLocaleString()}</b>
          </p>
          <div className="game-over-btns">
            <button className="btn-g primary" onClick={() => engine.current?.restart()}>
              ↻ JESZCZE RAZ
            </button>
            <button className="btn-g" onClick={onChangeAgent}>
              WYBÓR AGENTA
            </button>
          </div>
        </div>
      )}

      {touch && !hud?.gameOver && <TouchControls engine={engine} />}
    </div>,
    document.body,
  )
}

function TouchControls({ engine }: { engine: RefObject<GameEngine | null> }) {
  const base = useRef<HTMLDivElement>(null)
  const [knob, setKnob] = useState({ x: 0, y: 0 })
  const pid = useRef<number | null>(null)

  const move = (e: PointerEvent) => {
    const r = base.current!.getBoundingClientRect()
    const R = r.width / 2
    let x = (e.clientX - (r.left + R)) / R
    let y = (e.clientY - (r.top + R)) / R
    const l = Math.hypot(x, y)
    if (l > 1) {
      x /= l
      y /= l
    }
    setKnob({ x, y })
    engine.current?.setStick(x, -y)
  }
  const end = () => {
    pid.current = null
    setKnob({ x: 0, y: 0 })
    engine.current?.setStick(0, 0)
  }
  const btn = (a: GameAction) => (e: PointerEvent) => {
    e.preventDefault()
    engine.current?.trigger(a)
  }

  return (
    <div className="touch-ui">
      <div
        ref={base}
        className="joy"
        onPointerDown={(e) => {
          pid.current = e.pointerId
          e.currentTarget.setPointerCapture(e.pointerId)
          move(e)
        }}
        onPointerMove={(e) => pid.current === e.pointerId && move(e)}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <div className="joy-knob" style={{ transform: `translate(${knob.x * 40}px, ${knob.y * 40}px)` }} />
      </div>
      <div className="touch-btns">
        <button className="tb dodge" onPointerDown={btn('dodge')}>
          UNIK
        </button>
        <button className="tb jump" onPointerDown={btn('jump')}>
          SKOK
        </button>
        <button className="tb special" onPointerDown={btn('special')}>
          SPEC
        </button>
        <button className="tb attack" onPointerDown={btn('attack')}>
          ATAK
        </button>
      </div>
    </div>
  )
}
