import * as THREE from 'three'

// ─────────────────────────────────────────────────────────────
//  Siatka poziomu (wspólna dla wszystkich biomów). Znaki mapy:
//    '#' ściana   '.' ulica/ścieżka   'P' plac   'S' start
//    'B' arena bossa   'H' apteczka
//  Wysokości komórek, platformy, woda itd. są w osobnej warstwie (world.ts).
// ─────────────────────────────────────────────────────────────

export const CELL = 6
/** wysokość jednego „piętra” terenu (da się na nie wskoczyć) */
export const LEVEL_H = 1.4

export let MAP: string[] = []
export let GW = 0
export let GH = 0
/** połowa boku mapy w metrach (live binding) */
export let CITY_HALF = 0

export function setGrid(map: string[]) {
  MAP = map
  GW = map[0].length
  GH = map.length
  CITY_HALF = (GW * CELL) / 2
}

export const wall = (i: number, j: number) => i < 0 || j < 0 || i >= GW || j >= GH || MAP[j][i] === '#'
export const cx = (i: number) => (i - GW / 2 + 0.5) * CELL
export const cz = (j: number) => (j - GH / 2 + 0.5) * CELL
export const ci = (x: number) => Math.floor(x / CELL + GW / 2)
export const cj = (z: number) => Math.floor(z / CELL + GH / 2)
export const cellChar = (i: number, j: number) => (i < 0 || j < 0 || i >= GW || j >= GH ? '#' : MAP[j][i])

export interface MapOpts {
  /** dodatkowe place */
  rooms?: number
  /** liczba przejść „otwierania” cienkich ścian */
  erosion?: number
  /** 0..1 — jak agresywnie burzyć ściany */
  open?: number
}

export interface Box {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  /** wysokość wierzchu — da się na nią wejść/wskoczyć; brak = nieskończenie wysoka ściana */
  top?: number
}

/** Wypycha okrąg (p, r) z prostokątów; prostokąty niższe niż stopy (p.y) + `step` są pomijane. */
export function pushOutOfBoxes(p: THREE.Vector3, r: number, boxes: Box[], step = 0.5) {
  let hit = false
  for (const b of boxes) {
    if (p.x < b.minX - r || p.x > b.maxX + r || p.z < b.minZ - r || p.z > b.maxZ + r) continue
    if (b.top !== undefined && p.y >= b.top - step) continue
    const qx = THREE.MathUtils.clamp(p.x, b.minX, b.maxX)
    const qz = THREE.MathUtils.clamp(p.z, b.minZ, b.maxZ)
    const dx = p.x - qx
    const dz = p.z - qz
    const d2 = dx * dx + dz * dz
    if (d2 >= r * r) continue
    hit = true
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2)
      p.x = qx + (dx / d) * r
      p.z = qz + (dz / d) * r
    } else {
      const l = p.x - b.minX
      const rr = b.maxX - p.x
      const t = p.z - b.minZ
      const bt = b.maxZ - p.z
      const m = Math.min(l, rr, t, bt)
      if (m === l) p.x = b.minX - r
      else if (m === rr) p.x = b.maxX + r
      else if (m === t) p.z = b.minZ - r
      else p.z = b.maxZ + r
    }
  }
  return hit
}

export function rngFrom(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat = true) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d')!)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 4
  return t
}

/** Beton z wybitymi oknami, zaciekami, pęknięciami i mchem przy dole. */
export /** Skleja kilka geometrii (z tymi samymi atrybutami) w jedną. */
function mergeGeos(geos: THREE.BufferGeometry[]) {
  const out = new THREE.BufferGeometry()
  for (const name of ['position', 'normal', 'uv']) {
    const parts = geos.map((g) => g.getAttribute(name) as THREE.BufferAttribute)
    const total = parts.reduce((s, p) => s + p.array.length, 0)
    const arr = new Float32Array(total)
    let o = 0
    for (const p of parts) {
      arr.set(p.array as Float32Array, o)
      o += p.array.length
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, parts[0].itemSize))
  }
  const idx: number[] = []
  let base = 0
  for (const g of geos) {
    const ix = g.getIndex()
    if (ix) for (let k = 0; k < ix.count; k++) idx.push(ix.getX(k) + base)
    base += g.getAttribute('position').count
  }
  out.setIndex(idx)
  return out
}

/** Generuje nową, otwartą mapę: place połączone szerokimi ulicami, drzewo dróg zbiega się w arenie bossa. */
export function generateMap(level: number, seed: number, opts: MapOpts = {}): string[] {
  const rng = rngFrom(seed)
  const ri = (a: number, b: number) => a + Math.floor(rng() * (b - a + 1))
  const N = 21 + 2 * Math.min(level - 1, 3)
  const g: string[][] = Array.from({ length: N }, () => Array(N).fill('#'))
  const inside = (i: number, j: number) => i > 0 && j > 0 && i < N - 1 && j < N - 1
  const set = (i: number, j: number, c: string, over = false) => {
    if (!inside(i, j)) return
    if (over || g[j][i] === '#') g[j][i] = c
  }

  // arena bossa (5×5) w losowej ćwiartce, z dala od środka
  const BS = 5
  const qx = rng() < 0.5
  const qz = rng() < 0.5
  const bx = qx ? ri(2, 4) : N - 2 - BS - ri(0, 2)
  const bz = qz ? ri(2, 4) : N - 2 - BS - ri(0, 2)
  for (let j = bz; j < bz + BS; j++) for (let i = bx; i < bx + BS; i++) g[j][i] = 'B'
  const bossC: [number, number] = [bx + 2, bz + 2]
  const nearBoss = (i: number, j: number) => i >= bx - 1 && i <= bx + BS && j >= bz - 1 && j <= bz + BS

  // place (mogą na siebie zachodzić → nieregularne, otwarte przestrzenie)
  const rooms: [number, number][] = []
  const want = Math.min(16, 10 + level + (opts.rooms ?? 0))
  for (let tries = 0; tries < 600 && rooms.length < want; tries++) {
    const w = ri(2, 4)
    const h = ri(2, 4)
    const x = ri(1, N - 1 - w)
    const z = ri(1, N - 1 - h)
    let bad = false
    for (let j = z - 1; j <= z + h && !bad; j++) for (let i = x - 1; i <= x + w && !bad; i++) if (nearBoss(i, j)) bad = true
    if (bad) continue
    const c: [number, number] = [x + (w >> 1), z + (h >> 1)]
    if (rooms.some(([a, b]) => Math.abs(a - c[0]) + Math.abs(b - c[1]) < 4)) continue
    for (let j = z; j < z + h; j++) for (let i = x; i < x + w; i++) set(i, j, 'P')
    rooms.push(c)
  }

  // ulica w kształcie L (szerokość 1–2) między dwoma punktami
  const road = (a: [number, number], b: [number, number], wide: boolean) => {
    let [i, j] = a
    const hFirst = rng() < 0.5
    const step = (axis: 'x' | 'z') => {
      if (axis === 'x') while (i !== b[0]) {
        set(i, j, '.')
        if (wide) set(i, j + 1, '.')
        i += Math.sign(b[0] - i)
      }
      else while (j !== b[1]) {
        set(i, j, '.')
        if (wide) set(i + 1, j, '.')
        j += Math.sign(b[1] - j)
      }
    }
    step(hFirst ? 'x' : 'z')
    step(hFirst ? 'z' : 'x')
    set(i, j, '.')
  }

  // drzewo dróg zakorzenione w arenie: każdy plac łączy się z najbliższym już połączonym
  // węzłem, który leży bliżej bossa → idąc „w górę” drzewa zawsze dojdziesz do areny
  const md = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])
  const connected: [number, number][] = [bossC]
  const order = [...rooms].sort((a, b) => md(a, bossC) - md(b, bossC))
  for (const r of order) {
    let best = connected[0]
    for (const c of connected) if (md(c, r) < md(best, r)) best = c
    road(r, best, rng() < 0.8)
    connected.push(r)
  }
  // kilka dodatkowych przejść (pętle) — mniej ślepych zaułków
  for (let k = 0; k < 2 + (level >> 1); k++) {
    const a = rooms[Math.floor(rng() * rooms.length)]
    const b = rooms[Math.floor(rng() * rooms.length)]
    if (a && b && a !== b) road(a, b, false)
  }

  // otwieranie: cienkie ściany między przestrzeniami zamieniamy w gruzowiska/ulice
  const open = (i: number, j: number) => inside(i, j) && g[j][i] !== '#'
  for (let pass = 0; pass < (opts.erosion ?? 2); pass++) {
    const kill: [number, number][] = []
    for (let j = 1; j < N - 1; j++)
      for (let i = 1; i < N - 1; i++) {
        if (g[j][i] !== '#' || nearBoss(i, j)) continue
        let n = 0
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if ((di || dj) && open(i + di, j + dj)) n++
        const thin = (open(i - 1, j) && open(i + 1, j)) || (open(i, j - 1) && open(i, j + 1))
        const o = opts.open ?? 0
        if (n >= 6 - (o > 0.5 ? 1 : 0) || (thin && rng() < 0.35 + o * 0.3) || (n >= 4 && rng() < 0.18 + o * 0.2)) kill.push([i, j])
      }
    for (const [i, j] of kill) g[j][i] = '.'
  }

  // spójność: zostawiamy tylko to, co osiągalne z areny
  const flood = (from: [number, number]) => {
    const d = new Int32Array(N * N).fill(-1)
    const q = [from[1] * N + from[0]]
    d[q[0]] = 0
    for (let h = 0; h < q.length; h++) {
      const c = q[h]
      const i = c % N
      const j = (c / N) | 0
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const ni = i + di
        const nj = j + dj
        if (!open(ni, nj) || d[nj * N + ni] >= 0) continue
        d[nj * N + ni] = d[c] + 1
        q.push(nj * N + ni)
      }
    }
    return d
  }
  const dB = flood(bossC)
  const cells: [number, number, number][] = []
  for (let j = 1; j < N - 1; j++)
    for (let i = 1; i < N - 1; i++) {
      if (g[j][i] === '#') continue
      if (dB[j * N + i] < 0) g[j][i] = '#'
      else if (g[j][i] !== 'B') cells.push([i, j, dB[j * N + i]])
    }

  // start: jedno z najdalszych od areny miejsc
  cells.sort((a, b) => b[2] - a[2])
  const far = cells.slice(0, Math.max(1, Math.floor(cells.length * 0.08)))
  const [si, sj] = far[Math.floor(rng() * far.length)]
  g[sj][si] = 'S'
  const maxD = cells[0][2]

  // apteczki: rozrzucone po drodze (na placach jeśli się da) + jedna przed areną
  const heals: [number, number][] = []
  const tryHeal = (pool: [number, number, number][]) => {
    for (let t = 0; t < 40 && pool.length; t++) {
      const [i, j] = pool[Math.floor(rng() * pool.length)]
      if (g[j][i] === 'S' || g[j][i] === 'H') continue
      if (heals.some(([a, b]) => Math.abs(a - i) + Math.abs(b - j) < 5)) continue
      if (Math.abs(i - si) + Math.abs(j - sj) < 3) continue
      g[j][i] = 'H'
      heals.push([i, j])
      return
    }
  }
  const mid = cells.filter(([, , d]) => d > 4 && d < maxD - 2)
  const midPlaza = mid.filter(([i, j]) => g[j][i] === 'P')
  const nHeals = 3 + Math.min(2, level >> 1)
  for (let k = 0; k < nHeals; k++) tryHeal(midPlaza.length > k * 2 ? midPlaza : mid)
  tryHeal(cells.filter(([, , d]) => d >= 2 && d <= 4))

  return g.map((r) => r.join(''))
}

