import { useId, useState } from 'react'
import { ELEMENT_COLORS, ELEMENT_GLYPH, RANK_COLOR, type Item } from '../data/roster'

function hash(s: string) {
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0
  return Math.abs(h)
}

const AUTO_EXTS = ['png', 'webp', 'jpg']

/** Folder in /public per item kind — mirrors public/<folder>/<rank>-rank/<name>.png */
const KIND_DIR: Record<Item['kind'], string> = {
  agent: 'agents',
  gear: 'w-engines',
  bangboo: 'bangboo',
}

/**
 * Candidate image URLs, in order:
 *  1. explicit `image` (full URL/path, or just a file name inside the rank folder)
 *  2. /<kind-dir>/<rank>-rank/<name>.<ext>
 *  3. /<kind-dir>/<rank>-rank/<id>.<ext>
 */
function imageCandidates(item: Item) {
  const base = `${import.meta.env.BASE_URL}${KIND_DIR[item.kind]}/${item.rank}-rank/`
  // encodeURI, not encodeURIComponent: Vite's dev server doesn't decode %26 (&) in /public paths
  const inFolder = (file: string) => base + encodeURI(file).replace(/[#?]/g, encodeURIComponent)
  const out: string[] = []
  if (item.image) out.push(/^(https?:|\/|data:)/.test(item.image) ? item.image : inFolder(item.image))
  for (const stem of new Set([item.name, item.id])) for (const ext of AUTO_EXTS) out.push(inFolder(`${stem}.${ext}`))
  return out
}

/** Procedural agent art (or a user-supplied image from /public). */
export function Portrait({ item, className = '' }: { item: Item; className?: string }) {
  const uid = useId().replace(/:/g, '')
  const candidates = imageCandidates(item)
  const [img, setImg] = useState({ id: item.id, idx: 0 })
  const imgIdx = img.id === item.id ? img.idx : 0
  const [c1, c2] = item.element ? ELEMENT_COLORS[item.element] : [RANK_COLOR.B, '#9fd8ff']
  const h = hash(item.id)
  const tilt = (h % 30) - 15
  const initial = item.name[0]

  if (imgIdx < candidates.length) {
    return (
      <div className={`portrait ${className}`} style={{ ['--c1' as string]: c1, ['--c2' as string]: c2 }}>
        <img key={candidates[imgIdx]} src={candidates[imgIdx]} alt={item.name} onError={() => setImg({ id: item.id, idx: imgIdx + 1 })} />
      </div>
    )
  }

  if (item.kind === 'gear') {
    return (
      <div className={`portrait ${className}`}>
        <svg viewBox="0 0 200 280" preserveAspectRatio="xMidYMid slice">
          <defs>
            <linearGradient id={`g${uid}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#0d1b2e" />
              <stop offset="1" stopColor="#123a5c" />
            </linearGradient>
          </defs>
          <rect width="200" height="280" fill={`url(#g${uid})`} />
          <g transform={`translate(100 140) rotate(${tilt})`} fill="none" stroke={c1} strokeWidth="3">
            <rect x="-38" y="-38" width="76" height="76" rx="8" />
            <circle r="20" />
            <path d="M-50 0 H-38 M38 0 H50 M0 -50 V-38 M0 38 V50" />
          </g>
          <text x="100" y="250" textAnchor="middle" fill={c2} opacity=".35" fontSize="14" fontFamily="monospace" letterSpacing="4">
            GEAR · {String(h % 999).padStart(3, '0')}
          </text>
        </svg>
      </div>
    )
  }

  const stripes = Array.from({ length: 9 }, (_, i) => i)
  return (
    <div className={`portrait ${className}`}>
      <svg viewBox="0 0 200 280" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id={`bg${uid}`} x1="0" y1="0" x2="0.4" y2="1">
            <stop offset="0" stopColor={c1} />
            <stop offset="1" stopColor="#0a0812" />
          </linearGradient>
          <linearGradient id={`sil${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#120f1d" />
            <stop offset="1" stopColor="#05040a" />
          </linearGradient>
          <pattern id={`dots${uid}`} width="8" height="8" patternUnits="userSpaceOnUse">
            <circle cx="4" cy="4" r="1.2" fill="#fff" opacity=".18" />
          </pattern>
        </defs>
        <rect width="200" height="280" fill={`url(#bg${uid})`} />
        <rect width="200" height="280" fill={`url(#dots${uid})`} />
        <g transform={`rotate(${tilt} 100 140)`} opacity=".35">
          {stripes.map((i) => (
            <rect key={i} x={-100 + i * 50} y="-60" width="14" height="420" fill={i % 2 ? c2 : '#000'} transform="skewX(-20)" />
          ))}
        </g>
        <text x="100" y="190" textAnchor="middle" fontSize="210" fontWeight="900" fill="#fff" opacity=".1" fontFamily="Impact, sans-serif">
          {initial}
        </text>
        {/* abstract silhouette */}
        <g fill={`url(#sil${uid})`} stroke={c2} strokeWidth="2">
          <path d={`M30 280 C 40 ${200 + (h % 20)}, 70 190, 100 188 C 130 190, 160 ${200 + (h % 15)}, 170 280 Z`} />
          <path d="M100 70 c 26 0 40 20 40 46 c 0 30 -18 54 -40 54 c -22 0 -40 -24 -40 -54 c 0 -26 14 -46 40 -46 Z" />
        </g>
        <path d={`M62 ${108 + (h % 6)} L138 ${100 + (h % 8)} L136 120 L64 126 Z`} fill={c2} opacity=".9" />
        <text x="172" y="40" textAnchor="middle" fontSize="30" fill="#fff">
          {item.element ? ELEMENT_GLYPH[item.element] : ''}
        </text>
      </svg>
    </div>
  )
}
