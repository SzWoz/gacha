// ─────────────────────────────────────────────────────────────
//  Proceduralne potwory areny — zbudowane z prymitywów three.js,
//  z animacją w kodzie (chód, zamach, cios). Bez zewnętrznych assetów.
//    grunt  → „Skitter”    — sześcionożny pająkowaty pełzacz
//    spiker → „Shardwisp”  — lewitujący rdzeń z orbitą odłamków
//    brute  → „Juggernaut” — opancerzony kolos z wielkimi pięściami
//  Front potwora to +Z (silnik obraca root w stronę gracza).
// ─────────────────────────────────────────────────────────────

import * as THREE from 'three'

export type EnemyKind = 'grunt' | 'spiker' | 'brute'
export type EnemyState = 'spawn' | 'chase' | 'windup' | 'strike' | 'recover'

export interface RigInput {
  state: EnemyState
  /** postęp bieżącego stanu 0→1 (spawn / windup / strike / recover) */
  k: number
  moving: boolean
  time: number
  flash: boolean
}

export interface EnemyRig {
  root: THREE.Group
  update(dt: number, s: RigInput): void
  dispose(): void
}

// ── shared geometry cache ──

const G = new Map<string, THREE.BufferGeometry>()
const geo = (key: string, make: () => THREE.BufferGeometry) => {
  let g = G.get(key)
  if (!g) {
    g = make()
    G.set(key, g)
  }
  return g
}
export function disposeEnemyGeometries() {
  G.forEach((g) => g.dispose())
  G.clear()
}

const SPH = () => geo('sph', () => new THREE.SphereGeometry(1, 10, 8))
const ICO = () => geo('ico', () => new THREE.IcosahedronGeometry(1, 0))
const DODECA = () => geo('dodeca', () => new THREE.DodecahedronGeometry(1, 0))
const OCTA = () => geo('octa', () => new THREE.OctahedronGeometry(1, 0))
const CONE = () => geo('cone', () => new THREE.ConeGeometry(1, 1, 5))
const BOX = () => geo('box', () => new THREE.BoxGeometry(1, 1, 1))
const CYL = () => geo('cyl', () => new THREE.CylinderGeometry(1, 1, 1, 7))
const CYL_T = () => geo('cylT', () => new THREE.CylinderGeometry(1, 0.65, 1, 7)) // węższy na dole
const CYL_B = () => geo('cylB', () => new THREE.CylinderGeometry(0.7, 1, 1, 7)) // szerszy na dole
const TORUS = () => geo('torus', () => new THREE.TorusGeometry(1, 0.035, 5, 36))
const ICO_EDGES = () => geo('icoEdges', () => new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1, 1)))
const ICO1 = () => geo('ico1', () => new THREE.IcosahedronGeometry(1, 1))

// ── per-instance materials (osobne, bo każdy potwór błyska niezależnie) ──

class Mats {
  base: THREE.Color
  shell: THREE.MeshStandardMaterial
  plate: THREE.MeshStandardMaterial
  glow: THREE.MeshStandardMaterial
  halo: THREE.MeshBasicMaterial
  line: THREE.LineBasicMaterial
  eye: THREE.MeshBasicMaterial

  constructor(color: number) {
    this.base = new THREE.Color(color)
    this.shell = new THREE.MeshStandardMaterial({
      color: 0x14101b,
      roughness: 0.42,
      metalness: 0.65,
      flatShading: true,
      emissive: this.base,
      emissiveIntensity: 0.06,
    })
    this.plate = new THREE.MeshStandardMaterial({
      color: 0x2b2536,
      roughness: 0.28,
      metalness: 0.85,
      flatShading: true,
      emissive: this.base,
      emissiveIntensity: 0.03,
    })
    this.glow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: this.base, emissiveIntensity: 2, roughness: 1 })
    this.halo = new THREE.MeshBasicMaterial({
      color: this.base,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false,
    })
    this.line = new THREE.LineBasicMaterial({ color: this.base, transparent: true, opacity: 0.9 })
    this.eye = new THREE.MeshBasicMaterial({ color: 0xffffff })
  }

  /** pulse 0..1 — rozjarzenie przy zamachu */
  apply(flash: boolean, pulse: number) {
    if (flash) {
      this.shell.emissive.setRGB(1, 1, 1)
      this.shell.emissiveIntensity = 1.1
      this.plate.emissive.setRGB(1, 1, 1)
      this.plate.emissiveIntensity = 0.9
      this.glow.emissive.setRGB(1, 1, 1)
      this.glow.emissiveIntensity = 3
      this.line.color.setRGB(1, 1, 1)
      return
    }
    this.shell.emissive.copy(this.base)
    this.shell.emissiveIntensity = 0.06 + pulse * 0.18
    this.plate.emissive.copy(this.base)
    this.plate.emissiveIntensity = 0.03 + pulse * 0.2
    this.glow.emissive.copy(this.base)
    this.glow.emissiveIntensity = 1.8 + pulse * 3
    this.halo.opacity = 0.16 + pulse * 0.3
    this.line.color.copy(this.base).multiplyScalar(1 + pulse)
  }

  dispose() {
    this.shell.dispose()
    this.plate.dispose()
    this.glow.dispose()
    this.halo.dispose()
    this.line.dispose()
    this.eye.dispose()
  }
}

// ── helpers ──

type V3 = [number, number, number]

function part(
  parent: THREE.Object3D,
  g: THREE.BufferGeometry,
  m: THREE.Material,
  p?: V3,
  r?: V3,
  s?: V3 | number,
  shadow = false,
) {
  const o = new THREE.Mesh(g, m)
  if (p) o.position.set(...p)
  if (r) o.rotation.set(...r)
  if (s !== undefined) {
    if (typeof s === 'number') o.scale.setScalar(s)
    else o.scale.set(...s)
  }
  o.castShadow = shadow
  parent.add(o)
  return o
}

function pivot(parent: THREE.Object3D, p: V3 = [0, 0, 0]) {
  const g = new THREE.Group()
  g.position.set(...p)
  parent.add(g)
  return g
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const smooth = (x: number) => {
  const t = clamp01(x)
  return t * t * (3 - 2 * t)
}
const backOut = (x: number) => {
  const t = clamp01(x)
  const c = 1.9
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2)
}
const lerp = THREE.MathUtils.lerp
const damp = (cur: number, target: number, rate: number, dt: number) => lerp(cur, target, 1 - Math.exp(-rate * dt))

function spawnPose(root: THREE.Group, s: RigInput, sink: number, size = 1) {
  if (s.state === 'spawn') {
    root.scale.setScalar(Math.max(0.01, backOut(s.k)) * size)
    root.position.y = -(1 - smooth(s.k)) * sink
  } else {
    root.scale.setScalar(size)
    root.position.y = 0
  }
}

/** fazowy „puls” przy zamachu (miga szybciej im bliżej ciosu) */
const windupPulse = (s: RigInput) =>
  s.state === 'windup' ? 0.35 + 0.65 * s.k * (0.5 + 0.5 * Math.sin(s.time * (18 + 30 * s.k))) : s.state === 'strike' ? 1 : 0

// ───────────────────────── Skitter (grunt) ─────────────────────────

function createSkitter(color: number): EnemyRig {
  const M = new Mats(color)
  const root = new THREE.Group()
  const BODY_Y = 0.5
  const body = pivot(root, [0, BODY_Y, 0])

  // odwłok + tułów
  part(body, SPH(), M.shell, [0, 0.06, -0.28], [0.18, 0, 0], [0.36, 0.27, 0.46], true)
  part(body, SPH(), M.plate, [0, 0.1, 0.1], undefined, [0.27, 0.21, 0.27], true)
  // pancerne płytki na grzbiecie
  for (let i = 0; i < 3; i++) part(body, SPH(), M.plate, [0, 0.27 - i * 0.03, -0.1 - i * 0.2], [0.3, 0, 0], [0.22 - i * 0.03, 0.05, 0.13])
  // kolce grzbietowe ze świecącymi czubkami
  for (let i = 0; i < 3; i++) {
    const z = -0.05 - i * 0.22
    part(body, CONE(), M.plate, [0, 0.36 - i * 0.03, z], [-0.55, 0, 0], [0.055, 0.3 - i * 0.05, 0.055])
    part(body, SPH(), M.glow, [0, 0.5 - i * 0.05, z - 0.08], undefined, 0.03)
  }
  // świecące „żyły” po bokach odwłoku
  for (const x of [-0.2, 0.2]) part(body, BOX(), M.glow, [x, 0.13, -0.3], [0.2, 0, x > 0 ? -0.55 : 0.55], [0.022, 0.02, 0.48])
  // jarzący się worek z tyłu
  part(body, SPH(), M.glow, [0, 0.0, -0.62], undefined, 0.13)
  part(body, SPH(), M.halo, [0, 0.0, -0.62], undefined, 0.27)

  // głowa, oczy, żuwaczki
  const head = pivot(body, [0, 0.08, 0.38])
  part(head, SPH(), M.shell, undefined, undefined, [0.2, 0.15, 0.2], true)
  const eyes: V3[] = [
    [-0.08, 0.06, 0.15],
    [0.08, 0.06, 0.15],
    [-0.04, 0.12, 0.13],
    [0.04, 0.12, 0.13],
  ]
  for (const p of eyes) part(head, SPH(), M.glow, p, undefined, 0.035)
  const mandibles = [-1, 1].map((side) => {
    const p = pivot(head, [side * 0.09, -0.07, 0.13])
    part(p, CONE(), M.plate, [0, 0, 0.11], [Math.PI / 2, 0, 0], [0.035, 0.24, 0.035])
    return { p, side }
  })

  // nogi — 3 pary, każda: biodro (yaw) → udo (unoszenie) → kolano (zgięcie)
  const THIGH_UP = 0.85
  const KNEE_BEND = -2.15
  const legs: { hip: THREE.Group; thigh: THREE.Group; baseYaw: number; group: number; i: number; side: number }[] = []
  for (let i = 0; i < 3; i++) {
    for (const side of [-1, 1]) {
      const z = 0.2 - i * 0.2
      const hip = pivot(body, [side * 0.18, 0.02, z])
      const splay = (1 - i) * 0.6
      const baseYaw = side > 0 ? -splay : Math.PI + splay
      hip.rotation.y = baseYaw
      const thigh = pivot(hip)
      thigh.rotation.z = THIGH_UP
      part(thigh, CYL(), M.shell, [0.22, 0, 0], [0, 0, Math.PI / 2], [0.045, 0.44, 0.045], true)
      const knee = pivot(thigh, [0.44, 0, 0])
      knee.rotation.z = KNEE_BEND
      part(knee, SPH(), M.glow, undefined, undefined, 0.045)
      part(knee, CONE(), M.plate, [0.42, 0, 0], [0, 0, -Math.PI / 2], [0.05, 0.84, 0.05], true)
      legs.push({ hip, thigh, baseYaw, group: (i + (side > 0 ? 1 : 0)) % 2, i, side })
    }
  }

  let phase = 0
  let pitch = 0
  let gait = 0
  return {
    root,
    update(dt, s) {
      spawnPose(root, s, 0.8, 1.3)
      gait = damp(gait, s.moving && s.state === 'chase' ? 1 : 0, 10, dt)
      phase += dt * 15 * gait
      const e = smooth(s.k)

      // pochylenie ciała
      let targetPitch = 0
      if (s.state === 'windup') targetPitch = -0.65 * e
      else if (s.state === 'strike') targetPitch = lerp(-0.65, 0.4, e)
      else if (s.state === 'recover') targetPitch = lerp(0.4, 0, e)
      pitch = s.state === 'strike' ? targetPitch : damp(pitch, targetPitch, 14, dt)
      body.rotation.x = pitch
      body.position.y = BODY_Y + Math.abs(Math.sin(phase)) * 0.04 * gait + Math.sin(s.time * 3) * 0.012
      body.rotation.z = Math.sin(phase) * 0.05 * gait

      // nogi — chód trójpodporowy
      const rear = s.state === 'windup' ? e : s.state === 'strike' ? 1 - e : 0
      for (const l of legs) {
        const ph = phase + l.group * Math.PI
        l.hip.rotation.y = l.baseYaw + Math.sin(ph) * 0.32 * gait * l.side
        let lift = Math.max(0, Math.cos(ph)) * 0.4 * gait
        if (l.i === 0) lift += rear * 0.9 // przednie nogi w górę przy zamachu
        l.thigh.rotation.z = THIGH_UP + lift
      }

      // żuwaczki
      const open = s.state === 'windup' ? 0.25 + 0.6 * e : s.state === 'strike' ? 0.85 * (1 - e) : 0.12 + Math.sin(s.time * 9) * 0.1
      for (const m of mandibles) m.p.rotation.y = -m.side * open

      M.apply(s.flash, windupPulse(s))
    },
    dispose: () => M.dispose(),
  }
}

// ───────────────────────── Shardwisp (spiker) ─────────────────────────

function createShardwisp(color: number): EnemyRig {
  const M = new Mats(color)
  const root = new THREE.Group()
  const HOVER = 1.0
  const float = pivot(root, [0, HOVER, 0])

  // rdzeń: ciemna skorupa z siatką świecących krawędzi + jądro w środku
  const core = pivot(float)
  part(core, ICO1(), M.shell, undefined, undefined, 0.27, true)
  const edges = new THREE.LineSegments(ICO_EDGES(), M.line)
  edges.scale.setScalar(0.285)
  core.add(edges)
  part(core, SPH(), M.halo, undefined, undefined, 0.36)
  // „oko” — pionowa szczelina z przodu
  part(float, BOX(), M.eye, [0, 0.02, 0.27], undefined, [0.035, 0.16, 0.02])
  part(float, BOX(), M.glow, [0, 0.02, 0.265], undefined, [0.09, 0.2, 0.01])

  // klatka z trzech pierścieni
  const rings = [0, 1, 2].map((i) => {
    const r = part(float, TORUS(), M.plate, undefined, [i * 1.05, i * 0.7, 0], 0.4 + i * 0.05)
    return r
  })

  // orbita odłamków
  const orbit = pivot(float)
  orbit.rotation.x = 0.35
  const SHARDS = 7
  const shards = Array.from({ length: SHARDS }, (_, i) => {
    const arm = pivot(orbit)
    arm.rotation.y = (i / SHARDS) * Math.PI * 2
    const holder = pivot(arm, [0.62, 0, 0])
    part(holder, OCTA(), i % 2 ? M.glow : M.plate, undefined, [0, 0, -Math.PI / 2], [0.055, 0.26, 0.055], i % 2 === 0)
    return holder
  })

  // ogon z segmentów
  const tail = Array.from({ length: 6 }, (_, i) => {
    const sc = 0.12 * (1 - i * 0.13)
    return part(float, i === 5 ? OCTA() : ICO(), i === 5 ? M.glow : M.shell, [0, -0.1 - i * 0.04, -0.3 - i * 0.15], undefined, sc)
  })

  let spin = 0
  let radius = 0.62
  let tilt = 0
  return {
    root,
    update(dt, s) {
      spawnPose(root, s, 0, 1.15)
      const e = smooth(s.k)

      // odłamki: zaciskają się przy zamachu, wybuchają przy ciosie
      let targetR = 0.62 + Math.sin(s.time * 2.5) * 0.04
      let spinSpeed = 2
      if (s.state === 'windup') {
        targetR = 0.62 - 0.3 * e
        spinSpeed = 2 + 16 * e
      } else if (s.state === 'strike') {
        targetR = lerp(0.32, 1.0, e)
        spinSpeed = 14
      } else if (s.state === 'recover') {
        targetR = lerp(1.0, 0.62, e)
        spinSpeed = lerp(10, 2, e)
      }
      radius = s.state === 'strike' ? targetR : damp(radius, targetR, 12, dt)
      spin += dt * spinSpeed
      orbit.rotation.y = spin
      for (const h of shards) {
        h.position.x = radius
        h.rotation.x += dt * 4
      }

      // pierścienie klatki
      rings[0].rotation.x += dt * 1.3
      rings[1].rotation.y += dt * 1.7
      rings[2].rotation.z += dt * 2.1
      core.rotation.y += dt * 0.8
      core.rotation.x += dt * 0.5

      // unoszenie + pochylenie w ruchu / przy ataku
      let targetTilt = s.moving && s.state === 'chase' ? 0.3 : 0
      if (s.state === 'windup') targetTilt = -0.45 * e
      if (s.state === 'strike') targetTilt = 0.55
      tilt = damp(tilt, targetTilt, 10, dt)
      float.rotation.x = tilt
      float.position.y = HOVER + Math.sin(s.time * 3.2) * 0.1 + (s.state === 'windup' ? 0.25 * e : 0)
      const pulse = 1 + (s.state === 'windup' ? 0.15 * e : 0)
      core.scale.setScalar(pulse)

      // ogon faluje
      for (let i = 0; i < tail.length; i++) {
        tail[i].position.x = Math.sin(s.time * 6 - i * 0.8) * 0.05 * (i + 1)
        tail[i].position.y = -0.1 - i * 0.04 + Math.cos(s.time * 5 - i * 0.7) * 0.03 * i
        tail[i].rotation.y += dt * 3
      }

      M.apply(s.flash, windupPulse(s))
    },
    dispose: () => M.dispose(),
  }
}

// ───────────────────────── Juggernaut (brute) ─────────────────────────

function createJuggernaut(color: number): EnemyRig {
  const M = new Mats(color)
  const root = new THREE.Group()
  const HIP_Y = 1.05
  const hips = pivot(root, [0, HIP_Y, 0])
  part(hips, SPH(), M.plate, undefined, undefined, [0.45, 0.25, 0.35], true)

  // nogi
  const legs = [-1, 1].map((side) => {
    const thigh = pivot(hips, [side * 0.38, -0.05, 0])
    part(thigh, CYL_T(), M.shell, [0, -0.28, 0], undefined, [0.19, 0.58, 0.19], true)
    const knee = pivot(thigh, [0, -0.55, 0])
    part(knee, SPH(), M.plate, [0, 0, 0.1], undefined, [0.16, 0.16, 0.12])
    part(knee, CYL_B(), M.plate, [0, -0.25, 0], undefined, [0.19, 0.5, 0.19], true)
    part(knee, BOX(), M.shell, [0, -0.5, 0.09], undefined, [0.32, 0.12, 0.46], true)
    return { thigh, knee, side }
  })

  // tułów (zgarbiony)
  const torso = pivot(hips, [0, 0.12, 0])
  const HUNCH = 0.28
  torso.rotation.x = HUNCH
  part(torso, DODECA(), M.shell, [0, 0.62, 0], undefined, [0.78, 0.62, 0.56], true)
  part(torso, SPH(), M.plate, [0, 0.2, 0.05], undefined, [0.5, 0.35, 0.4], true)
  // jądro w piersi + pęknięcia
  const coreMesh = part(torso, SPH(), M.glow, [0, 0.62, 0.5], undefined, 0.17)
  part(torso, SPH(), M.halo, [0, 0.62, 0.5], undefined, 0.34)
  const cracks: [V3, number][] = [
    [[0.25, 0.8, 0.45], 0.7],
    [[-0.28, 0.75, 0.44], -0.8],
    [[0.18, 0.4, 0.5], -0.4],
    [[-0.15, 0.42, 0.5], 0.5],
  ]
  for (const [p, rz] of cracks) part(torso, BOX(), M.glow, p, [0, 0, rz], [0.025, 0.28, 0.02])
  // naramienniki z kolcami
  for (const side of [-1, 1]) {
    part(torso, SPH(), M.plate, [side * 0.78, 0.98, 0], [0, 0, side * -0.3], [0.38, 0.27, 0.38], true)
    for (let i = 0; i < 3; i++) {
      part(torso, CONE(), M.plate, [side * (0.7 + i * 0.12), 1.2 - i * 0.04, -0.12 + i * 0.12], [0, 0, side * -(0.4 + i * 0.25)], [0.06, 0.32, 0.06])
    }
  }
  // kryształy na plecach
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * 0.24
    part(torso, CONE(), M.glow, [x, 0.95 - Math.abs(x) * 0.4, -0.42], [-0.7, 0, x * 0.6], [0.08, 0.5 - Math.abs(x) * 0.3, 0.08])
  }
  part(torso, SPH(), M.halo, [0, 0.95, -0.45], undefined, [0.55, 0.3, 0.2])

  // głowa z wizjerem i rogami
  const head = pivot(torso, [0, 0.98, 0.45])
  part(head, BOX(), M.shell, undefined, [0.1, 0, 0], [0.34, 0.27, 0.32], true)
  part(head, BOX(), M.eye, [0, 0.02, 0.165], undefined, [0.24, 0.035, 0.01])
  part(head, BOX(), M.glow, [0, 0.02, 0.16], undefined, [0.3, 0.08, 0.01])
  for (const side of [-1, 1]) part(head, CONE(), M.plate, [side * 0.17, 0.17, -0.04], [-0.5, 0, side * -0.5], [0.05, 0.3, 0.05])

  // ręce z wielkimi pięściami i pazurami
  const arms = [-1, 1].map((side) => {
    const shoulder = pivot(torso, [side * 0.86, 0.85, 0])
    part(shoulder, CYL(), M.shell, [0, -0.3, 0], undefined, [0.15, 0.55, 0.15], true)
    const elbow = pivot(shoulder, [0, -0.6, 0])
    part(elbow, SPH(), M.glow, undefined, undefined, 0.09)
    part(elbow, CYL_B(), M.plate, [0, -0.3, 0], undefined, [0.25, 0.6, 0.25], true)
    part(elbow, DODECA(), M.shell, [0, -0.7, 0], undefined, 0.3, true)
    for (let i = 0; i < 3; i++) {
      const a = (i - 1) * 0.5
      part(elbow, CONE(), M.glow, [Math.sin(a) * 0.17, -0.95, Math.cos(a) * 0.12], [Math.PI, 0, a * 0.4], [0.05, 0.3, 0.05])
    }
    return { shoulder, elbow, side }
  })

  const REST_ELBOW = -0.45
  let phase = 0
  let gait = 0
  let lift = 0 // 0 = spoczynek, 1 = ręce nad głową, -1 = uderzenie w ziemię
  return {
    root,
    update(dt, s) {
      spawnPose(root, s, 1.4)
      gait = damp(gait, s.moving && s.state === 'chase' ? 1 : 0, 6, dt)
      phase += dt * 6.5 * gait
      const e = smooth(s.k)

      let targetLift = 0
      if (s.state === 'windup') targetLift = e
      else if (s.state === 'strike') targetLift = lerp(1, -1, e)
      else if (s.state === 'recover') targetLift = lerp(-1, 0, e)
      lift = s.state === 'strike' ? targetLift : damp(lift, targetLift, 10, dt)

      // tułów: odchyla się przy zamachu, pochyla przy uderzeniu
      torso.rotation.x = HUNCH - Math.max(0, lift) * 0.4 + Math.max(0, -lift) * 0.4
      torso.rotation.z = Math.sin(phase) * 0.06 * gait
      torso.rotation.y = Math.sin(phase) * 0.08 * gait
      hips.position.y = HIP_Y + Math.abs(Math.cos(phase)) * 0.06 * gait - Math.max(0, -lift) * 0.18 + Math.sin(s.time * 2) * 0.015

      // nogi
      for (const l of legs) {
        const sw = Math.sin(phase) * l.side
        l.thigh.rotation.x = sw * 0.5 * gait + Math.max(0, -lift) * -0.35
        l.knee.rotation.x = Math.max(0, -Math.sin(phase) * l.side) * 0.8 * gait + Math.max(0, -lift) * 0.5
      }

      // ręce
      for (const a of arms) {
        const swing = -Math.sin(phase) * a.side * 0.35 * gait
        // lift>0: nad głową (-2.7), lift<0: uderzenie przed siebie (-0.9)
        const up = lift >= 0 ? lerp(swing, -2.7, lift) : lerp(swing, -0.95, -lift)
        a.shoulder.rotation.x = up
        a.shoulder.rotation.z = a.side * (0.22 - Math.max(0, lift) * 0.12)
        a.elbow.rotation.x = REST_ELBOW * (1 - Math.max(0, lift) * 0.6) + Math.sin(s.time * 2 + a.side) * 0.04
      }

      const pulse = windupPulse(s)
      coreMesh.scale.setScalar(0.17 * (1 + pulse * 0.35))
      M.apply(s.flash, pulse)
    },
    dispose: () => M.dispose(),
  }
}

export function createEnemyRig(kind: EnemyKind, color: number): EnemyRig {
  if (kind === 'grunt') return createSkitter(color)
  if (kind === 'spiker') return createShardwisp(color)
  return createJuggernaut(color)
}
