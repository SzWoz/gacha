import { createPortal } from 'react-dom'
import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react'
import { ELEMENT_COLORS, RANK_COLOR, type Item } from '../data/roster'
import { enterLandscape, isTouch, portraitQuery } from './device'
import { GameEngine, ZOOM_STEPS, type GameAction, type HudState } from './engine'


export function Game({ agent, onExit, onChangeAgent, onReward }: { agent: Item; onExit: () => void; onChangeAgent: () => void; onReward?: (amount: number) => void }) {
  const rewardRef = useRef(onReward)
  rewardRef.current = onReward
  const mount = useRef<HTMLDivElement>(null)
  const engine = useRef<GameEngine | null>(null)
  const [hud, setHud] = useState<HudState | null>(null)
  const [touch] = useState(isTouch)

  useEffect(() => {
    const eng = new GameEngine(mount.current!, { agent, touch: isTouch(), onHud: setHud, onReward: (n) => rewardRef.current?.(n) })
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

  // iOS Safari: blokada pinch-zoom / podwójnego tapnięcia w trakcie gry
  useEffect(() => {
    if (!touch) return
    const stop = (e: Event) => e.preventDefault()
    document.addEventListener('gesturestart', stop)
    document.addEventListener('dblclick', stop)
    return () => {
      document.removeEventListener('gesturestart', stop)
      document.removeEventListener('dblclick', stop)
      if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {})
    }
  }, [touch])

  // wymuszony tryb poziomy: w pionie gra stoi i pokazuje planszę „obróć telefon”
  const [portrait, setPortrait] = useState(() => touch && portraitQuery().matches)
  useEffect(() => {
    if (!touch) return
    const mq = portraitQuery()
    const on = () => setPortrait(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [touch])
  useEffect(() => {
    engine.current?.setPaused(portrait)
  }, [portrait, agent])

  const [zoom, setZoom] = useState(0)
  useEffect(() => {
    setZoom(engine.current?.zoomLevel() ?? 0)
  }, [agent])

  const [fs, setFs] = useState(false)
  useEffect(() => {
    const on = () => setFs(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])
  const canFs = typeof document !== 'undefined' && !!document.documentElement.requestFullscreen
  const toggleFs = async () => {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})
    else await enterLandscape()
  }

  const color = agent.element ? ELEMENT_COLORS[agent.element][0] : '#7cffd4'
  const hpPct = hud ? (hud.hp / hud.maxHp) * 100 : 100
  const spPct = hud ? (1 - hud.special / hud.specialMax) * 100 : 100

  return createPortal(
    <div className={`game-root ${touch ? 'touch' : ''}`} style={{ ['--el' as string]: color }}>
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
          {!touch && (
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
          )}
        </div>
        <div className="hud-right">
          <div className="hud-wave">POZIOM {hud?.level ?? 1}</div>
          {!touch && <div className="hud-stat muted">{hud?.biome}</div>}
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
          {touch && <div className="hud-stat muted">{hud?.biome}</div>}
        </div>
        <button className="game-exit" onClick={onExit}>
          ✕{touch ? '' : ' WYJDŹ'}
        </button>
        {touch && (
          <button className="game-zoom" onClick={() => setZoom(engine.current?.cycleZoom() ?? 0)} aria-label="Oddalenie kamery">
            <span>🎥</span>
            <em className="pips">
              {ZOOM_STEPS.map((_, k) => (
                <i key={k} className={k <= zoom ? 'on' : ''} />
              ))}
            </em>
          </button>
        )}
        {touch && canFs && (
          <button className="game-fs" onClick={toggleFs} aria-label="Pełny ekran">
            {fs ? '⤡' : '⛶'}
          </button>
        )}
        {!touch && (
          <div className="game-help">
            <span><b>Klik</b> złap mysz · <b>Mysz</b>/<b>Z C</b> kamera · <b>Kółko</b> zoom</span>
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

      {portrait && (
        <div className="rotate-lock">
          <div className="rotate-phone" />
          <h3>OBRÓĆ TELEFON</h3>
          <p>Arena działa tylko w poziomie — gra jest wstrzymana</p>
          {canFs && (
            <button className="btn-g primary" onClick={enterLandscape}>
              ⛶ PEŁNY EKRAN POZIOMO
            </button>
          )}
          <button className="btn-g" onClick={onExit}>
            ✕ WYJDŹ
          </button>
        </div>
      )}

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

      {touch && !portrait && !hud?.gameOver && <TouchControls engine={engine} hud={hud} />}
    </div>,
    document.body,
  )
}

const buzz = (ms = 8) => navigator.vibrate?.(ms)

/** Mobilne sterowanie: pływający joystick (lewa połowa), przyciski akcji z cooldownami (prawa), reszta ekranu = kamera. */
function TouchControls({ engine, hud }: { engine: RefObject<GameEngine | null>; hud: HudState | null }) {
  const R = 56
  const [joy, setJoy] = useState<{ ox: number; oy: number; x: number; y: number } | null>(null)
  const pid = useRef<number | null>(null)
  const origin = useRef({ x: 0, y: 0 })
  const atkTimer = useRef<number | null>(null)

  const stopAttack = () => {
    if (atkTimer.current !== null) window.clearInterval(atkTimer.current)
    atkTimer.current = null
  }
  useEffect(() => stopAttack, [])

  const move = (e: PointerEvent) => {
    let x = (e.clientX - origin.current.x) / R
    let y = (e.clientY - origin.current.y) / R
    const l = Math.hypot(x, y)
    if (l > 1) {
      // joystick "ciągnie się" za palcem, żeby nie trzeba było wracać do środka
      origin.current.x += (x / l) * (l - 1) * R
      origin.current.y += (y / l) * (l - 1) * R
      x /= l
      y /= l
    }
    const dead = l < 0.12
    setJoy({ ox: origin.current.x, oy: origin.current.y, x, y })
    engine.current?.setStick(dead ? 0 : x, dead ? 0 : -y)
  }
  const end = (e: PointerEvent) => {
    if (pid.current !== e.pointerId) return
    pid.current = null
    setJoy(null)
    engine.current?.setStick(0, 0)
  }
  const press = (a: GameAction) => (e: PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    buzz()
    engine.current?.trigger(a)
    if (a === 'attack') {
      // przytrzymanie = ciągłe combo
      stopAttack()
      atkTimer.current = window.setInterval(() => engine.current?.trigger('attack'), 110)
    }
  }

  const spReady = !!hud && hud.special <= 0
  const spPct = hud ? (hud.special / hud.specialMax) * 100 : 0

  return (
    <div className="touch-ui">
      <div
        className="joy-zone"
        onPointerDown={(e) => {
          if (pid.current !== null) return
          pid.current = e.pointerId
          origin.current = { x: e.clientX, y: e.clientY }
          try {
            e.currentTarget.setPointerCapture(e.pointerId)
          } catch {
            /* ignore */
          }
          move(e)
        }}
        onPointerMove={(e) => pid.current === e.pointerId && move(e)}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {joy ? (
          <div className="joy" style={{ left: joy.ox, top: joy.oy }}>
            <div className="joy-knob" style={{ transform: `translate(${joy.x * R * 0.75}px, ${joy.y * R * 0.75}px)` }} />
          </div>
        ) : (
          <div className="joy idle">
            <div className="joy-knob" />
          </div>
        )}
      </div>
      <div className="touch-btns">
        <button className={`tb dodge ${hud?.counter ? 'counter' : ''} ${hud && hud.dodge <= 0 ? 'cd' : ''}`} onPointerDown={press('dodge')}>
          <span>UNIK</span>
          <em className="pips">
            {Array.from({ length: hud?.dodgeMax ?? 2 }, (_, k) => (
              <i key={k} className={hud && k < hud.dodge ? 'on' : ''} />
            ))}
          </em>
        </button>
        <button className="tb jump" onPointerDown={press('jump')}>
          SKOK
        </button>
        <button
          className={`tb special ${spReady ? 'ready' : 'cd'}`}
          style={{ ['--p' as string]: `${spPct}%` }}
          onPointerDown={press('special')}
        >
          <span>{spReady || !hud ? 'SUPER' : hud.special.toFixed(1)}</span>
        </button>
        <button className={`tb attack ${hud?.counter ? 'counter' : ''}`} onPointerDown={press('attack')} onPointerUp={stopAttack} onPointerCancel={stopAttack} onPointerLeave={stopAttack}>
          ATAK
        </button>
      </div>
    </div>
  )
}
