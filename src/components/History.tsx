import { useMemo, useState } from 'react'
import { BANNERS, byId, RANK_COLOR } from '../data/roster'
import type { SaveState } from '../lib/store'

const PAGE = 20

export function History({ save, onReset }: { save: SaveState; onReset: () => void }) {
  const [page, setPage] = useState(0)
  const [onlyHigh, setOnlyHigh] = useState(false)
  const list = useMemo(() => save.history.filter((h) => !onlyHigh || byId[h.id]?.rank !== 'B'), [save.history, onlyHigh])
  const pages = Math.max(1, Math.ceil(list.length / PAGE))
  const rows = list.slice(page * PAGE, page * PAGE + PAGE)

  const sPulls = save.history.filter((h) => byId[h.id]?.rank === 'S')
  const avgS = sPulls.length ? (sPulls.reduce((a, h) => a + h.pityAt, 0) / sPulls.length).toFixed(1) : '—'
  const won = sPulls.filter((h) => h.featured).length
  const lost = sPulls.filter((h) => h.lost5050).length

  return (
    <div className="page">
      <header className="page-head">
        <h2>SIGNAL LOG</h2>
        <div className="filters">
          <button className={`filter ${onlyHigh ? 'on' : ''}`} onClick={() => (setOnlyHigh(!onlyHigh), setPage(0))}>
            S/A only
          </button>
          <button
            className="filter danger"
            onClick={() => {
              if (confirm('Wyczyścić cały zapis (historia, kolekcja, pity)?')) onReset()
            }}
          >
            Reset save
          </button>
        </div>
      </header>

      <div className="stats">
        <Stat label="Total pulls" value={save.totalPulls} />
        <Stat label="Spent" value={`◈ ${save.spent.toLocaleString()}`} />
        <Stat label="S-ranks" value={sPulls.length} color={RANK_COLOR.S} />
        <Stat label="Avg S pity" value={avgS} />
        <Stat label="50/50 won / lost" value={`${won} / ${lost}`} />
      </div>

      <table className="history">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Name</th>
            <th>Channel</th>
            <th>Pity</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h) => {
            const it = byId[h.id]
            if (!it) return null
            return (
              <tr key={h.t} className={`rank-${it.rank}`}>
                <td style={{ color: RANK_COLOR[it.rank] }}>{it.rank}</td>
                <td style={{ color: it.rank === 'B' ? undefined : RANK_COLOR[it.rank] }}>
                  {it.name} {h.lost5050 && <span className="tag lost">50/50 lost</span>}
                </td>
                <td className="muted">{BANNERS.find((b) => b.id === h.banner)?.name}</td>
                <td>{h.pityAt || ''}</td>
                <td className="muted">{new Date(h.t).toLocaleString()}</td>
              </tr>
            )
          })}
          {!rows.length && (
            <tr>
              <td colSpan={5} className="muted center">
                Brak sygnałów. Idź losować.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="pager">
        <button disabled={page === 0} onClick={() => setPage(page - 1)}>
          ◂
        </button>
        <span>
          {page + 1} / {pages}
        </span>
        <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
          ▸
        </button>
      </div>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div className="stat">
      <small>{label}</small>
      <strong style={{ color }}>{value}</strong>
    </div>
  )
}
