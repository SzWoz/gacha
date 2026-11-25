import * as THREE from 'three'

// ─────────────────────────────────────────────────────────────
//  Post-apo miasto za dnia: ulice i place między zrujnowanymi,
//  zarośniętymi budynkami. Mapa generowana proceduralnie co poziom:
//    '#' budynek (ściana)   '.' ulica   'P' plac   'S' start
//    'B' arena bossa         'H' apteczka
//  Wszystkie drogi (drzewo połączeń) prowadzą do areny bossa.
//  Wrogowie chodzą po siatce (flow field z BFS od gracza).
// ─────────────────────────────────────────────────────────────

let MAP: string[] = []
export const CELL = 6
let GW = 0
let GH = 0
/** połowa boku mapy w metrach — zmienia się razem z mapą (live binding) */
export let CITY_HALF = 0

/** Generuje nową, otwartą mapę: place połączone szerokimi ulicami, drzewo dróg zbiega się w arenie bossa. */
export function generateMap(level: number, seed: number): string[] {
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
  const want = Math.min(14, 10 + level)
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
  for (let pass = 0; pass < 2; pass++) {
    const kill: [number, number][] = []
    for (let j = 1; j < N - 1; j++)
      for (let i = 1; i < N - 1; i++) {
        if (g[j][i] !== '#' || nearBoss(i, j)) continue
        let n = 0
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if ((di || dj) && open(i + di, j + dj)) n++
        const thin = (open(i - 1, j) && open(i + 1, j)) || (open(i, j - 1) && open(i, j + 1))
        if (n >= 6 || (thin && rng() < 0.35) || (n >= 4 && rng() < 0.18)) kill.push([i, j])
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

export interface Box {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export interface City {
  boxes: Box[]
  start: THREE.Vector3
  spawnPoint(from: THREE.Vector3, min: number, max: number): THREE.Vector3
  /** losowy punkt na ulicy/placu (poza areną bossa), co najmniej `minDist` od `avoid` */
  randomPoint(avoid: THREE.Vector3, minDist: number): THREE.Vector3
  /** środek areny bossa */
  bossCenter: THREE.Vector3
  /** czy punkt leży w arenie bossa */
  inBossRoom(p: THREE.Vector3): boolean
  /** miejsca apteczek */
  heals: THREE.Vector3[]
  /** kierunek ruchu wroga do celu (omija ściany) */
  steer(from: THREE.Vector3, out: THREE.Vector3): THREE.Vector3
  /** jak daleko kamera może odjechać od `target` w kierunku `dir`, zanim wejdzie w ścianę */
  cameraDistance(target: THREE.Vector3, dir: THREE.Vector3, max: number): number
  wallAt(x: number, z: number): boolean
  update(time: number, dt: number, player: THREE.Vector3, camera: THREE.Vector3): void
  drawMinimap(ctx: CanvasRenderingContext2D, size: number, player: THREE.Vector3, facing: number, enemies: THREE.Vector3[], camYaw?: number, pickups?: THREE.Vector3[]): void
  dispose(): void
}

// ── siatka ──────────────────────────────────────────────────
const wall = (i: number, j: number) => i < 0 || j < 0 || i >= GW || j >= GH || MAP[j][i] === '#'
const cx = (i: number) => (i - GW / 2 + 0.5) * CELL
const cz = (j: number) => (j - GH / 2 + 0.5) * CELL
const ci = (x: number) => Math.floor(x / CELL + GW / 2)
const cj = (z: number) => Math.floor(z / CELL + GH / 2)

function rngFrom(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── tekstury proceduralne ───────────────────────────────────
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat = true) {
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
function facadeTex(rng: () => number, base: string) {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = base
    g.fillRect(0, 0, 256, 256)
    // szum betonu
    for (let i = 0; i < 1800; i++) {
      g.fillStyle = `rgba(${rng() < 0.5 ? '0,0,0' : '255,255,255'},${rng() * 0.06})`
      g.fillRect(rng() * 256, rng() * 256, 2 + rng() * 5, 2 + rng() * 5)
    }
    // okna (1 piętro = 128px wysokości tekstury → 3 m)
    for (let y = 0; y < 2; y++)
      for (let x = 0; x < 3; x++) {
        const wx = x * 85 + 16
        const wy = y * 128 + 30
        const r = rng()
        g.fillStyle = r < 0.15 ? '#3a3d42' : '#0d0f12' // zabite deską albo czarna dziura
        g.fillRect(wx, wy, 52, 62)
        if (r > 0.15 && rng() < 0.5) {
          // resztki szyby
          g.fillStyle = 'rgba(160,190,200,0.35)'
          g.beginPath()
          g.moveTo(wx, wy)
          g.lineTo(wx + 20 + rng() * 30, wy)
          g.lineTo(wx, wy + 20 + rng() * 30)
          g.fill()
        }
        if (r < 0.15) {
          g.fillStyle = '#5a4a36'
          for (let k = 0; k < 3; k++) g.fillRect(wx - 4, wy + 8 + k * 20, 60, 8)
        }
        g.strokeStyle = 'rgba(0,0,0,0.5)'
        g.lineWidth = 4
        g.strokeRect(wx - 2, wy - 2, 56, 66)
      }
    // gzymsy pięter
    g.fillStyle = 'rgba(0,0,0,0.18)'
    g.fillRect(0, 124, 256, 6)
    g.fillRect(0, 252, 256, 4)
    // zacieki
    for (let i = 0; i < 9; i++) {
      const x = rng() * 256
      const grd = g.createLinearGradient(0, 0, 0, 256)
      grd.addColorStop(0, 'rgba(40,30,20,0.35)')
      grd.addColorStop(1, 'rgba(40,30,20,0)')
      g.fillStyle = grd
      g.fillRect(x, 0, 3 + rng() * 8, 80 + rng() * 170)
    }
    // pęknięcia
    g.strokeStyle = 'rgba(20,20,20,0.5)'
    g.lineWidth = 1.5
    for (let i = 0; i < 5; i++) {
      let x = rng() * 256
      let y = rng() * 256
      g.beginPath()
      g.moveTo(x, y)
      for (let k = 0; k < 6; k++) {
        x += (rng() - 0.5) * 30
        y += rng() * 25
        g.lineTo(x, y)
      }
      g.stroke()
    }
  })
}

/** Liście bluszczu z przezroczystością. */
function ivyTex(rng: () => number) {
  return canvasTex(
    128,
    256,
    (g) => {
      g.clearRect(0, 0, 128, 256)
      for (let i = 0; i < 520; i++) {
        const y = rng() ** 0.7 * 256
        const spread = 20 + (y / 256) * 50
        const x = 64 + (rng() - 0.5) * 2 * spread
        const s = 4 + rng() * 7
        const l = 22 + rng() * 22
        g.fillStyle = `hsl(${85 + rng() * 40}, ${40 + rng() * 25}%, ${l}%)`
        g.beginPath()
        g.ellipse(x, y, s, s * 0.6, rng() * Math.PI, 0, Math.PI * 2)
        g.fill()
      }
    },
    false,
  )
}

function grassBladeTex() {
  return canvasTex(
    64,
    128,
    (g) => {
      g.clearRect(0, 0, 64, 128)
      for (let i = 0; i < 14; i++) {
        const x = 8 + Math.random() * 48
        const h = 60 + Math.random() * 66
        const lean = (Math.random() - 0.5) * 24
        const grd = g.createLinearGradient(0, 128, 0, 128 - h)
        grd.addColorStop(0, '#3d5a22')
        grd.addColorStop(1, `hsl(${70 + Math.random() * 30}, 50%, ${45 + Math.random() * 15}%)`)
        g.fillStyle = grd
        g.beginPath()
        g.moveTo(x - 3, 128)
        g.quadraticCurveTo(x + lean * 0.5, 128 - h * 0.6, x + lean, 128 - h)
        g.quadraticCurveTo(x + lean * 0.5 + 2, 128 - h * 0.6, x + 3, 128)
        g.fill()
      }
    },
    false,
  )
}

function neonTex(text: string) {
  return canvasTex(
    512,
    128,
    (g) => {
      g.fillStyle = 'rgba(20,18,24,0.9)'
      g.fillRect(0, 0, 512, 128)
      g.font = 'bold 76px Impact, sans-serif'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.shadowColor = '#ff3ea5'
      g.shadowBlur = 20
      g.fillStyle = '#ff7ac4'
      g.fillText(text, 256, 68)
    },
    false,
  )
}

/** Wstrzykuje kołysanie na wietrze do materiału (wierzchołki wyżej ruszają się mocniej). */
function addWind(mat: THREE.Material, uTime: { value: number }, strength: number, heightScale: number) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec4 wp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          wp = modelMatrix * wp;
          float h = clamp(position.y * ${heightScale.toFixed(3)}, 0.0, 1.0);
          float gust = 0.6 + 0.4 * sin(uTime * 0.7 + wp.x * 0.05);
          float w = sin(uTime * 2.2 + wp.x * 0.35 + wp.z * 0.27) * 0.6 + sin(uTime * 3.7 + wp.z * 0.5) * 0.4;
          transformed.x += w * h * h * ${strength.toFixed(3)} * gust;
          transformed.z += cos(uTime * 1.9 + wp.x * 0.3) * h * h * ${(strength * 0.5).toFixed(3)} * gust;
        }`,
      )
  }
  mat.customProgramCacheKey = () => `wind-${strength}-${heightScale}`
}

// ── budowa ──────────────────────────────────────────────────

export function buildCity(scene: THREE.Scene, accent: THREE.Color, level = 1, seed = 2077): City {
  MAP = generateMap(level, seed)
  GW = MAP[0].length
  GH = MAP.length
  CITY_HALF = (GW * CELL) / 2
  const rng = rngFrom(seed ^ 0x5bd1e995)
  const disposables: { dispose(): void }[] = []
  const group = new THREE.Group()
  scene.add(group)
  const uTime = { value: 0 }
  const boxes: Box[] = []
  const walk: [number, number][] = []
  let start = new THREE.Vector3()
  const heals: THREE.Vector3[] = []
  const bossCells: [number, number][] = []
  for (let j = 0; j < GH; j++)
    for (let i = 0; i < GW; i++) {
      if (MAP[j][i] === '#') boxes.push({ minX: cx(i) - CELL / 2, maxX: cx(i) + CELL / 2, minZ: cz(j) - CELL / 2, maxZ: cz(j) + CELL / 2 })
      else walk.push([i, j])
      if (MAP[j][i] === 'S') start = new THREE.Vector3(cx(i), 0, cz(j))
      if (MAP[j][i] === 'H') heals.push(new THREE.Vector3(cx(i), 0, cz(j)))
      if (MAP[j][i] === 'B') bossCells.push([i, j])
    }
  const bossCenter = new THREE.Vector3()
  for (const [i, j] of bossCells) bossCenter.add(new THREE.Vector3(cx(i), 0, cz(j)))
  bossCenter.divideScalar(Math.max(1, bossCells.length))
  const T = <X extends { dispose(): void }>(x: X) => (disposables.push(x), x)

  // ── niebo z chmurami + słońce ────────────────────────────
  const skyMat = T(
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uTime },
      vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `
        uniform float uTime; varying vec3 vD;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
          return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*n(p); p*=2.1; a*=.5; } return s; }
        void main(){
          float y = clamp(vD.y, -0.1, 1.);
          vec3 top = vec3(.36,.58,.86), hor = vec3(.84,.86,.8);
          vec3 col = mix(hor, top, pow(max(y,0.), .55));
          vec3 sunDir = normalize(vec3(.45,.55,-.7));
          float sd = max(dot(vD, sunDir), 0.);
          col += vec3(1.,.9,.7) * (pow(sd, 900.)*4. + pow(sd, 12.)*.25);
          if (y > 0.) {
            vec2 uv = vD.xz / (y + .15) * 1.4 + vec2(uTime*.012, uTime*.004);
            float c = smoothstep(.48, .78, fbm(uv));
            col = mix(col, vec3(1.) * (.85 + .15*fbm(uv*2.+3.)), c * .85 * smoothstep(0., .25, y));
          }
          gl_FragColor = vec4(col, 1.);
        }`,
    }),
  )
  const sky = new THREE.Mesh(T(new THREE.SphereGeometry(180, 32, 16)), skyMat)
  group.add(sky)

  // ── ziemia: popękany asfalt + trawa + ziemia ─────────────
  const groundMat = T(
    new THREE.ShaderMaterial({
      uniforms: { uCell: { value: CELL } },
      vertexShader: `varying vec2 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xz; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `
        uniform float uCell; varying vec2 vW;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
          return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*n(p); p*=2.03; a*=.5; } return s; }
        vec2 vor(vec2 p){ vec2 i=floor(p), f=fract(p); float d1=8., d2=8.;
          for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ vec2 g=vec2(x,y); vec2 o=vec2(h(i+g), h(i+g+17.)); float d=length(g+o-f);
            if(d<d1){ d2=d1; d1=d; } else if(d<d2) d2=d; }
          return vec2(d1, d2); }
        void main(){
          float tone = fbm(vW*.35);
          vec3 asph = mix(vec3(.42,.41,.4), vec3(.52,.5,.47), tone);
          vec2 v = vor(vW*.45);
          float crack = 1. - smoothstep(0., .06, v.y - v.x);
          float grass = smoothstep(.5, .68, fbm(vW*.18 + 4.)) + crack * .6;
          vec3 g1 = mix(vec3(.36,.5,.2), vec3(.52,.62,.28), fbm(vW*1.3));
          vec3 col = mix(asph, vec3(.12,.12,.12), crack*.8);
          col = mix(col, g1, clamp(grass, 0., 1.) * .85);
          float dirt = smoothstep(.62, .8, fbm(vW*.11 + 9.));
          col = mix(col, vec3(.38,.31,.22), dirt*.6);
          // resztki pasów
          float lane = step(abs(fract(vW.x/uCell)-.5), .012) * step(.5, fract(vW.y/3.)) * (1.-grass) * step(.45, n(vW*.2));
          col = mix(col, vec3(.8,.74,.5), lane*.5);
          gl_FragColor = vec4(col, 1.);
          #include <fog_fragment>
        }`,
      fog: true,
    }),
  )
  // fog w ShaderMaterial wymaga uniformów fog
  Object.assign(groundMat.uniforms, THREE.UniformsUtils.clone(THREE.UniformsLib.fog))
  groundMat.vertexShader = `#include <fog_pars_vertex>\n` + groundMat.vertexShader.replace('gl_Position = projectionMatrix*viewMatrix*w;', 'vec4 mvPosition = viewMatrix*w; gl_Position = projectionMatrix*mvPosition;\n#include <fog_vertex>\n')
  groundMat.fragmentShader = `#include <fog_pars_fragment>\n` + groundMat.fragmentShader
  const ground = new THREE.Mesh(T(new THREE.PlaneGeometry(CITY_HALF * 4, CITY_HALF * 4)), groundMat)
  ground.rotation.x = -Math.PI / 2
  group.add(ground)
  const shadowGround = new THREE.Mesh(T(new THREE.PlaneGeometry(CITY_HALF * 2.4, CITY_HALF * 2.4)), T(new THREE.ShadowMaterial({ opacity: 0.38 })))
  shadowGround.rotation.x = -Math.PI / 2
  shadowGround.position.y = 0.01
  shadowGround.receiveShadow = true
  group.add(shadowGround)

  // ── zrujnowane budynki ───────────────────────────────────
  const bases = ['#8d8a82', '#9a8f7e', '#7f8584', '#a39b8c', '#857a6e', '#8f9488']
  const facadeMats = bases.map((b) => {
    const tex = T(facadeTex(rng, b))
    return T(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 }))
  })
  const slabMat = T(new THREE.MeshStandardMaterial({ color: 0x77736b, roughness: 1 }))
  const rebarMat = T(new THREE.MeshStandardMaterial({ color: 0x5a3b28, roughness: 0.8, metalness: 0.5 }))
  const mossMat = T(new THREE.MeshStandardMaterial({ color: 0x4d6b2a, roughness: 1 }))
  const ivyMat = T(new THREE.MeshStandardMaterial({ map: T(ivyTex(rng)), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.9 }))
  addWind(ivyMat, uTime, 0.08, 0.15)
  const rebarGeo = T(new THREE.CylinderGeometry(0.03, 0.03, 1, 4))
  rebarGeo.translate(0, 0.5, 0)

  const scaleUV = (geo: THREE.BoxGeometry, w: number, h: number, d: number) => {
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute
    const dims: [number, number][] = [
      [d, h],
      [d, h],
      [w, d],
      [w, d],
      [w, h],
      [w, h],
    ]
    for (let f = 0; f < 6; f++)
      for (let i = 0; i < 4; i++) {
        const k = f * 4 + i
        uv.setXY(k, uv.getX(k) * (dims[f][0] / 6), uv.getY(k) * (dims[f][1] / 6))
      }
  }
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, uv = true) => {
    const geo = T(new THREE.BoxGeometry(w, h, d))
    if (uv) scaleUV(geo, w, h, d)
    const m = new THREE.Mesh(geo, mat)
    m.position.set(x, y + h / 2, z)
    m.castShadow = true
    m.receiveShadow = true
    group.add(m)
    return m
  }

  /** odległość (Czebyszew, max 3) do najbliższej komórki chodnika */
  const openWithin = (i: number, j: number) => {
    for (let r = 1; r <= 2; r++)
      for (let dj = -r; dj <= r; dj++)
        for (let di = -r; di <= r; di++) if (!wall(i + di, j + dj) && i + di >= 0 && j + dj >= 0 && i + di < GW && j + dj < GH) return r
    return 3
  }
  const ivyGeo = T(new THREE.PlaneGeometry(2.2, 1))
  ivyGeo.translate(0, -0.5, 0) // zaczepione u góry, zwisa w dół
  for (let j = 0; j < GH; j++)
    for (let i = 0; i < GW; i++) {
      if (!wall(i, j)) continue
      const x = cx(i)
      const z = cz(j)
      // głębokie wnętrze kwartału: niewidoczne z ulicy — pełny budynek tylko przy ulicy,
      // drugi rząd jako prosta bryła (linia dachów), dalej nic
      const depth = openWithin(i, j)
      if (depth > 2) continue
      const mat = facadeMats[Math.floor(rng() * facadeMats.length)]
      if (depth === 2) {
        box(CELL, 14 + rng() * 14, CELL, mat, x, 0, z).castShadow = false
        continue
      }
      const border = i === 0 || j === 0 || i === GW - 1 || j === GH - 1
      const H = border ? 12 + rng() * 14 : 6 + rng() * 13
      const solid = H * (0.55 + rng() * 0.25)
      box(CELL, solid, CELL, mat, x, 0, z)
      // postrzępiona góra: 4 fragmenty o różnych wysokościach, część zawalona
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          if (rng() < 0.28) continue
          const ph = (H - solid) * (0.3 + rng() * 0.7)
          const w = CELL / 2 - rng() * 0.6
          const d = CELL / 2 - rng() * 0.6
          box(w, ph, d, mat, x + sx * CELL * 0.25, solid, z + sz * CELL * 0.25)
          // pręty zbrojeniowe sterczące z ruin
          if (rng() < 0.5)
            for (let k = 0; k < 3; k++) {
              const r = new THREE.Mesh(rebarGeo, rebarMat)
              r.position.set(x + sx * CELL * 0.25 + (rng() - 0.5) * w, solid + ph, z + sz * CELL * 0.25 + (rng() - 0.5) * d)
              r.scale.y = 0.6 + rng() * 1.4
              r.rotation.set((rng() - 0.5) * 0.7, 0, (rng() - 0.5) * 0.7)
              group.add(r)
            }
        }
      // mech na dachu
      box(CELL * 0.92, 0.08, CELL * 0.92, mossMat, x, solid, z, false).castShadow = false

      // strony od ulicy: wystające stropy, bluszcz
      const sides: [number, number][] = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]
      for (const [dx, dz] of sides) {
        if (wall(i + dx, j + dz)) continue
        const along = dx === 0
        // wystający strop na którymś piętrze (wysoko — nie blokuje ruchu)
        if (rng() < 0.45 && solid > 6) {
          const y = 3 * Math.floor(2 + rng() * Math.max(1, solid / 3 - 2))
          const len = CELL * (0.4 + rng() * 0.5)
          const slab = box(along ? len : 1.1, 0.25, along ? 1.1 : len, slabMat, x + dx * (CELL / 2 + 0.5), y, z + dz * (CELL / 2 + 0.5), false)
          slab.rotation.set(along ? (rng() - 0.5) * 0.3 : 0, 0, along ? 0 : (rng() - 0.5) * 0.3)
        }
        // bluszcz zwisający z góry ściany
        const n = 1 + Math.floor(rng() * 3)
        for (let k = 0; k < n; k++) {
          if (rng() < 0.3) continue
          const len = solid * (0.35 + rng() * 0.6)
          const ivy = new THREE.Mesh(ivyGeo, ivyMat)
          const off = (rng() - 0.5) * (CELL - 2)
          ivy.position.set(x + dx * (CELL / 2 + 0.04) + (along ? off : 0), solid - 0.1, z + dz * (CELL / 2 + 0.04) + (along ? 0 : off))
          ivy.rotation.y = Math.atan2(dx, dz)
          ivy.scale.set(0.8 + rng() * 0.8, len, 1)
          ivy.castShadow = true
          group.add(ivy)
        }
      }
    }

  // ── trawa (instancjonowana, kołysze się) ─────────────────
  const grassTex = T(grassBladeTex())
  const grassMat = T(new THREE.MeshStandardMaterial({ map: grassTex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1 }))
  addWind(grassMat, uTime, 0.25, 1.4)
  const tuft = new THREE.PlaneGeometry(0.9, 0.75)
  tuft.translate(0, 0.37, 0)
  const tuft2 = tuft.clone().rotateY(Math.PI / 2)
  const grassGeo = T(mergeGeos([tuft, tuft2]))
  tuft.dispose()
  tuft2.dispose()
  const GRASS = 5200
  const grass = new THREE.InstancedMesh(grassGeo, grassMat, GRASS)
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  let gi = 0
  const nearWall = (x: number, z: number) => wall(ci(x + 0.9), cj(z)) || wall(ci(x - 0.9), cj(z)) || wall(ci(x), cj(z + 0.9)) || wall(ci(x), cj(z - 0.9))
  for (let tries = 0; tries < GRASS * 4 && gi < GRASS; tries++) {
    const [i, j] = walk[Math.floor(rng() * walk.length)]
    const x = cx(i) + (rng() - 0.5) * CELL
    const z = cz(j) + (rng() - 0.5) * CELL
    // więcej trawy przy ścianach i na placach, mniej na środku jezdni
    const dense = nearWall(x, z) || MAP[j][i] === 'P'
    if (!dense && rng() < 0.6) continue
    const s = 0.6 + rng() * (dense ? 1.1 : 0.6)
    q.setFromAxisAngle(up, rng() * Math.PI)
    m4.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s * (0.8 + rng() * 0.6), s))
    grass.setMatrixAt(gi++, m4)
  }
  grass.count = gi
  grass.receiveShadow = true
  group.add(grass)

  // ── krzaki ───────────────────────────────────────────────
  const bushGeo = T(new THREE.IcosahedronGeometry(0.7, 1))
  const bushMat = T(new THREE.MeshStandardMaterial({ color: 0x4a6a28, roughness: 1, flatShading: true }))
  addWind(bushMat, uTime, 0.06, 0.8)
  const BUSH = 140
  const bushes = new THREE.InstancedMesh(bushGeo, bushMat, BUSH)
  const bushCol = new THREE.Color()
  for (let b = 0; b < BUSH; b++) {
    const [i, j] = walk[Math.floor(rng() * walk.length)]
    // przy ścianie
    const side = Math.floor(rng() * 4)
    const off = (rng() - 0.5) * (CELL - 1)
    const e = CELL / 2 - 0.6
    const x = cx(i) + (side === 0 ? e : side === 1 ? -e : off)
    const z = cz(j) + (side === 2 ? e : side === 3 ? -e : off)
    const s = 0.7 + rng() * 1.1
    m4.compose(new THREE.Vector3(x, s * 0.35, z), q.setFromAxisAngle(up, rng() * 6), new THREE.Vector3(s, s * 0.75, s))
    bushes.setMatrixAt(b, m4)
    bushes.setColorAt(b, bushCol.setHSL(0.22 + rng() * 0.08, 0.45, 0.22 + rng() * 0.12))
  }
  bushes.castShadow = true
  bushes.receiveShadow = true
  group.add(bushes)

  // ── drzewa wyrastające z asfaltu (place) ─────────────────
  const trunkMat = T(new THREE.MeshStandardMaterial({ color: 0x4b3a2a, roughness: 1 }))
  const leafMat = T(new THREE.MeshStandardMaterial({ color: 0x55782c, roughness: 0.9, flatShading: true }))
  addWind(leafMat, uTime, 0.18, 0.12)
  const trunkGeo = T(new THREE.CylinderGeometry(0.18, 0.32, 4, 7))
  trunkGeo.translate(0, 2, 0)
  const crownGeo = T(new THREE.IcosahedronGeometry(1.6, 1))
  const treeSpots: THREE.Vector3[] = []
  const plazaCells = walk.filter(([i, j]) => MAP[j][i] === 'P')
  for (const [i, j] of plazaCells) {
    if (rng() < 0.45) continue
    const x = cx(i) + (rng() - 0.5) * (CELL - 2.5)
    const z = cz(j) + (rng() - 0.5) * (CELL - 2.5)
    const t = new THREE.Group()
    const s = 0.8 + rng() * 0.6
    const trunk = new THREE.Mesh(trunkGeo, trunkMat)
    trunk.castShadow = true
    t.add(trunk)
    for (let k = 0; k < 4; k++) {
      const c = new THREE.Mesh(crownGeo, leafMat)
      c.position.set((rng() - 0.5) * 2, 4 + rng() * 1.5, (rng() - 0.5) * 2)
      c.scale.setScalar(0.7 + rng() * 0.6)
      c.castShadow = true
      t.add(c)
    }
    t.position.set(x, 0, z)
    t.scale.setScalar(s)
    t.rotation.y = rng() * 6
    group.add(t)
    treeSpots.push(t.position.clone())
    boxes.push({ minX: x - 0.35 * s, maxX: x + 0.35 * s, minZ: z - 0.35 * s, maxZ: z + 0.35 * s })
  }

  // ── wraki aut (przeszkody) ───────────────────────────────
  const rustMats = [0x7a4a2c, 0x5e5a52, 0x6b3b2b, 0x4f5c5a].map((c) => T(new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, metalness: 0.35 })))
  const glassMat = T(new THREE.MeshStandardMaterial({ color: 0x1a2226, roughness: 0.3, metalness: 0.6 }))
  const tireMat = T(new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 1 }))
  const carBody = T(new THREE.BoxGeometry(1.8, 0.75, 4.1))
  carBody.translate(0, 0.6, 0)
  const carTop = T(new THREE.BoxGeometry(1.6, 0.6, 2))
  carTop.translate(0, 1.27, -0.15)
  const tireGeo = T(new THREE.CylinderGeometry(0.35, 0.35, 0.25, 10))
  tireGeo.rotateZ(Math.PI / 2)
  const corridorCells = walk.filter(([i, j]) => MAP[j][i] === '.')
  let cars = 0
  for (const [i, j] of corridorCells) {
    if (rng() > 0.13 || cars > 14) continue
    const horiz = !wall(i - 1, j) || !wall(i + 1, j) // ulica biegnie wzdłuż X?
    const x = cx(i) + (horiz ? (rng() - 0.5) * 2 : (rng() < 0.5 ? -1.6 : 1.6))
    const z = cz(j) + (horiz ? (rng() < 0.5 ? -1.6 : 1.6) : (rng() - 0.5) * 2)
    const car = new THREE.Group()
    const body = new THREE.Mesh(carBody, rustMats[Math.floor(rng() * rustMats.length)])
    const top = new THREE.Mesh(carTop, glassMat)
    body.castShadow = top.castShadow = body.receiveShadow = true
    car.add(body, top)
    for (const [tx, tz] of [
      [0.85, 1.3],
      [-0.85, 1.3],
      [0.85, -1.3],
      [-0.85, -1.3],
    ]) {
      if (rng() < 0.35) continue // brak koła
      const t = new THREE.Mesh(tireGeo, tireMat)
      t.position.set(tx, 0.35, tz)
      car.add(t)
    }
    const yaw = (horiz ? Math.PI / 2 : 0) + (rng() - 0.5) * 0.5
    car.rotation.set((rng() - 0.5) * 0.06, yaw, (rng() - 0.5) * 0.12)
    car.position.set(x, -0.05, z)
    group.add(car)
    const hw = horiz ? 2.1 : 1
    const hd = horiz ? 1 : 2.1
    boxes.push({ minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd })
    cars++
  }

  // ── gruz przy ścianach ───────────────────────────────────
  const rubbleGeo = T(new THREE.DodecahedronGeometry(0.35, 0))
  const rubbleMat = T(new THREE.MeshStandardMaterial({ color: 0x8a8378, roughness: 1, flatShading: true }))
  const RUB = 420
  const rubble = new THREE.InstancedMesh(rubbleGeo, rubbleMat, RUB)
  for (let r = 0; r < RUB; r++) {
    const [i, j] = walk[Math.floor(rng() * walk.length)]
    const side = Math.floor(rng() * 4)
    const off = (rng() - 0.5) * CELL
    const e = CELL / 2 - 0.3 - rng() * 0.8
    const x = cx(i) + (side === 0 ? e : side === 1 ? -e : off)
    const z = cz(j) + (side === 2 ? e : side === 3 ? -e : off)
    const s = 0.4 + rng() * 1.3
    m4.compose(new THREE.Vector3(x, s * 0.12, z), q.setFromEuler(new THREE.Euler(rng() * 6, rng() * 6, rng() * 6)), new THREE.Vector3(s, s * 0.6, s))
    rubble.setMatrixAt(r, m4)
    rubble.setColorAt(r, bushCol.setHSL(0.08, 0.08, 0.42 + rng() * 0.15))
  }
  rubble.castShadow = true
  rubble.receiveShadow = true
  group.add(rubble)

  // ── beczki z ogniem (migoczące światło + dym) ────────────
  const barrelGeo = T(new THREE.CylinderGeometry(0.4, 0.4, 1.1, 12))
  barrelGeo.translate(0, 0.55, 0)
  const barrelMat = T(new THREE.MeshStandardMaterial({ color: 0x5c3a24, roughness: 0.7, metalness: 0.5 }))
  const flameGeo = T(new THREE.ConeGeometry(0.32, 0.9, 8, 1, true))
  flameGeo.translate(0, 0.45, 0)
  const flameMat = T(new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
  const flameMat2 = T(new THREE.MeshBasicMaterial({ color: 0xfff0a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
  const fires: { light: THREE.PointLight; f1: THREE.Mesh; f2: THREE.Mesh; pos: THREE.Vector3; phase: number }[] = []
  for (const [i, j] of plazaCells.filter(() => rng() < 0.35).slice(0, 7)) {
    const x = cx(i) + (rng() - 0.5) * 3
    const z = cz(j) + (rng() - 0.5) * 3
    const b = new THREE.Mesh(barrelGeo, barrelMat)
    b.position.set(x, 0, z)
    b.castShadow = true
    group.add(b)
    const f1 = new THREE.Mesh(flameGeo, flameMat)
    const f2 = new THREE.Mesh(flameGeo, flameMat2)
    f1.position.set(x, 1.05, z)
    f2.position.set(x, 1.05, z)
    f2.scale.setScalar(0.55)
    group.add(f1, f2)
    const light = new THREE.PointLight(0xff8a3a, 8, 9, 1.6)
    light.position.set(x, 1.8, z)
    group.add(light)
    fires.push({ light, f1, f2, pos: new THREE.Vector3(x, 1.5, z), phase: rng() * 10 })
    boxes.push({ minX: x - 0.45, maxX: x + 0.45, minZ: z - 0.45, maxZ: z + 0.45 })
  }
  // dym: wspólna pula sprite'ów
  const smokeTex = T(
    canvasTex(
      64,
      64,
      (g) => {
        const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32)
        grd.addColorStop(0, 'rgba(120,115,110,0.55)')
        grd.addColorStop(1, 'rgba(120,115,110,0)')
        g.fillStyle = grd
        g.fillRect(0, 0, 64, 64)
      },
      false,
    ),
  )
  const smoke: { s: THREE.Sprite; mat: THREE.SpriteMaterial; t: number; life: number; v: THREE.Vector3 }[] = []
  for (let k = 0; k < fires.length * 8; k++) {
    const mat = T(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0 }))
    const s = new THREE.Sprite(mat)
    group.add(s)
    smoke.push({ s, mat, t: rng() * 3, life: 3, v: new THREE.Vector3() })
  }

  // ── zwisające kable między budynkami (kołyszą się, iskrzą) ─
  const cableMat = T(new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.8 }))
  const cables: { mesh: THREE.Mesh; base: number; phase: number; spark: THREE.Vector3 | null }[] = []
  for (const [i, j] of corridorCells) {
    if (rng() > 0.22) continue
    const alongX = wall(i, j - 1) && wall(i, j + 1) // ściany po bokach w osi Z → kabel w poprzek (wzdłuż Z)
    const a = new THREE.Vector3(cx(i), 0, cz(j))
    const b = a.clone()
    const y = 4.5 + rng() * 3
    if (alongX) {
      a.z -= CELL / 2
      b.z += CELL / 2
    } else {
      a.x -= CELL / 2
      b.x += CELL / 2
    }
    a.y = y
    b.y = y + (rng() - 0.5)
    const broken = rng() < 0.35
    const pts: THREE.Vector3[] = []
    for (let k = 0; k <= 16; k++) {
      const t = k / 16
      const p = a.clone().lerp(b, broken ? t * 0.55 : t)
      p.y -= broken ? t * t * 2.6 : Math.sin(t * Math.PI) * 1.1
      pts.push(p)
    }
    const geo = T(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.025, 4))
    const mesh = new THREE.Mesh(geo, cableMat)
    const pivot = new THREE.Group()
    pivot.position.copy(a)
    mesh.position.sub(a)
    pivot.add(mesh)
    group.add(pivot)
    cables.push({ mesh: pivot as unknown as THREE.Mesh, base: 0, phase: rng() * 10, spark: broken ? pts[pts.length - 1].clone() : null })
  }

  // ── migoczący, zepsuty neon ──────────────────────────────
  const neonMats: THREE.MeshBasicMaterial[] = []
  const neonWords = ['RANDOM PLAY', 'HOTEL', 'NOODLES', 'OPEN 24', 'ARCADE']
  let neons = 0
  for (const [i, j] of walk) {
    if (neons >= 5 || rng() > 0.08) continue
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      if (!wall(i + dx, j + dz)) continue
      const mat = T(new THREE.MeshBasicMaterial({ map: T(neonTex(neonWords[neons % neonWords.length])), transparent: true, side: THREE.DoubleSide }))
      const sign = new THREE.Mesh(T(new THREE.PlaneGeometry(3, 0.75)), mat)
      sign.position.set(cx(i) + dx * (CELL / 2 - 0.05), 3.4, cz(j) + dz * (CELL / 2 - 0.05))
      sign.rotation.y = Math.atan2(-dx, -dz)
      sign.rotation.z = (rng() - 0.5) * 0.25 // przekrzywiony
      group.add(sign)
      neonMats.push(mat)
      neons++
      break
    }
  }

  // ── ptaki krążące nad miastem ────────────────────────────
  const birdMat = T(new THREE.MeshBasicMaterial({ color: 0x1d1d22, side: THREE.DoubleSide }))
  const wingGeo = T(new THREE.BufferGeometry())
  wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.12, 0, 0, -0.12, 0.55, 0, 0], 3))
  const flocks: { center: THREE.Vector3; r: number; speed: number; birds: { g: THREE.Group; l: THREE.Mesh; r: THREE.Mesh; off: THREE.Vector3; ph: number }[] }[] = []
  for (let f = 0; f < 3; f++) {
    const center = new THREE.Vector3((rng() - 0.5) * CITY_HALF, 24 + rng() * 10, (rng() - 0.5) * CITY_HALF)
    const birds = []
    for (let k = 0; k < 7 + Math.floor(rng() * 6); k++) {
      const g = new THREE.Group()
      const l = new THREE.Mesh(wingGeo, birdMat)
      const r = new THREE.Mesh(wingGeo, birdMat)
      r.scale.x = -1
      g.add(l, r)
      g.scale.setScalar(0.9 + rng() * 0.5)
      group.add(g)
      birds.push({ g, l, r, off: new THREE.Vector3((rng() - 0.5) * 6, (rng() - 0.5) * 2, (rng() - 0.5) * 6), ph: rng() * 6 })
    }
    flocks.push({ center, r: 14 + rng() * 14, speed: (0.12 + rng() * 0.1) * (rng() < 0.5 ? 1 : -1), birds })
  }

  // ── motyle ───────────────────────────────────────────────
  const flyGeo = T(new THREE.PlaneGeometry(0.16, 0.12))
  flyGeo.translate(0.08, 0, 0)
  const butterflies: { g: THREE.Group; l: THREE.Mesh; r: THREE.Mesh; home: THREE.Vector3; ph: number }[] = []
  const flyCols = [0xffd23f, 0xff8fd2, 0xffffff, 0x7fd6ff]
  for (let k = 0; k < 22; k++) {
    const [i, j] = walk[Math.floor(rng() * walk.length)]
    const mat = T(new THREE.MeshBasicMaterial({ color: flyCols[k % flyCols.length], side: THREE.DoubleSide }))
    const g = new THREE.Group()
    const l = new THREE.Mesh(flyGeo, mat)
    const r = new THREE.Mesh(flyGeo, mat)
    r.scale.x = -1
    g.add(l, r)
    group.add(g)
    butterflies.push({ g, l, r, home: new THREE.Vector3(cx(i), 0.8, cz(j)), ph: rng() * 20 })
  }

  // ── pyłki / kurz w słońcu (wokół gracza) ─────────────────
  const MOTES = 260
  const moteArr = new Float32Array(MOTES * 3)
  for (let k = 0; k < MOTES; k++) moteArr.set([(rng() - 0.5) * 30, rng() * 6, (rng() - 0.5) * 30], k * 3)
  const moteGeo = T(new THREE.BufferGeometry())
  moteGeo.setAttribute('position', new THREE.BufferAttribute(moteArr, 3))
  const motes = new THREE.Points(moteGeo, T(new THREE.PointsMaterial({ color: 0xfff6d0, size: 0.05, transparent: true, opacity: 0.7, depthWrite: false })))
  group.add(motes)

  // ── spadające liście (przy drzewach) ─────────────────────
  const leafGeo = T(new THREE.PlaneGeometry(0.12, 0.08))
  const leafM = T(new THREE.MeshStandardMaterial({ color: 0x9a8a30, side: THREE.DoubleSide }))
  const leaves: { m: THREE.Mesh; t: number; tree: THREE.Vector3; seed: number }[] = []
  if (treeSpots.length)
    for (let k = 0; k < 60; k++) {
      const m = new THREE.Mesh(leafGeo, leafM)
      group.add(m)
      leaves.push({ m, t: rng() * 6, tree: treeSpots[k % treeSpots.length], seed: rng() * 10 })
    }

  // ── podmuch kurzu przelatujący korytarzem ────────────────
  const GUST = 140
  const gustArr = new Float32Array(GUST * 3)
  const gustGeo = T(new THREE.BufferGeometry())
  gustGeo.setAttribute('position', new THREE.BufferAttribute(gustArr, 3))
  const gustMat = T(new THREE.PointsMaterial({ color: 0xc9b79a, size: 0.09, transparent: true, opacity: 0, depthWrite: false }))
  const gust = new THREE.Points(gustGeo, gustMat)
  group.add(gust)
  const gustState = { t: 4, dir: new THREE.Vector3(1, 0, 0), origin: new THREE.Vector3() }

  // ── iskry z kabli ────────────────────────────────────────
  const sparkGeo = T(new THREE.BufferGeometry())
  const SPK = 40
  const sparkArr = new Float32Array(SPK * 3)
  const sparkVel = Array.from({ length: SPK }, () => new THREE.Vector3())
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkArr, 3))
  const sparkMat = T(new THREE.PointsMaterial({ color: 0xbfe6ff, size: 0.08, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
  const sparks = new THREE.Points(sparkGeo, sparkMat)
  group.add(sparks)
  const sparkLight = new THREE.PointLight(0x9fd8ff, 0, 6)
  group.add(sparkLight)
  const sparkState = { t: 2, life: 0 }

  // ── flow field (BFS) ─────────────────────────────────────
  const dist = new Int32Array(GW * GH).fill(-1)
  let fieldCell = -1
  const rebuildField = (pi: number, pj: number) => {
    const id = pj * GW + pi
    if (id === fieldCell) return
    fieldCell = id
    dist.fill(-1)
    if (wall(pi, pj)) return
    const queue = [id]
    dist[id] = 0
    for (let h = 0; h < queue.length; h++) {
      const c = queue[h]
      const i = c % GW
      const j = (c / GW) | 0
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const ni = i + dx
        const nj = j + dz
        if (wall(ni, nj)) continue
        const n = nj * GW + ni
        if (dist[n] >= 0) continue
        dist[n] = dist[c] + 1
        queue.push(n)
      }
    }
  }
  const target = new THREE.Vector3()
  const wallAt = (x: number, z: number) => wall(ci(x), cj(z))
  const losClear = (a: THREE.Vector3, b: THREE.Vector3, margin: number) => {
    const d = a.distanceTo(b)
    const n = Math.ceil(d / 0.5)
    for (let k = 1; k < n; k++) {
      const t = k / n
      const x = a.x + (b.x - a.x) * t
      const z = a.z + (b.z - a.z) * t
      if (wallAt(x + margin, z) || wallAt(x - margin, z) || wallAt(x, z + margin) || wallAt(x, z - margin)) return false
    }
    return true
  }

  // ── API ──────────────────────────────────────────────────
  return {
    boxes,
    start,
    wallAt,
    bossCenter,
    heals,
    inBossRoom: (p) => MAP[cj(p.z)]?.[ci(p.x)] === 'B',
    randomPoint(avoid, minDist) {
      const pool = walk.filter(([i, j]) => MAP[j][i] !== 'B' && Math.hypot(cx(i) - avoid.x, cz(j) - avoid.z) >= minDist)
      const src = pool.length ? pool : walk
      const [i, j] = src[Math.floor(Math.random() * src.length)]
      return new THREE.Vector3(cx(i) + (Math.random() - 0.5) * (CELL - 2), 0, cz(j) + (Math.random() - 0.5) * (CELL - 2))
    },
    spawnPoint(from, min, max) {
      const pi = ci(from.x)
      const pj = cj(from.z)
      rebuildField(pi, pj)
      // komórki osiągalne w [min,max] kroków ścieżki, losowo
      const cand = walk.filter(([i, j]) => {
        const d = dist[j * GW + i] * CELL
        return d >= min && d <= max
      })
      const pool = cand.length ? cand : walk
      const [i, j] = pool[Math.floor(Math.random() * pool.length)]
      return new THREE.Vector3(cx(i) + (Math.random() - 0.5) * (CELL - 2), 0, cz(j) + (Math.random() - 0.5) * (CELL - 2))
    },
    steer(from, out) {
      // cel = gracz; w zasięgu wzroku → prosto, inaczej po flow field
      if (losClear(from, target, 0.45)) return out.copy(target).sub(from).setY(0).normalize()
      const i = ci(from.x)
      const j = cj(from.z)
      let best = dist[j * GW + i]
      let bi = i
      let bj = j
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const d = wall(i + dx, j + dz) ? -1 : dist[(j + dz) * GW + i + dx]
        if (d >= 0 && (best < 0 || d < best)) {
          best = d
          bi = i + dx
          bj = j + dz
        }
      }
      out.set(cx(bi) - from.x, 0, cz(bj) - from.z)
      if (out.lengthSq() < 0.01) out.copy(target).sub(from).setY(0)
      return out.normalize()
    },
    cameraDistance(t, dir, max) {
      const steps = Math.ceil(max / 0.15)
      for (let k = 1; k <= steps; k++) {
        const d = (k / steps) * max
        const x = t.x + dir.x * d
        const z = t.z + dir.z * d
        const y = t.y + dir.y * d
        if (y < 0.3) return Math.max(0.6, d - 0.3)
        if (wallAt(x + 0.3, z) || wallAt(x - 0.3, z) || wallAt(x, z + 0.3) || wallAt(x, z - 0.3)) return Math.max(0.6, d - 0.25)
      }
      return max
    },
    update(time, dt, player, camera) {
      uTime.value = time
      target.copy(player)
      rebuildField(ci(player.x), cj(player.z))
      sky.position.set(camera.x, 0, camera.z)

      // ogień
      for (const f of fires) {
        const fl = 0.75 + Math.sin(time * 17 + f.phase) * 0.12 + Math.sin(time * 31 + f.phase * 2) * 0.1 + Math.random() * 0.06
        f.light.intensity = 7 * fl + 2
        f.f1.scale.set(1, fl * 1.3, 1)
        f.f2.scale.set(0.55, fl * 0.9, 0.55)
        f.f1.rotation.y = time * 3
      }
      flameMat.opacity = 0.7 + Math.random() * 0.2
      for (let k = 0; k < smoke.length; k++) {
        const p = smoke[k]
        const f = fires[k % fires.length]
        p.t += dt
        if (p.t >= p.life) {
          p.t = 0
          p.s.position.copy(f.pos).add(new THREE.Vector3((Math.random() - 0.5) * 0.2, 0, (Math.random() - 0.5) * 0.2))
          p.v.set(0.25 + (Math.random() - 0.5) * 0.2, 0.9 + Math.random() * 0.4, (Math.random() - 0.5) * 0.2)
        }
        const k01 = p.t / p.life
        p.s.position.addScaledVector(p.v, dt)
        p.s.scale.setScalar(0.5 + k01 * 2.6)
        p.mat.opacity = Math.sin(k01 * Math.PI) * 0.5
      }

      // kable kołyszą się na wietrze
      for (const c of cables) c.mesh.rotation.x = Math.sin(time * 1.3 + c.phase) * 0.05
      // iskry co kilka sekund z losowego zerwanego kabla
      sparkState.t -= dt
      const broken = cables.filter((c) => c.spark)
      if (sparkState.t <= 0 && broken.length) {
        sparkState.t = 1.5 + Math.random() * 3
        sparkState.life = 0.6
        const src = broken[Math.floor(Math.random() * broken.length)].spark!
        for (let k = 0; k < SPK; k++) {
          sparkArr.set([src.x, src.y, src.z], k * 3)
          sparkVel[k].set((Math.random() - 0.5) * 4, Math.random() * 2, (Math.random() - 0.5) * 4)
        }
        sparkLight.position.copy(src)
      }
      if (sparkState.life > 0) {
        sparkState.life -= dt
        const at = sparkGeo.getAttribute('position') as THREE.BufferAttribute
        for (let k = 0; k < SPK; k++) {
          sparkVel[k].y -= 12 * dt
          at.setXYZ(k, at.getX(k) + sparkVel[k].x * dt, Math.max(0.05, at.getY(k) + sparkVel[k].y * dt), at.getZ(k) + sparkVel[k].z * dt)
        }
        at.needsUpdate = true
        sparkMat.opacity = Math.max(0, sparkState.life / 0.6)
        sparkLight.intensity = Math.random() < 0.5 ? 14 * sparkMat.opacity : 0
      } else {
        sparkMat.opacity = 0
        sparkLight.intensity = 0
      }

      // migający neon
      for (const [k, m] of neonMats.entries()) {
        const s = Math.sin(time * 7 + k * 3) + Math.sin(time * 23 + k)
        m.opacity = s > 1.3 ? 0.15 : 0.95
      }

      // ptaki
      for (const f of flocks) {
        const a = time * f.speed
        for (const b of f.birds) {
          const ang = a + b.off.x * 0.03
          const x = f.center.x + Math.cos(ang) * (f.r + b.off.z)
          const z = f.center.z + Math.sin(ang) * (f.r + b.off.z)
          b.g.position.set(x, f.center.y + b.off.y + Math.sin(time + b.ph) * 0.6, z)
          b.g.rotation.y = -ang + (f.speed > 0 ? 0 : Math.PI)
          const flap = Math.sin(time * 9 + b.ph) * 0.7
          b.l.rotation.z = flap
          b.r.rotation.z = -flap
        }
      }

      // motyle krążą wokół swoich miejsc
      for (const b of butterflies) {
        const t = time * 0.6 + b.ph
        b.g.position.set(b.home.x + Math.sin(t) * 1.5 + Math.sin(t * 2.3) * 0.4, 0.6 + Math.abs(Math.sin(t * 1.7)) * 0.9, b.home.z + Math.cos(t * 0.8) * 1.5)
        b.g.rotation.y = t * 1.3
        const flap = Math.sin(time * 22 + b.ph) * 1.1
        b.l.rotation.y = flap
        b.r.rotation.y = -flap
      }

      // pyłki dryfują wokół gracza
      motes.position.set(player.x, 0, player.z)
      const ma = moteGeo.getAttribute('position') as THREE.BufferAttribute
      for (let k = 0; k < MOTES; k++) {
        let y = ma.getY(k) + Math.sin(time + k) * dt * 0.15 + dt * 0.05
        if (y > 6) y = 0
        ma.setXYZ(k, ma.getX(k) + Math.sin(time * 0.3 + k) * dt * 0.2, y, ma.getZ(k) + Math.cos(time * 0.2 + k) * dt * 0.2)
      }
      ma.needsUpdate = true

      // liście spadają z drzew
      for (const l of leaves) {
        l.t += dt
        const life = 6
        if (l.t > life) l.t = 0
        const k = l.t / life
        l.m.position.set(l.tree.x + Math.sin(l.t * 1.5 + l.seed) * 1.2 + k * 2, 5.5 - k * 5.4, l.tree.z + Math.cos(l.t * 1.2 + l.seed) * 1.2)
        l.m.rotation.set(l.t * 3 + l.seed, l.t * 2, l.t * 4)
      }

      // podmuch kurzu
      gustState.t -= dt
      if (gustState.t <= 0) {
        gustState.t = 7 + Math.random() * 6
        const a = Math.random() * Math.PI * 2
        gustState.dir.set(Math.cos(a), 0, Math.sin(a))
        gustState.origin.copy(player).addScaledVector(gustState.dir, -10)
        for (let k = 0; k < GUST; k++) gustArr.set([gustState.origin.x + (Math.random() - 0.5) * 4, Math.random() * 1.5, gustState.origin.z + (Math.random() - 0.5) * 4], k * 3)
      }
      const gl = 7 + 6 - gustState.t // czas od startu podmuchu (przybliżony)
      const active = gustState.t > 3
      gustMat.opacity = active ? Math.min(0.5, (gustState.t - 3) * 0.3) : 0
      if (active) {
        const ga = gustGeo.getAttribute('position') as THREE.BufferAttribute
        for (let k = 0; k < GUST; k++)
          ga.setXYZ(k, ga.getX(k) + gustState.dir.x * dt * (6 + (k % 5)), ga.getY(k) + Math.sin(gl * 3 + k) * dt * 0.6, ga.getZ(k) + gustState.dir.z * dt * (6 + (k % 5)))
        ga.needsUpdate = true
      }
    },
    drawMinimap(ctx, size, player, facing, enemies, camYaw = 0, pickups = []) {
      const R = 30
      const s = size / (R * 2)
      ctx.clearRect(0, 0, size, size)
      ctx.save()
      ctx.beginPath()
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
      ctx.clip()
      ctx.fillStyle = 'rgba(30,36,24,0.85)'
      ctx.fillRect(0, 0, size, size)
      // obracamy mapę razem z kamerą (góra = kierunek patrzenia)
      ctx.translate(size / 2, size / 2)
      ctx.rotate(camYaw - Math.PI)
      ctx.translate(-size / 2, -size / 2)
      const tx = (x: number) => (x - player.x) * s + size / 2
      const tz = (z: number) => (z - player.z) * s + size / 2
      for (let j = 0; j < GH; j++)
        for (let i = 0; i < GW; i++) {
          const c = MAP[j][i]
          ctx.fillStyle = c === '#' ? 'rgba(150,140,120,0.75)' : c === 'P' ? 'rgba(110,150,70,0.5)' : c === 'B' ? 'rgba(255,62,90,0.35)' : 'rgba(255,255,255,0.08)'
          ctx.fillRect(tx(cx(i) - CELL / 2), tz(cz(j) - CELL / 2), CELL * s + 0.5, CELL * s + 0.5)
        }
      ctx.fillStyle = '#5dff8a'
      for (const h of pickups) {
        ctx.beginPath()
        ctx.arc(tx(h.x), tz(h.z), 3.5, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.fillStyle = '#ff3e5a'
      for (const e of enemies) {
        ctx.beginPath()
        ctx.arc(tx(e.x), tz(e.z), 3, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.translate(size / 2, size / 2)
      ctx.rotate(-facing + Math.PI)
      ctx.fillStyle = '#' + accent.getHexString()
      ctx.beginPath()
      ctx.moveTo(0, -7)
      ctx.lineTo(5, 5)
      ctx.lineTo(-5, 5)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    },
    dispose() {
      scene.remove(group)
      disposables.forEach((d) => d.dispose())
    },
  }
}

/** Skleja kilka geometrii (z tymi samymi atrybutami) w jedną. */
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

/** Wypycha okrąg (p, r) z prostokątów; zwraca true, jeśli była kolizja. */
export function pushOutOfBoxes(p: THREE.Vector3, r: number, boxes: Box[]) {
  let hit = false
  for (const b of boxes) {
    if (p.x < b.minX - r || p.x > b.maxX + r || p.z < b.minZ - r || p.z > b.maxZ + r) continue
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
