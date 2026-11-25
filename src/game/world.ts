import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { CELL, CITY_HALF, GH, GW, LEVEL_H, MAP, cellChar, ci, cj, cx, cz, generateMap, rngFrom, setGrid, wall, type Box, type MapOpts } from './grid'
import { decorateCity } from './city'
import { decorateNature } from './nature'
import { createHazards, type Hazards } from './hazards'

// ─────────────────────────────────────────────────────────────
//  Świat poziomu: wspólny rdzeń (mapa, wysokości, platformy,
//  nawigacja wrogów, minimapa) + dekoracje i zagrożenia biomu.
// ─────────────────────────────────────────────────────────────

export type Biome = 'city' | 'forest' | 'arctic' | 'volcano' | 'neon'
export const BIOME_NAME: Record<Biome, string> = {
  city: 'Zrujnowane miasto',
  forest: 'Lewitujący las',
  arctic: 'Lodowe pustkowie',
  volcano: 'Wulkaniczne pustkowie',
  neon: 'Neonowa noc',
}
const ORDER: Biome[] = ['city', 'forest', 'arctic', 'volcano', 'neon']

/** Biom dla poziomu: najpierw po kolei wszystkie, potem losowo (bez powtórki z rzędu). */
export function biomeFor(level: number, seed: number): Biome {
  if (level <= ORDER.length) return ORDER[level - 1]
  const prev = biomeFor(level - 1, seed - 1)
  const pool = ORDER.filter((b) => b !== prev)
  return pool[Math.abs(seed) % pool.length]
}

export interface Env {
  background: number
  fog: [number, number, number]
  hemi: [number, number, number]
  ambient: [number, number]
  sun: [number, number]
}
export const ENV: Record<Biome, Env> = {
  city: { background: 0xbfc8c0, fog: [0xc4ccc2, 30, 110], hemi: [0xdcecff, 0x6f7a4a, 1.9], ambient: [0xfff6e8, 0.5], sun: [0xfff0d6, 2.6] },
  neon: { background: 0x0b0a1a, fog: [0x241645, 18, 90], hemi: [0x9a8cff, 0x2a1838, 1.5], ambient: [0x6a58d0, 0.7], sun: [0xb9c6ff, 1.1] },
  forest: { background: 0x9fd7e0, fog: [0x93d2cf, 28, 125], hemi: [0xbff6ff, 0x2f5a3a, 1.7], ambient: [0xd0fff0, 0.45], sun: [0xfff1c8, 2.3] },
  arctic: { background: 0xb9cbe0, fog: [0xc4d3e4, 22, 100], hemi: [0xdcebff, 0x6a7f99, 1.15], ambient: [0xcfe0ff, 0.3], sun: [0xffe6cc, 1.7] },
  volcano: { background: 0x2a1210, fog: [0x3a1812, 18, 90], hemi: [0xff9a6a, 0x200805, 1.1], ambient: [0xff6a3a, 0.35], sun: [0xffb070, 1.7] },
}

const MAP_OPTS: Record<Biome, MapOpts> = {
  city: {},
  neon: {},
  forest: { rooms: 2, erosion: 3, open: 0.6 },
  arctic: { rooms: 1, erosion: 3, open: 0.5 },
  volcano: { erosion: 2, open: 0.3 },
}

/** rodzaj podłoża komórki */
export const Ground = { Normal: 0, Water: 1, Lava: 2, Ice: 3 } as const
export type Ground = (typeof Ground)[keyof typeof Ground]

export const DECK_Y = 4.2

export interface Deck {
  cells: [number, number][]
  y: number
  center: THREE.Vector3
}
export interface Pad {
  i: number
  j: number
  pos: THREE.Vector3
  /** dokąd wyrzuca (środek platformy) */
  target: THREE.Vector3
}

/** Kontekst przekazywany dekoratorom biomu i zagrożeniom. */
export interface DecorCtx {
  scene: THREE.Scene
  group: THREE.Group
  T: <X extends { dispose(): void }>(x: X) => X
  rng: () => number
  accent: THREE.Color
  uTime: { value: number }
  biome: Biome
  walk: [number, number][]
  boxes: Box[]
  floorY: (i: number, j: number) => number
  ground: (i: number, j: number) => Ground
  decks: Deck[]
  pads: Pad[]
  bossCenter: THREE.Vector3
  /** otwiera/zamyka dziurę w podłożu (pękająca kra) */
  setHole: (i: number, j: number, open: boolean) => void
  isHole: (i: number, j: number) => boolean
}

export interface Decor {
  update(time: number, dt: number, player: THREE.Vector3, camera: THREE.Vector3): void
}

export interface City {
  biome: Biome
  name: string
  env: Env
  half: number
  boxes: Box[]
  start: THREE.Vector3
  bossCenter: THREE.Vector3
  heals: THREE.Vector3[]
  pads: Pad[]
  hazards: Hazards
  spawnPoint(from: THREE.Vector3, min: number, max: number): THREE.Vector3
  randomPoint(avoid: THREE.Vector3, minDist: number): THREE.Vector3
  inBossRoom(p: THREE.Vector3): boolean
  /** wysokość podłoża pod punktem dla ciała na wysokości y (platformy są jednostronne) */
  groundAt(x: number, z: number, y: number): number
  groundKind(x: number, z: number): Ground
  /** kierunek ruchu wroga do gracza (omija ściany) */
  steer(from: THREE.Vector3, out: THREE.Vector3): THREE.Vector3
  /** kierunek do najbliższej wyrzutni albo null */
  steerToPad(from: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 | null
  padAt(p: THREE.Vector3): Pad | null
  cameraDistance(target: THREE.Vector3, dir: THREE.Vector3, max: number): number
  wallAt(x: number, z: number): boolean
  update(time: number, dt: number, player: THREE.Vector3, camera: THREE.Vector3): void
  drawMinimap(ctx: CanvasRenderingContext2D, size: number, player: THREE.Vector3, facing: number, enemies: THREE.Vector3[], camYaw?: number, pickups?: THREE.Vector3[], portal?: THREE.Vector3 | null): void
  dispose(): void
}

const DIRS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

export function buildWorld(scene: THREE.Scene, accent: THREE.Color, level: number, seed: number): City {
  const biome = biomeFor(level, seed)
  setGrid(generateMap(level, seed, MAP_OPTS[biome]))
  const rng = rngFrom(seed ^ 0x5bd1e995)
  const disposables: { dispose(): void }[] = []
  const T = <X extends { dispose(): void }>(x: X) => (disposables.push(x), x)
  const group = new THREE.Group()
  scene.add(group)
  const uTime = { value: 0 }

  const N = GW * GH
  const id = (i: number, j: number) => j * GW + i
  const inMap = (i: number, j: number) => i >= 0 && j >= 0 && i < GW && j < GH
  const heights = new Float32Array(N)
  const kind = new Uint8Array(N)
  const deckY = new Float32Array(N)
  const holes = new Uint8Array(N)

  const walk: [number, number][] = []
  let start = new THREE.Vector3()
  const heals: THREE.Vector3[] = []
  const bossCells: [number, number][] = []
  for (let j = 0; j < GH; j++)
    for (let i = 0; i < GW; i++) {
      const c = MAP[j][i]
      if (c === '#') continue
      walk.push([i, j])
      if (c === 'S') start = new THREE.Vector3(cx(i), 0, cz(j))
      if (c === 'H') heals.push(new THREE.Vector3(cx(i), 0, cz(j)))
      if (c === 'B') bossCells.push([i, j])
    }
  const bossCenter = new THREE.Vector3()
  for (const [i, j] of bossCells) bossCenter.add(new THREE.Vector3(cx(i), 0, cz(j)))
  bossCenter.divideScalar(Math.max(1, bossCells.length))

  // ── warstwa terenu: wysokości, woda/lawa/lód, platformy ──
  const nearSpecial = (i: number, j: number) => {
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        const c = cellChar(i + di, j + dj)
        if (c === 'S' || c === 'B') return true
      }
    return false
  }
  // place jako spójne „plamy”
  const blobId = new Int32Array(N).fill(-1)
  const blobs: [number, number][][] = []
  for (const [i, j] of walk) {
    const c = MAP[j][i]
    if ((c !== 'P' && c !== 'H') || blobId[id(i, j)] >= 0) continue
    const b: [number, number][] = []
    const q: [number, number][] = [[i, j]]
    blobId[id(i, j)] = blobs.length
    while (q.length) {
      const [a, bj] = q.pop()!
      b.push([a, bj])
      for (const [di, dj] of DIRS) {
        const ni = a + di
        const nj = bj + dj
        const cc = cellChar(ni, nj)
        if ((cc !== 'P' && cc !== 'H') || blobId[id(ni, nj)] >= 0) continue
        blobId[id(ni, nj)] = blobs.length
        q.push([ni, nj])
      }
    }
    blobs.push(b)
  }
  const P = {
    city: { raise: 0.35, high: 0.3, special: 0, mesa: 0 },
    neon: { raise: 0.4, high: 0.35, special: 0, mesa: 0 },
    forest: { raise: 0.3, high: 0.3, special: 0.45, mesa: 0.07 },
    arctic: { raise: 0.4, high: 0.45, special: 0.5, mesa: 0.08 },
    volcano: { raise: 0.4, high: 0.45, special: 0.45, mesa: 0.08 },
  }[biome]
  const raisedBlobs = new Set<number>()
  blobs.forEach((b, k) => {
    if (b.some(([i, j]) => nearSpecial(i, j))) return
    if (rng() < P.raise) {
      raisedBlobs.add(k)
      for (const [i, j] of b) heights[id(i, j)] = LEVEL_H
    }
  })
  // drugie piętro: tylko gdy wszyscy sąsiedzi są ścianą albo co najmniej na 1. piętrze
  for (const k of raisedBlobs)
    for (const [i, j] of blobs[k]) {
      if (rng() > P.high) continue
      if (DIRS.every(([di, dj]) => wall(i + di, j + dj) || heights[id(i + di, j + dj)] >= LEVEL_H)) heights[id(i, j)] = LEVEL_H * 2
    }
  // pojedyncze uskoki na ścieżkach (biomy naturalne)
  if (P.mesa)
    for (const [i, j] of walk) if (MAP[j][i] === '.' && !nearSpecial(i, j) && rng() < P.mesa) heights[id(i, j)] = LEVEL_H

  // specjalne podłoże na niskich placach
  const passable = (i: number, j: number) => !wall(i, j) && kind[id(i, j)] !== Ground.Lava && !holes[id(i, j)]
  const connected = () => {
    const seen = new Uint8Array(N)
    const si = ci(start.x)
    const sj = cj(start.z)
    const q = [id(si, sj)]
    seen[q[0]] = 1
    let n = 1
    for (let h = 0; h < q.length; h++) {
      const c = q[h]
      const i = c % GW
      const j = (c / GW) | 0
      for (const [di, dj] of DIRS) {
        const ni = i + di
        const nj = j + dj
        if (!passable(ni, nj) || seen[id(ni, nj)]) continue
        seen[id(ni, nj)] = 1
        n++
        q.push(id(ni, nj))
      }
    }
    let total = 0
    for (const [i, j] of walk) if (passable(i, j)) total++
    return n === total
  }
  if (P.special) {
    const sp = biome === 'forest' ? Ground.Water : biome === 'volcano' ? Ground.Lava : Ground.Ice
    blobs.forEach((b, k) => {
      if (raisedBlobs.has(k) || rng() > P.special) return
      for (const [i, j] of b) {
        if (MAP[j][i] === 'H' || nearSpecial(i, j)) continue
        if (sp === Ground.Lava && rng() < 0.3) continue
        kind[id(i, j)] = sp
        if (sp === Ground.Lava && !connected()) kind[id(i, j)] = Ground.Normal
      }
    })
    // las: strumienie wzdłuż części ścieżek przy wodzie
    if (biome === 'forest')
      for (let pass = 0; pass < 2; pass++)
        for (const [i, j] of walk) {
          if (MAP[j][i] !== '.' || heights[id(i, j)] > 0 || nearSpecial(i, j)) continue
          if (DIRS.some(([di, dj]) => inMap(i + di, j + dj) && kind[id(i + di, j + dj)] === Ground.Water) && rng() < 0.3) kind[id(i, j)] = Ground.Water
        }
  }

  // ── platformy w powietrzu + wyrzutnie (las, miasta) ──────
  const decks: Deck[] = []
  const pads: Pad[] = []
  if (biome === 'forest' || biome === 'city' || biome === 'neon') {
    const want = biome === 'forest' ? 4 : 2
    const cand = blobs.filter((b, k) => !raisedBlobs.has(k) && b.length >= 4).sort(() => rng() - 0.5)
    for (const b of cand) {
      if (decks.length >= want) break
      // domino 2 komórek wewnątrz plamy
      const pick = b.filter(([i, j]) => MAP[j][i] !== 'H')
      let cells: [number, number][] | null = null
      for (let t = 0; t < 12 && !cells; t++) {
        const [i, j] = pick[Math.floor(rng() * pick.length)]
        const [di, dj] = DIRS[Math.floor(rng() * 4)]
        if (b.some(([a, c]) => a === i + di && c === j + dj)) cells = [[i, j], [i + di, j + dj]]
      }
      if (!cells) continue
      const isDeck = (i: number, j: number) => cells!.some(([a, c]) => a === i && c === j)
      // wyrzutnia: komórka plamy obok platformy (nie pod nią)
      const padCell = b.find(([i, j]) => !isDeck(i, j) && MAP[j][i] !== 'H' && kind[id(i, j)] !== Ground.Lava && cells!.some(([a, c]) => Math.abs(a - i) + Math.abs(c - j) === 1))
      if (!padCell) continue
      const y = DECK_Y + (biome === 'forest' ? Math.floor(rng() * 2) * LEVEL_H : 0)
      const center = new THREE.Vector3()
      for (const [i, j] of cells) {
        deckY[id(i, j)] = y
        center.add(new THREE.Vector3(cx(i), 0, cz(j)))
      }
      center.divideScalar(cells.length).setY(y)
      decks.push({ cells, y, center })
      const [pi, pj] = padCell
      // wyrzutnia stoi na skraju komórki od strony platformy
      const pos = new THREE.Vector3(cx(pi), heights[id(pi, pj)], cz(pj))
      pos.lerp(new THREE.Vector3(center.x, pos.y, center.z), 0.12)
      pads.push({ i: pi, j: pj, pos, target: center.clone() })
    }
  }

  for (const h of heals) h.y = heights[id(ci(h.x), cj(h.z))]

  // ── kolizje: ściany + podwyższenia ───────────────────────
  const boxes: Box[] = []
  for (let j = 0; j < GH; j++)
    for (let i = 0; i < GW; i++) {
      const b = { minX: cx(i) - CELL / 2, maxX: cx(i) + CELL / 2, minZ: cz(j) - CELL / 2, maxZ: cz(j) + CELL / 2 }
      if (wall(i, j)) boxes.push(b)
      else if (heights[id(i, j)] > 0) boxes.push({ ...b, top: heights[id(i, j)] })
    }

  const floorY = (i: number, j: number) => (inMap(i, j) ? heights[id(i, j)] : 0)
  const ground = (i: number, j: number) => (inMap(i, j) ? (kind[id(i, j)] as Ground) : Ground.Normal)

  // ── flow field (BFS do gracza) ───────────────────────────
  const dist = new Int32Array(N).fill(-1)
  let fieldCell = -1
  const rebuildField = (pi: number, pj: number) => {
    const c0 = id(pi, pj)
    if (c0 === fieldCell) return
    fieldCell = c0
    dist.fill(-1)
    if (!inMap(pi, pj) || wall(pi, pj)) return
    const queue = [c0]
    dist[c0] = 0
    for (let h = 0; h < queue.length; h++) {
      const c = queue[h]
      const i = c % GW
      const j = (c / GW) | 0
      for (const [dx, dz] of DIRS) {
        const ni = i + dx
        const nj = j + dz
        if (!passable(ni, nj)) continue
        const n = id(ni, nj)
        if (dist[n] >= 0) continue
        dist[n] = dist[c] + 1
        queue.push(n)
      }
    }
  }
  // pole do wyrzutni (statyczne, przeliczane gdy zmienią się dziury)
  const padDist = new Int32Array(N).fill(-1)
  const rebuildPadField = () => {
    padDist.fill(-1)
    const queue: number[] = []
    for (const p of pads) {
      padDist[id(p.i, p.j)] = 0
      queue.push(id(p.i, p.j))
    }
    for (let h = 0; h < queue.length; h++) {
      const c = queue[h]
      const i = c % GW
      const j = (c / GW) | 0
      for (const [dx, dz] of DIRS) {
        const ni = i + dx
        const nj = j + dz
        if (!passable(ni, nj)) continue
        const n = id(ni, nj)
        if (padDist[n] >= 0) continue
        padDist[n] = padDist[c] + 1
        queue.push(n)
      }
    }
  }
  rebuildPadField()

  const setHole = (i: number, j: number, open: boolean) => {
    if (!inMap(i, j)) return
    holes[id(i, j)] = open ? 1 : 0
    fieldCell = -1
    rebuildPadField()
  }
  const isHole = (i: number, j: number) => inMap(i, j) && holes[id(i, j)] === 1

  const target = new THREE.Vector3()
  const wallAt = (x: number, z: number) => wall(ci(x), cj(z))
  const losClear = (a: THREE.Vector3, b: THREE.Vector3, margin: number) => {
    const d = Math.hypot(b.x - a.x, b.z - a.z)
    const n = Math.ceil(d / 0.5)
    for (let k = 1; k < n; k++) {
      const t = k / n
      const x = a.x + (b.x - a.x) * t
      const z = a.z + (b.z - a.z) * t
      if (wallAt(x + margin, z) || wallAt(x - margin, z) || wallAt(x, z + margin) || wallAt(x, z - margin)) return false
      const c = id(ci(x), cj(z))
      if (kind[c] === Ground.Lava || holes[c]) return false
    }
    return true
  }
  const descend = (field: Int32Array, from: THREE.Vector3, out: THREE.Vector3) => {
    const i = ci(from.x)
    const j = cj(from.z)
    if (!inMap(i, j)) return null
    let best = field[id(i, j)]
    let bi = i
    let bj = j
    for (const [dx, dz] of DIRS) {
      const ni = i + dx
      const nj = j + dz
      const d = passable(ni, nj) ? field[id(ni, nj)] : -1
      if (d >= 0 && (best < 0 || d < best)) {
        best = d
        bi = ni
        bj = nj
      }
    }
    if (best < 0) return null
    out.set(cx(bi) - from.x, 0, cz(bj) - from.z)
    return out
  }

  // ── wysepki / podwyższenia: geometria (kolory biomu) ─────
  const PLAT: Record<Biome, [number, number]> = {
    city: [0x8a857c, 0x6a665f],
    neon: [0x3a3550, 0x24203a],
    forest: [0x5f9a3c, 0x6b5d4a],
    arctic: [0xf4f8fc, 0x9cc4e4],
    volcano: [0x3b302c, 0x241a17],
  }
  {
    const [topC, sideC] = PLAT[biome].map((c) => new THREE.Color(c))
    const geos: THREE.BufferGeometry[] = []
    const col = new THREE.Color()
    for (const [i, j] of walk) {
      const h = heights[id(i, j)]
      if (h <= 0) continue
      const g = new THREE.BoxGeometry(CELL, h, CELL)
      g.translate(cx(i), h / 2, cz(j))
      const nrm = g.getAttribute('normal') as THREE.BufferAttribute
      const pos = g.getAttribute('position') as THREE.BufferAttribute
      const cols = new Float32Array(nrm.count * 3)
      const tone = 0.9 + rng() * 0.2
      for (let k = 0; k < nrm.count; k++) {
        const top = nrm.getY(k) > 0.5
        col.copy(top ? topC : sideC).multiplyScalar(tone * (top ? 1 : 0.75 + (pos.getY(k) / h) * 0.3))
        cols.set([col.r, col.g, col.b], k * 3)
      }
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3))
      geos.push(g)
    }
    if (geos.length) {
      const merged = T(mergeGeometries(geos)!)
      geos.forEach((g) => g.dispose())
      const mesh = new THREE.Mesh(merged, T(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true })))
      mesh.castShadow = true
      mesh.receiveShadow = true
      group.add(mesh)
    }
  }

  const ctx: DecorCtx = { scene, group, T, rng, accent, uTime, biome, walk, boxes, floorY, ground, decks, pads, bossCenter, setHole, isHole }
  const decor: Decor = biome === 'city' || biome === 'neon' ? decorateCity(ctx, biome === 'neon' ? 'night' : 'day') : decorateNature(ctx)
  const hazards = createHazards(ctx)

  // ── minimapa ─────────────────────────────────────────────
  const MM: Record<Biome, { bg: string; wall: string; plaza: string; path: string }> = {
    city: { bg: 'rgba(30,36,24,0.85)', wall: 'rgba(150,140,120,0.75)', plaza: 'rgba(110,150,70,0.5)', path: 'rgba(255,255,255,0.08)' },
    neon: { bg: 'rgba(14,10,30,0.88)', wall: 'rgba(120,90,200,0.7)', plaza: 'rgba(255,60,200,0.25)', path: 'rgba(255,255,255,0.07)' },
    forest: { bg: 'rgba(16,40,34,0.85)', wall: 'rgba(110,130,100,0.75)', plaza: 'rgba(90,200,120,0.35)', path: 'rgba(255,255,255,0.08)' },
    arctic: { bg: 'rgba(40,54,70,0.85)', wall: 'rgba(200,225,245,0.8)', plaza: 'rgba(255,255,255,0.22)', path: 'rgba(255,255,255,0.1)' },
    volcano: { bg: 'rgba(30,10,8,0.88)', wall: 'rgba(90,70,64,0.85)', plaza: 'rgba(160,90,60,0.3)', path: 'rgba(255,255,255,0.07)' },
  }
  const mm = MM[biome]

  return {
    biome,
    name: BIOME_NAME[biome],
    env: ENV[biome],
    half: CITY_HALF,
    boxes,
    start,
    bossCenter,
    heals,
    pads,
    hazards,
    wallAt,
    inBossRoom: (p) => cellChar(ci(p.x), cj(p.z)) === 'B',
    groundAt(x, z, y) {
      const i = ci(x)
      const j = cj(z)
      if (!inMap(i, j)) return 0
      const c = id(i, j)
      if (deckY[c] > 0 && y >= deckY[c] - 0.35) return deckY[c]
      if (holes[c]) return -60
      return heights[c]
    },
    groundKind(x, z) {
      const i = ci(x)
      const j = cj(z)
      return inMap(i, j) ? (kind[id(i, j)] as Ground) : Ground.Normal
    },
    randomPoint(avoid, minDist) {
      const ok = ([i, j]: [number, number]) => MAP[j][i] !== 'B' && kind[id(i, j)] !== Ground.Lava && !holes[id(i, j)]
      const pool = walk.filter((c) => ok(c) && Math.hypot(cx(c[0]) - avoid.x, cz(c[1]) - avoid.z) >= minDist)
      const src = pool.length ? pool : walk.filter(ok)
      const [i, j] = src[Math.floor(Math.random() * src.length)]
      return new THREE.Vector3(cx(i) + (Math.random() - 0.5) * (CELL - 2), heights[id(i, j)], cz(j) + (Math.random() - 0.5) * (CELL - 2))
    },
    spawnPoint(from, min, max) {
      rebuildField(ci(from.x), cj(from.z))
      const cand = walk.filter(([i, j]) => {
        const d = dist[id(i, j)] * CELL
        return d >= min && d <= max
      })
      const pool = cand.length ? cand : walk
      const [i, j] = pool[Math.floor(Math.random() * pool.length)]
      return new THREE.Vector3(cx(i) + (Math.random() - 0.5) * (CELL - 2), heights[id(i, j)], cz(j) + (Math.random() - 0.5) * (CELL - 2))
    },
    steer(from, out) {
      // cel = gracz; w zasięgu wzroku → prosto, inaczej po flow field
      if (losClear(from, target, 0.45)) return out.copy(target).sub(from).setY(0).normalize()
      if (!descend(dist, from, out) || out.lengthSq() < 0.01) out.copy(target).sub(from).setY(0)
      return out.normalize()
    },
    steerToPad(from, out) {
      if (!pads.length) return null
      const i = ci(from.x)
      const j = cj(from.z)
      if (!inMap(i, j) || padDist[id(i, j)] < 0) return null
      if (padDist[id(i, j)] === 0) {
        const p = pads.find((p) => p.i === i && p.j === j)!
        return out.copy(p.pos).sub(from).setY(0).normalize()
      }
      if (!descend(padDist, from, out)) return null
      return out.normalize()
    },
    padAt(p) {
      for (const pad of pads) if (Math.hypot(pad.pos.x - p.x, pad.pos.z - p.z) < 0.95 && Math.abs(p.y - pad.pos.y) < 0.3) return pad
      return null
    },
    cameraDistance(t, dir, max) {
      const steps = Math.ceil(max / 0.15)
      for (let k = 1; k <= steps; k++) {
        const d = (k / steps) * max
        const x = t.x + dir.x * d
        const z = t.z + dir.z * d
        const y = t.y + dir.y * d
        const i = ci(x)
        const j = cj(z)
        const floor = inMap(i, j) ? heights[id(i, j)] : 0
        if (y < floor + 0.3) return Math.max(0.6, d - 0.3)
        if (wallAt(x + 0.3, z) || wallAt(x - 0.3, z) || wallAt(x, z + 0.3) || wallAt(x, z - 0.3)) return Math.max(0.6, d - 0.25)
      }
      return max
    },
    update(time, dt, player, camera) {
      uTime.value = time
      target.copy(player)
      rebuildField(ci(player.x), cj(player.z))
      decor.update(time, dt, player, camera)
    },
    drawMinimap(c2, size, player, facing, enemies, camYaw = 0, pickups = [], portal = null) {
      const R = 30
      const s = size / (R * 2)
      c2.clearRect(0, 0, size, size)
      c2.save()
      c2.beginPath()
      c2.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
      c2.clip()
      c2.fillStyle = mm.bg
      c2.fillRect(0, 0, size, size)
      c2.translate(size / 2, size / 2)
      c2.rotate(camYaw - Math.PI)
      c2.translate(-size / 2, -size / 2)
      const tx = (x: number) => (x - player.x) * s + size / 2
      const tz = (z: number) => (z - player.z) * s + size / 2
      for (let j = 0; j < GH; j++)
        for (let i = 0; i < GW; i++) {
          const ch = MAP[j][i]
          const c = id(i, j)
          const k = kind[c]
          c2.fillStyle =
            ch === '#'
              ? mm.wall
              : holes[c]
                ? 'rgba(0,0,0,0.8)'
                : ch === 'B'
                  ? 'rgba(255,62,90,0.35)'
                  : k === Ground.Water
                    ? 'rgba(70,170,255,0.55)'
                    : k === Ground.Lava
                      ? 'rgba(255,110,30,0.7)'
                      : k === Ground.Ice
                        ? 'rgba(190,235,255,0.45)'
                        : ch === 'P' || ch === 'H'
                          ? mm.plaza
                          : mm.path
          const x0 = tx(cx(i) - CELL / 2)
          const z0 = tz(cz(j) - CELL / 2)
          c2.fillRect(x0, z0, CELL * s + 0.5, CELL * s + 0.5)
          if (heights[c] > 0) {
            c2.fillStyle = `rgba(255,255,255,${heights[c] > LEVEL_H ? 0.28 : 0.15})`
            c2.fillRect(x0, z0, CELL * s + 0.5, CELL * s + 0.5)
          }
          if (deckY[c] > 0) {
            c2.strokeStyle = 'rgba(255,255,255,0.6)'
            c2.strokeRect(x0 + 1.5, z0 + 1.5, CELL * s - 3, CELL * s - 3)
          }
        }
      c2.fillStyle = '#ffd23f'
      for (const p of pads) {
        c2.beginPath()
        c2.arc(tx(p.pos.x), tz(p.pos.z), 2.5, 0, Math.PI * 2)
        c2.fill()
      }
      c2.fillStyle = '#5dff8a'
      for (const h of pickups) {
        c2.beginPath()
        c2.arc(tx(h.x), tz(h.z), 3.5, 0, Math.PI * 2)
        c2.fill()
      }
      if (portal) {
        c2.strokeStyle = '#8fd8ff'
        c2.lineWidth = 2.5
        c2.beginPath()
        c2.arc(tx(portal.x), tz(portal.z), 5 + Math.sin(performance.now() / 150) * 1.2, 0, Math.PI * 2)
        c2.stroke()
      }
      c2.fillStyle = '#ff3e5a'
      for (const e of enemies) {
        c2.beginPath()
        c2.arc(tx(e.x), tz(e.z), 3, 0, Math.PI * 2)
        c2.fill()
      }
      c2.translate(size / 2, size / 2)
      c2.rotate(-facing + Math.PI)
      c2.fillStyle = '#' + accent.getHexString()
      c2.beginPath()
      c2.moveTo(0, -7)
      c2.lineTo(5, 5)
      c2.lineTo(-5, 5)
      c2.closePath()
      c2.fill()
      c2.restore()
    },
    dispose() {
      scene.remove(group)
      disposables.forEach((d) => d.dispose())
    },
  }
}
