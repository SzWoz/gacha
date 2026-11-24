import * as THREE from 'three'

// ─────────────────────────────────────────────────────────────
//  Neonowe miasto nocą: siatka ulic co BLOCK metrów, kwartały z
//  budynkami, plac w centrum, latarnie, zaparkowane auta, billboardy.
//  Zwraca prostokąty kolizji (AABB) i punkty spawnu na ulicach.
// ─────────────────────────────────────────────────────────────

export const CITY_HALF = 42 // połowa boku grywalnego obszaru
const BLOCK = 14 // odstęp osi ulic
const ROAD = 3 // połowa szerokości jezdni
const WALK = 1.2 // chodnik
const PLAZA = 9.5 // połowa boku placu w centrum

export interface Box {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

interface Building {
  box: Box
  height: number
  mats: THREE.Material[]
  fade: number
}

export interface City {
  boxes: Box[]
  /** losowy punkt na jezdni w odległości [min, max] od `from` */
  spawnPoint(from: THREE.Vector3, min: number, max: number): THREE.Vector3
  update(time: number, dt: number, player: THREE.Vector3, camera: THREE.Vector3): void
  drawMinimap(ctx: CanvasRenderingContext2D, size: number, player: THREE.Vector3, facing: number, enemies: THREE.Vector3[]): void
  dispose(): void
}

const NEON = [0xff3ea5, 0x3fd8ff, 0x7cffd4, 0xffb800, 0xb07cff, 0xff6a2e]

function rngFrom(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Tekstura okien: siatka prostokątów, część zapalona w ciepłych/zimnych barwach. */
function windowTexture(rng: () => number, tint: string) {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')!
  g.fillStyle = '#000'
  g.fillRect(0, 0, 256, 256)
  const cols = 8
  const rows = 8
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const r = rng()
      if (r < 0.45) continue
      g.fillStyle = r < 0.8 ? '#ffd9a0' : r < 0.93 ? tint : '#9fdcff'
      g.globalAlpha = 0.35 + rng() * 0.65
      g.fillRect(x * 32 + 6, y * 32 + 8, 20, 16)
    }
  g.globalAlpha = 1
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Box z UV skalowanymi do rozmiaru (okna nie rozciągają się na wysokich budynkach). */
function buildingGeometry(w: number, h: number, d: number) {
  const geo = new THREE.BoxGeometry(w, h, d)
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute
  // kolejność ścian: +x, -x, +y, -y, +z, -z (po 4 wierzchołki)
  const dims: [number, number][] = [
    [d, h],
    [d, h],
    [0, 0],
    [0, 0],
    [w, h],
    [w, h],
  ]
  for (let f = 0; f < 6; f++)
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i
      const [su, sv] = dims[f]
      uv.setXY(k, uv.getX(k) * (su / 3.2), uv.getY(k) * (sv / 3.2))
    }
  geo.translate(0, h / 2, 0)
  return geo
}

function signTexture(text: string, color: string) {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = 'rgba(0,0,0,0.85)'
  g.fillRect(0, 0, 512, 128)
  g.strokeStyle = color
  g.lineWidth = 8
  g.strokeRect(8, 8, 496, 112)
  g.font = 'bold 72px Impact, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.shadowColor = color
  g.shadowBlur = 24
  g.fillStyle = color
  g.fillText(text, 256, 68)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

const SIGNS = ['RANDOM PLAY', 'HOLLOW', 'NEW ERIDU', 'ZERO', '24/7', 'NOODLES', 'ARCADE', 'BANGBOO', 'SIXTH ST', 'VIDEO', 'HOTEL', 'BAR']

export function buildCity(scene: THREE.Scene, accent: THREE.Color): City {
  const rng = rngFrom(1337)
  const disposables: { dispose(): void }[] = []
  const group = new THREE.Group()
  scene.add(group)
  const boxes: Box[] = []
  const buildings: Building[] = []

  // ── ziemia: jezdnie, pasy, przejścia, chodniki, plac ─────
  const groundMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uAccent: { value: accent.clone() }, uB: { value: BLOCK }, uR: { value: ROAD }, uW: { value: WALK }, uP: { value: PLAZA } },
    vertexShader: `varying vec2 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uAccent; uniform float uB; uniform float uR; uniform float uW; uniform float uP; varying vec2 vW;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      void main(){
        vec2 cell = vW/uB; vec2 near = floor(cell+0.5)*uB;
        vec2 d = abs(vW - near);            // odległość od osi najbliższych ulic
        bool roadX = d.x < uR; bool roadZ = d.y < uR;
        bool walk = !roadX && !roadZ && (d.x < uR+uW || d.y < uR+uW);
        bool plaza = abs(vW.x) < uP && abs(vW.y) < uP;
        float n = hash(floor(vW*4.));
        vec3 col;
        if (plaza) {
          vec2 t = fract(vW/1.5); float grout = step(.94, max(t.x,t.y));
          float rr = length(vW);
          float ring = smoothstep(.12,0.,abs(fract(rr/3. - uTime*.08)-.5)-.38);
          col = vec3(.11,.1,.14) + n*.02 - grout*.05 + uAccent*ring*.18 + uAccent*smoothstep(uP, uP-.3, max(abs(vW.x),abs(vW.y)))*0.;
          float edge = smoothstep(.25, 0., abs(max(abs(vW.x),abs(vW.y)) - uP + .2));
          col += uAccent*edge*.8;
        } else if (roadX || roadZ) {
          col = vec3(.05,.05,.065) + n*.015;
          bool inter = roadX && roadZ;
          if (!inter) {
            float along = roadX ? vW.y : vW.x;
            float across = roadX ? d.x : d.y;
            // przerywana linia środkowa
            float dash = step(.5, fract(along/3.));
            col += vec3(.9,.75,.3) * step(across, .07) * dash * .8;
            // linie krawędzi
            col += vec3(.5) * step(abs(across - (uR-.25)), .04);
            // przejścia dla pieszych przy skrzyżowaniach
            float toInter = abs((roadX ? d.y : d.x));
            float zebra = step(uR+.2, toInter) * step(toInter, uR+1.6) * step(.5, fract(across/.6));
            col = mix(col, vec3(.75), zebra*.55);
          }
        } else if (walk) {
          vec2 t = fract(vW/1.2); float grout = step(.95, max(t.x,t.y));
          col = vec3(.16,.15,.19) + n*.02 - grout*.06;
          float curb = smoothstep(.12, 0., min(abs(d.x-uR), abs(d.y-uR)));
          col += uAccent*curb*.35;
        } else {
          col = vec3(.07,.065,.09) + n*.02; // pod budynkami / dziedzińce
        }
        float far = smoothstep(${(CITY_HALF + 18).toFixed(1)}, ${(CITY_HALF + 2).toFixed(1)}, max(abs(vW.x), abs(vW.y)));
        gl_FragColor = vec4(col*mix(.25, 1., far), 1.);
      }`,
  })
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(CITY_HALF * 4, CITY_HALF * 4), groundMat)
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  group.add(ground)
  const shadowGround = new THREE.Mesh(new THREE.PlaneGeometry(CITY_HALF * 2.4, CITY_HALF * 2.4), new THREE.ShadowMaterial({ opacity: 0.5 }))
  shadowGround.rotation.x = -Math.PI / 2
  shadowGround.position.y = 0.01
  shadowGround.receiveShadow = true
  group.add(shadowGround)
  disposables.push(groundMat, ground.geometry, shadowGround.geometry, shadowGround.material as THREE.Material)

  // ── materiały budynków ───────────────────────────────────
  const facades = [0x1b1a26, 0x221c2c, 0x141a24, 0x262330, 0x1a1f2a, 0x2a2026]
  const winTex = NEON.map((c) => windowTexture(rng, '#' + new THREE.Color(c).getHexString()))
  disposables.push(...winTex)
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x0e0d14, roughness: 0.9 })
  disposables.push(roofMat)

  const addBuilding = (cx: number, cz: number, w: number, d: number, h: number, collide = true) => {
    const wi = Math.floor(rng() * winTex.length)
    const mat = new THREE.MeshStandardMaterial({
      color: facades[Math.floor(rng() * facades.length)],
      roughness: 0.75,
      metalness: 0.2,
      emissive: 0xffffff,
      emissiveMap: winTex[wi],
      emissiveIntensity: 0.9 + rng() * 0.6,
      transparent: true,
    })
    const geo = buildingGeometry(w, h, d)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(cx, 0, cz)
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
    disposables.push(mat, geo)
    const mats: THREE.Material[] = [mat]

    // dach + gzyms w kolorze neonu
    const neonC = NEON[Math.floor(rng() * NEON.length)]
    const trimMat = new THREE.MeshBasicMaterial({ color: neonC, transparent: true })
    const trimGeo = new THREE.BoxGeometry(w + 0.15, 0.12, d + 0.15)
    const trim = new THREE.Mesh(trimGeo, trimMat)
    trim.position.set(cx, h, cz)
    group.add(trim)
    mats.push(trimMat)
    disposables.push(trimMat, trimGeo)

    // nadbudówka na dachu / antena
    if (h > 10 && rng() < 0.6) {
      const rw = w * (0.3 + rng() * 0.3)
      const rd = d * (0.3 + rng() * 0.3)
      const rh = 1 + rng() * 2.5
      const rgeo = new THREE.BoxGeometry(rw, rh, rd)
      rgeo.translate(0, rh / 2, 0)
      const r = new THREE.Mesh(rgeo, roofMat)
      r.position.set(cx + (rng() - 0.5) * (w - rw), h, cz + (rng() - 0.5) * (d - rd))
      r.castShadow = true
      group.add(r)
      disposables.push(rgeo)
      if (rng() < 0.5) {
        const ageo = new THREE.CylinderGeometry(0.04, 0.04, 3 + rng() * 3, 4)
        ageo.translate(0, ageo.parameters.height / 2, 0)
        const ant = new THREE.Mesh(ageo, roofMat)
        ant.position.set(r.position.x, h + rh, r.position.z)
        group.add(ant)
        const blinkMat = new THREE.MeshBasicMaterial({ color: 0xff2244 })
        const blinkGeo = new THREE.SphereGeometry(0.12, 8, 6)
        const blink = new THREE.Mesh(blinkGeo, blinkMat)
        blink.position.set(r.position.x, h + rh + ageo.parameters.height, r.position.z)
        group.add(blink)
        blinkers.push(blink)
        disposables.push(ageo, blinkMat, blinkGeo)
      }
    }

    // neonowy szyld na ścianie od strony ulicy
    if (rng() < 0.55 && h > 5) {
      const text = SIGNS[Math.floor(rng() * SIGNS.length)]
      const col = '#' + new THREE.Color(neonC).getHexString()
      const tex = signTexture(text, col)
      const vertical = rng() < 0.4
      const sw = vertical ? 1 : Math.min(w, d) * 0.8
      const sh = vertical ? 3.2 : sw / 4
      const smat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide })
      const sgeo = new THREE.PlaneGeometry(vertical ? sh : sw, vertical ? sw : sh)
      const sign = new THREE.Mesh(sgeo, smat)
      if (vertical) sign.rotation.z = Math.PI / 2
      // ściana zwrócona do najbliższej ulicy
      const nx = Math.round(cx / BLOCK) * BLOCK - cx
      const nz = Math.round(cz / BLOCK) * BLOCK - cz
      const y = 3 + rng() * Math.min(6, h - 4)
      if (Math.abs(nx) > Math.abs(nz)) {
        sign.position.set(cx + Math.sign(nx) * (w / 2 + 0.06), y, cz)
        sign.rotation.y = Math.sign(nx) * (Math.PI / 2)
      } else {
        sign.position.set(cx, y, cz + Math.sign(nz || 1) * (d / 2 + 0.06))
        sign.rotation.y = nz < 0 ? Math.PI : 0
      }
      group.add(sign)
      mats.push(smat)
      disposables.push(tex, smat, sgeo)
    }

    const box = { minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 }
    if (collide) boxes.push(box)
    buildings.push({ box, height: h, mats, fade: 1 })
  }
  const blinkers: THREE.Mesh[] = []

  // ── kwartały ─────────────────────────────────────────────
  const inner = BLOCK - 2 * (ROAD + WALK) // bok działki w kwartale
  const centers: number[] = []
  for (let c = -BLOCK * 2.5; c <= BLOCK * 2.5 + 0.01; c += BLOCK) centers.push(c)
  for (const bx of centers)
    for (const bz of centers) {
      if (Math.abs(bx) < PLAZA && Math.abs(bz) < PLAZA) continue // plac
      const edge = Math.abs(bx) > CITY_HALF - BLOCK / 2 || Math.abs(bz) > CITY_HALF - BLOCK / 2
      const distC = Math.hypot(bx, bz)
      const tall = 6 + distC * 0.25
      const layout = edge ? 0 : Math.floor(rng() * 4)
      const g = 0.4 // przerwa między budynkami
      const H = () => tall * (0.6 + rng() * 0.9) + (edge ? 10 : 0)
      if (layout === 0) addBuilding(bx, bz, inner, inner, H())
      else if (layout === 1) {
        const hw = (inner - g) / 2
        addBuilding(bx - hw / 2 - g / 2, bz, hw, inner, H())
        addBuilding(bx + hw / 2 + g / 2, bz, hw, inner, H())
      } else if (layout === 2) {
        const hw = (inner - g) / 2
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) addBuilding(bx + sx * (hw / 2 + g / 2), bz + sz * (hw / 2 + g / 2), hw, hw, H())
      } else {
        // dziedziniec z niskim budynkiem i wieżą
        addBuilding(bx - inner * 0.22, bz, inner * 0.56, inner, H() * 0.5)
        addBuilding(bx + inner * 0.3, bz + inner * 0.25, inner * 0.38, inner * 0.48, H() * 1.4)
      }
    }
  // pierścień wieżowców za granicą mapy (tło, bez kolizji)
  for (let i = -3; i <= 3; i++)
    for (const s of [-1, 1]) {
      const p = i * BLOCK
      const o = s * (CITY_HALF + 9)
      addBuilding(p, o, 10, 8, 26 + rng() * 22, false)
      addBuilding(o, p, 8, 10, 26 + rng() * 22, false)
    }

  // ── plac: monument + ławki ───────────────────────────────
  const monMat = new THREE.MeshStandardMaterial({ color: 0x2a2638, roughness: 0.4, metalness: 0.6 })
  const baseGeo = new THREE.CylinderGeometry(2.2, 2.6, 0.8, 8)
  baseGeo.translate(0, 0.4, 0)
  const base = new THREE.Mesh(baseGeo, monMat)
  base.castShadow = base.receiveShadow = true
  group.add(base)
  const crystalMat = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 1.8, transparent: true, opacity: 0.9 })
  const crystalGeo = new THREE.OctahedronGeometry(1, 0)
  const crystal = new THREE.Mesh(crystalGeo, crystalMat)
  crystal.scale.set(0.9, 2, 0.9)
  crystal.position.y = 3.6
  group.add(crystal)
  const ringGeo = new THREE.TorusGeometry(1.8, 0.05, 8, 48)
  const ringMat = new THREE.MeshBasicMaterial({ color: accent })
  const rings = [0, 1].map((i) => {
    const r = new THREE.Mesh(ringGeo, ringMat)
    r.position.y = 3.6
    r.rotation.x = Math.PI / 2 + i * 0.6
    group.add(r)
    return r
  })
  const plazaLight = new THREE.PointLight(accent, 40, 16)
  plazaLight.position.set(0, 4, 0)
  group.add(plazaLight)
  boxes.push({ minX: -2.4, maxX: 2.4, minZ: -2.4, maxZ: 2.4 })
  disposables.push(monMat, baseGeo, crystalMat, crystalGeo, ringGeo, ringMat)

  const benchGeo = new THREE.BoxGeometry(2.4, 0.5, 0.7)
  benchGeo.translate(0, 0.25, 0)
  const benchMat = new THREE.MeshStandardMaterial({ color: 0x3a3346, roughness: 0.8 })
  disposables.push(benchGeo, benchMat)
  for (const [x, z, ry] of [
    [-6, 0, Math.PI / 2],
    [6, 0, Math.PI / 2],
    [0, -6, 0],
    [0, 6, 0],
  ] as const) {
    const b = new THREE.Mesh(benchGeo, benchMat)
    b.position.set(x, 0, z)
    b.rotation.y = ry
    b.castShadow = true
    group.add(b)
    const hw = ry ? 0.35 : 1.2
    const hd = ry ? 1.2 : 0.35
    boxes.push({ minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd })
  }

  // ── latarnie (instancjonowane) ───────────────────────────
  const lampSpots: THREE.Vector3[] = []
  const lines: number[] = []
  for (let c = -BLOCK * 3; c <= BLOCK * 3 + 0.01; c += BLOCK) lines.push(c)
  for (const l of lines)
    for (let t = -CITY_HALF + 4; t <= CITY_HALF - 4; t += 7) {
      if (Math.abs(((t + BLOCK / 2) % BLOCK) - BLOCK / 2) < ROAD + 1) continue // nie na skrzyżowaniu
      if (Math.abs(l) > CITY_HALF) continue
      if (Math.abs(l) < PLAZA + 1 && Math.abs(t) < PLAZA + 1) continue // nie na placu
      const off = ROAD + 0.5
      lampSpots.push(new THREE.Vector3(l + off, 0, t), new THREE.Vector3(t, 0, l - off))
    }
  const poleGeo = new THREE.CylinderGeometry(0.07, 0.1, 4.2, 6)
  poleGeo.translate(0, 2.1, 0)
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2833, metalness: 0.6, roughness: 0.5 })
  const bulbGeo = new THREE.BoxGeometry(0.7, 0.12, 0.25)
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffe2b0 })
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, lampSpots.length)
  const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, lampSpots.length)
  const m4 = new THREE.Matrix4()
  lampSpots.forEach((p, i) => {
    m4.makeTranslation(p.x, 0, p.z)
    poles.setMatrixAt(i, m4)
    m4.makeTranslation(p.x, 4.2, p.z)
    bulbs.setMatrixAt(i, m4)
  })
  poles.castShadow = true
  group.add(poles, bulbs)
  disposables.push(poleGeo, poleMat, bulbGeo, bulbMat)
  // kilka prawdziwych świateł na skrzyżowaniach
  for (const [x, z] of [
    [BLOCK, BLOCK],
    [-BLOCK, BLOCK],
    [BLOCK, -BLOCK],
    [-BLOCK, -BLOCK],
    [BLOCK * 2, 0],
    [-BLOCK * 2, 0],
    [0, BLOCK * 2],
    [0, -BLOCK * 2],
  ]) {
    const l = new THREE.PointLight(NEON[Math.floor(rng() * NEON.length)], 22, 14)
    l.position.set(x, 5, z)
    group.add(l)
  }

  // ── zaparkowane auta (przeszkody) ────────────────────────
  const carBodyGeo = new THREE.BoxGeometry(1.8, 0.7, 4)
  carBodyGeo.translate(0, 0.55, 0)
  const carTopGeo = new THREE.BoxGeometry(1.6, 0.55, 2)
  carTopGeo.translate(0, 1.15, -0.2)
  const lightGeo = new THREE.BoxGeometry(1.5, 0.12, 0.05)
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff2d0 })
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2244 })
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x0b1220, metalness: 0.9, roughness: 0.1 })
  disposables.push(carBodyGeo, carTopGeo, lightGeo, headMat, tailMat, glassMat)
  const carColors = [0x8a1f2d, 0x1f3d8a, 0xd8d4c8, 0x222228, 0xc9a227, 0x2a7a5a]
  const carMats = carColors.map((c) => new THREE.MeshStandardMaterial({ color: c, metalness: 0.7, roughness: 0.35 }))
  disposables.push(...carMats)
  let cars = 0
  for (const l of lines) {
    if (Math.abs(l) > CITY_HALF - 2) continue
    for (let t = -CITY_HALF + 6; t <= CITY_HALF - 6; t += 5) {
      if (rng() > 0.16 || cars > 34) continue
      const toInter = Math.abs(((t + BLOCK / 2) % BLOCK + BLOCK) % BLOCK - BLOCK / 2)
      if (toInter < ROAD + 2.5) continue
      if (Math.abs(l) < PLAZA && Math.abs(t) < PLAZA + 2) continue
      const alongZ = rng() < 0.5
      const laneOff = (ROAD - 1.1) * (rng() < 0.5 ? 1 : -1)
      const x = alongZ ? l + laneOff : t
      const z = alongZ ? t : l + laneOff
      const car = new THREE.Group()
      const body = new THREE.Mesh(carBodyGeo, carMats[Math.floor(rng() * carMats.length)])
      const top = new THREE.Mesh(carTopGeo, glassMat)
      const head = new THREE.Mesh(lightGeo, headMat)
      head.position.set(0, 0.6, 2.01)
      const tail = new THREE.Mesh(lightGeo, tailMat)
      tail.position.set(0, 0.6, -2.01)
      body.castShadow = top.castShadow = true
      car.add(body, top, head, tail)
      car.position.set(x, 0, z)
      car.rotation.y = (alongZ ? 0 : Math.PI / 2) + (rng() < 0.5 ? Math.PI : 0)
      group.add(car)
      const hw = alongZ ? 0.95 : 2.05
      const hd = alongZ ? 2.05 : 0.95
      boxes.push({ minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd })
      cars++
    }
  }

  // ── billboardy na dachach (świecą, zmieniają kolor) ──────
  const boards: { mat: THREE.MeshBasicMaterial; phase: number }[] = []
  const boardGeo = new THREE.PlaneGeometry(6, 2.4)
  disposables.push(boardGeo)
  for (const b of buildings) {
    if (b.height < 14 || rng() > 0.25) continue
    const tex = signTexture(SIGNS[Math.floor(rng() * SIGNS.length)], '#' + new THREE.Color(NEON[Math.floor(rng() * NEON.length)]).getHexString())
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true })
    const board = new THREE.Mesh(boardGeo, mat)
    const cx = (b.box.minX + b.box.maxX) / 2
    const cz = (b.box.minZ + b.box.maxZ) / 2
    board.position.set(cx, b.height + 1.6, cz)
    board.rotation.y = rng() * Math.PI
    group.add(board)
    b.mats.push(mat)
    boards.push({ mat, phase: rng() * 10 })
    disposables.push(tex, mat)
  }

  // ── deszcz neonowego pyłu nad miastem ────────────────────
  const N = 600
  const rain = new Float32Array(N * 3)
  for (let i = 0; i < N; i++) rain.set([(rng() - 0.5) * 60, rng() * 20, (rng() - 0.5) * 60], i * 3)
  const rainGeo = new THREE.BufferGeometry()
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rain, 3))
  const rainMat = new THREE.PointsMaterial({ color: 0x9fdcff, size: 0.05, transparent: true, opacity: 0.55, depthWrite: false })
  const rainPts = new THREE.Points(rainGeo, rainMat)
  group.add(rainPts)
  disposables.push(rainGeo, rainMat)

  // ── API ──────────────────────────────────────────────────
  const onRoad = (x: number, z: number) => {
    const dx = Math.abs(x - Math.round(x / BLOCK) * BLOCK)
    const dz = Math.abs(z - Math.round(z / BLOCK) * BLOCK)
    return dx < ROAD - 0.6 || dz < ROAD - 0.6 || (Math.abs(x) < PLAZA - 1 && Math.abs(z) < PLAZA - 1)
  }
  const blocked = (x: number, z: number, r: number) => boxes.some((b) => x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r)

  return {
    boxes,
    spawnPoint(from, min, max) {
      const p = new THREE.Vector3()
      for (let i = 0; i < 60; i++) {
        const a = Math.random() * Math.PI * 2
        const r = min + Math.random() * (max - min)
        p.set(from.x + Math.cos(a) * r, 0, from.z + Math.sin(a) * r)
        if (Math.abs(p.x) > CITY_HALF - 2 || Math.abs(p.z) > CITY_HALF - 2) continue
        if (onRoad(p.x, p.z) && !blocked(p.x, p.z, 1.2)) return p
      }
      // awaryjnie: najbliższa ulica
      p.set(Math.round(from.x / BLOCK) * BLOCK + (Math.random() - 0.5) * 4, 0, from.z + (Math.random() < 0.5 ? -min : min))
      p.z = THREE.MathUtils.clamp(p.z, -CITY_HALF + 2, CITY_HALF - 2)
      return p
    },
    update(time, dt, player, camera) {
      groundMat.uniforms.uTime.value = time
      crystal.rotation.y = time * 0.8
      crystal.position.y = 3.6 + Math.sin(time * 1.5) * 0.25
      rings[0].rotation.z = time * 0.6
      rings[1].rotation.z = -time * 0.9
      plazaLight.intensity = 34 + Math.sin(time * 3) * 8
      for (const [i, b] of blinkers.entries()) b.visible = Math.sin(time * 3 + i) > 0
      for (const b of boards) b.mat.color.setHSL((time * 0.05 + b.phase) % 1, 0.3, 0.9)
      rainPts.position.set(player.x, 0, player.z)
      const at = rainGeo.getAttribute('position') as THREE.BufferAttribute
      for (let i = 0; i < N; i++) {
        let y = at.getY(i) - dt * 6
        if (y < 0) y += 20
        at.setY(i, y)
      }
      at.needsUpdate = true

      // budynki zasłaniające gracza przed kamerą robią się półprzezroczyste
      for (const b of buildings) {
        const bx = b.box
        const block =
          bx.maxZ > player.z - 0.5 &&
          bx.minZ < camera.z &&
          bx.minX < player.x + 2.2 &&
          bx.maxX > player.x - 2.2 &&
          b.height > 1.5 + (camera.y - 1.5) * Math.max(0, (bx.minZ - player.z) / Math.max(0.1, camera.z - player.z)) - 0.5
        const target = block ? 0.18 : 1
        b.fade += (target - b.fade) * Math.min(1, dt * 8)
        for (const m of b.mats) {
          m.opacity = b.fade
          m.depthWrite = b.fade > 0.95
        }
      }
    },
    drawMinimap(ctx, size, player, facing, enemies) {
      const R = 26 // promień widoku w metrach
      const s = size / (R * 2)
      ctx.clearRect(0, 0, size, size)
      ctx.save()
      ctx.beginPath()
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
      ctx.clip()
      ctx.fillStyle = 'rgba(12,10,20,0.85)'
      ctx.fillRect(0, 0, size, size)
      const tx = (x: number) => (x - player.x) * s + size / 2
      const tz = (z: number) => (z - player.z) * s + size / 2
      // ulice
      ctx.fillStyle = 'rgba(255,255,255,0.08)'
      for (let c = -BLOCK * 3; c <= BLOCK * 3; c += BLOCK) {
        ctx.fillRect(tx(c - ROAD), 0, ROAD * 2 * s, size)
        ctx.fillRect(0, tz(c - ROAD), size, ROAD * 2 * s)
      }
      // budynki
      ctx.fillStyle = 'rgba(160,150,200,0.45)'
      for (const b of boxes) ctx.fillRect(tx(b.minX), tz(b.minZ), (b.maxX - b.minX) * s, (b.maxZ - b.minZ) * s)
      // granica
      ctx.strokeStyle = '#' + accent.getHexString()
      ctx.lineWidth = 2
      ctx.strokeRect(tx(-CITY_HALF), tz(-CITY_HALF), CITY_HALF * 2 * s, CITY_HALF * 2 * s)
      // wrogowie
      ctx.fillStyle = '#ff3e5a'
      for (const e of enemies) {
        let ex = tx(e.x)
        let ez = tz(e.z)
        const dx = ex - size / 2
        const dz = ez - size / 2
        const dl = Math.hypot(dx, dz)
        const maxR = size / 2 - 5
        if (dl > maxR) {
          ex = size / 2 + (dx / dl) * maxR
          ez = size / 2 + (dz / dl) * maxR
        }
        ctx.beginPath()
        ctx.arc(ex, ez, 3, 0, Math.PI * 2)
        ctx.fill()
      }
      // gracz
      ctx.translate(size / 2, size / 2)
      ctx.rotate(-facing + Math.PI)
      ctx.fillStyle = '#fff'
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

/** Wypycha okrąg (p, r) z prostokątów; zwraca true, jeśli była kolizja. */
export function pushOutOfBoxes(p: THREE.Vector3, r: number, boxes: Box[]) {
  let hit = false
  for (const b of boxes) {
    const cx = THREE.MathUtils.clamp(p.x, b.minX, b.maxX)
    const cz = THREE.MathUtils.clamp(p.z, b.minZ, b.maxZ)
    const dx = p.x - cx
    const dz = p.z - cz
    const d2 = dx * dx + dz * dz
    if (d2 >= r * r) continue
    hit = true
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2)
      p.x = cx + (dx / d) * r
      p.z = cz + (dz / d) * r
    } else {
      // środek w środku prostokąta — wypchnij najkrótszą drogą
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
