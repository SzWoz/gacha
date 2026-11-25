import * as THREE from 'three'
import type { RevealStyle } from './weapons'

// ─────────────────────────────────────────────────────────────
//  Choreografie wejścia postaci. Każdy styl dostaje kontekst sceny
//  (postać w `holder`/`spin`, kamera, helpery efektów) i przez
//  `duration` sekund steruje kamerą, akrobacjami i efektami. Na końcu
//  ląduje w pozie FINAL — dalej przejmuje spokojna pętla idle.
// ─────────────────────────────────────────────────────────────

export interface RevealCtx {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  /** pozycja postaci: stopy na y=0, wysokość ~1.8, patrzy w +Z */
  holder: THREE.Group
  /** obrót wokół środka ciała (y≈0.9) — salta i piruety */
  spin: THREE.Group
  color: THREE.Color
  color2: THREE.Color
  rankS: boolean
  /** 1 / -1 — kierunek najazdu kamery, różny per postać */
  side: 1 | -1
  rng: () => number
  cam: { pos: THREE.Vector3; look: THREE.Vector3; fov: number }
  /** 'up' — widać y <= h (rośnie od stóp), 'down' — widać y >= h (od głowy w dół) */
  reveal(h: number, mode?: 'up' | 'down'): void
  fx(obj: THREE.Object3D, life: number, update?: (k: number, dt: number) => void): void
  shake(a: number): void
  flash(a: number, color?: THREE.ColorRepresentation): void
  act(kind: 'light' | 'heavy', dur: number, combo?: number): void
  /** spowolnienie czasu: przez `dur` prawdziwych sekund czas leci x`scale` */
  slowmo(dur: number, scale: number): void
  /** klatka uderzenia w stylu anime (czarno-białe odwrócenie) + aberracja */
  impact(strength?: number): void
  /** linie prędkości na ekranie */
  speedlines(dur: number): void
  /** błysk światła punktowego w scenie */
  light(pos: THREE.Vector3, color: THREE.Color, intensity: number): void
}

export interface Choreo {
  duration: number
  /** moment „wow” — wtedy wjeżdża tekst z nazwą */
  peak: number
  update(t: number, dt: number): void
}

// ── matma ───────────────────────────────────────────────────
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a))
const easeOut = (t: number) => 1 - (1 - t) ** 3
const easeIn = (t: number) => t * t * t
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
const TAU = Math.PI * 2

interface Pose {
  a: number // kąt orbity (0 = przód postaci)
  r: number
  h: number
  ly: number // wysokość punktu, w który patrzy kamera
  fov: number
}
export const FINAL = (side: number): Pose => ({ a: side * 0.32, r: 3.9, h: 1.25, ly: 1.0, fov: 40 })
const mix = (p: Pose, q: Pose, k: number): Pose => ({
  a: p.a + (q.a - p.a) * k,
  r: p.r + (q.r - p.r) * k,
  h: p.h + (q.h - p.h) * k,
  ly: p.ly + (q.ly - p.ly) * k,
  fov: p.fov + (q.fov - p.fov) * k,
})
function setCam(ctx: RevealCtx, p: Pose, followY = 0) {
  ctx.cam.pos.set(Math.sin(p.a) * p.r, p.h + followY * 0.6, Math.cos(p.a) * p.r)
  ctx.cam.look.set(0, p.ly + followY, 0)
  ctx.cam.fov = p.fov
}

/** Odpala każdy callback raz, gdy czas go minie. */
function timeline(events: [number, () => void][]) {
  const fired = new Set<number>()
  return (t: number) => {
    events.forEach(([at, fn], i) => {
      if (t >= at && !fired.has(i)) {
        fired.add(i)
        fn()
      }
    })
  }
}

/**
 * Skok po paraboli z saltami (flips, oś X) i piruetami (twists, oś Y).
 * Wołaj co klatkę w kolejności chronologicznej — późniejszy skok nadpisuje wcześniejszy.
 */
function jump(ctx: RevealCtx, t: number, t0: number, t1: number, height: number, flips = 0, twists = 0, baseY = 0) {
  if (t < t0) return
  const k = span(t, t0, t1)
  ctx.holder.position.y = baseY + 4 * height * k * (1 - k)
  const r = easeInOut(k)
  ctx.spin.rotation.x = flips * TAU * r
  ctx.spin.rotation.y = twists * TAU * r
}

const add = (o: THREE.Color, k = 1) => new THREE.MeshBasicMaterial({ color: o.clone().multiplyScalar(k), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
const WHITE = new THREE.Color(1, 1, 1)

// ── klocki efektów ──────────────────────────────────────────

/** Iskry / płatki / łuski: punkty z prędkością i grawitacją. */
function sparks(ctx: RevealCtx, pos: THREE.Vector3, n: number, color: THREE.Color, speed = 6, gravity = 9, life = 0.9, size = 0.07, spread = 0, sphere = false) {
  const geo = new THREE.BufferGeometry()
  const arr = new Float32Array(n * 3)
  const vel: THREE.Vector3[] = []
  for (let i = 0; i < n; i++) {
    arr.set([pos.x + (ctx.rng() - 0.5) * spread, pos.y + (ctx.rng() - 0.5) * spread, pos.z + (ctx.rng() - 0.5) * spread], i * 3)
    const d = sphere ? v3(ctx.rng() - 0.5, ctx.rng() - 0.5, ctx.rng() - 0.5) : v3(ctx.rng() - 0.5, ctx.rng() - 0.3, ctx.rng() - 0.5)
    vel.push(d.normalize().multiplyScalar(speed * (sphere ? 0.85 + ctx.rng() * 0.3 : 0.4 + ctx.rng() * 0.8)))
  }
  geo.setAttribute('position', new THREE.BufferAttribute(arr, 3))
  const mat = new THREE.PointsMaterial({ color, size, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
  const pts = new THREE.Points(geo, mat)
  ctx.fx(pts, life, (k, dt) => {
    const at = geo.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < n; i++) {
      vel[i].y -= gravity * dt
      vel[i].multiplyScalar(1 - dt * 1.2)
      at.setXYZ(i, at.getX(i) + vel[i].x * dt, Math.max(0.02, at.getY(i) + vel[i].y * dt), at.getZ(i) + vel[i].z * dt)
    }
    at.needsUpdate = true
    mat.opacity = 1 - k * k
  })
}

/** Fajerwerk na niebie: kula iskier + błysk. */
function firework(ctx: RevealCtx, pos: THREE.Vector3, color: THREE.Color) {
  sparks(ctx, pos, 90, color, 4.5, 1.4, 1.5, 0.08, 0, true)
  sparks(ctx, pos, 30, WHITE, 2.5, 1.2, 0.9, 0.06, 0, true)
  ctx.light(pos, color, 25)
}

/** Fala uderzeniowa: pierścień na ziemi (albo pionowy, zwrócony do kamery). */
function shockwave(ctx: RevealCtx, pos: THREE.Vector3, radius: number, color: THREE.Color, life = 0.6, vertical = false, thickness = 0.12) {
  const mat = add(color, 1.6)
  const ring = new THREE.Mesh(new THREE.RingGeometry(1 - thickness, 1, 64), mat)
  ring.position.copy(pos)
  if (vertical) ring.quaternion.copy(ctx.camera.quaternion)
  else ring.rotation.x = -Math.PI / 2
  ctx.fx(ring, life, (k) => {
    ring.scale.setScalar(0.05 + easeOut(k) * radius)
    mat.opacity = 1 - k
  })
}

/** WYBUCH: kula ognia, powłoka, fale, iskry, odłamki, światło, flash, shake, klatka uderzenia. */
function explosion(ctx: RevealCtx, pos: THREE.Vector3, size: number, color: THREE.Color, color2 = ctx.color2) {
  const coreMat = add(WHITE, 2.2)
  const core = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), coreMat)
  core.position.copy(pos)
  ctx.fx(core, 0.35, (k) => {
    core.scale.setScalar(0.05 + easeOut(k) * size * 0.7)
    coreMat.opacity = 1 - k
  })
  const shellMat = add(color, 1.6)
  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 3), shellMat)
  shell.position.copy(pos)
  ctx.fx(shell, 0.7, (k) => {
    shell.scale.setScalar(0.1 + easeOut(k) * size * 1.2)
    shell.rotation.y = k * 2
    shellMat.opacity = 0.7 * (1 - k) ** 2
  })
  // smugi ognia wylatujące promieniście
  for (let i = 0; i < 10; i++) {
    const dir = v3(ctx.rng() - 0.5, ctx.rng() * 0.8, ctx.rng() - 0.5).normalize()
    tracer(ctx, pos, pos.clone().addScaledVector(dir, size * (1.8 + ctx.rng() * 1.2)), i % 2 ? color : color2, 0.35)
  }
  shockwave(ctx, v3(pos.x, 0.05, pos.z), size * 3.5, color, 0.8, false, 0.15)
  shockwave(ctx, pos, size * 2.2, color2, 0.45, true, 0.2)
  sparks(ctx, pos, 110, color2, size * 7, 5, 1.2, 0.08)
  debris(ctx, pos, 24, color, { speed: size * 5, up: size * 5, emissive: true, life: 1.4 })
  ctx.light(pos, color, 80 * size)
  ctx.flash(0.9)
  ctx.shake(0.9 * Math.min(1.5, size))
  ctx.impact(1)
}

/** Półksiężyc cięcia wokół postaci. */
function slashArc(ctx: RevealCtx, o: { y: number; r: number; rotY?: number; rotZ?: number; arc?: number; color: THREE.Color; life?: number; width?: number }) {
  const arc = o.arc ?? Math.PI * 1.1
  const mat = add(o.color, 2)
  const mesh = new THREE.Mesh(new THREE.RingGeometry(o.r * (1 - (o.width ?? 0.22)), o.r, 64, 1, 0, arc), mat)
  mesh.rotation.x = -Math.PI / 2
  const g = new THREE.Group()
  g.add(mesh)
  g.position.y = o.y
  g.rotation.set(0, o.rotY ?? 0, o.rotZ ?? 0)
  const life = o.life ?? 0.35
  ctx.fx(g, life, (k) => {
    mesh.rotation.z = -arc / 2 + Math.PI / 2 + (1 - easeOut(k)) * -1.2 // wymach
    g.scale.setScalar(0.85 + k * 0.3)
    mat.opacity = k < 0.2 ? k * 5 : 1 - (k - 0.2) / 0.8
  })
}

/** Cienka linia światła przez cały ekran (zwrócona do kamery). */
function screenSlash(ctx: RevealCtx, tilt: number, life = 0.55) {
  const core = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.035), add(WHITE, 2))
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.1), add(ctx.color, 1.4))
  const g = new THREE.Group()
  g.add(glow, core)
  const dir = ctx.cam.look.clone().sub(ctx.cam.pos).normalize()
  g.position.copy(ctx.cam.pos).addScaledVector(dir, 1.4)
  g.quaternion.copy(ctx.camera.quaternion)
  g.rotateZ(tilt)
  ctx.fx(g, life, (k) => {
    const grow = easeOut(span(k, 0, 0.25))
    g.scale.set(0.01 + grow * 6, 1 - span(k, 0.4, 1), 1)
    ;(glow.material as THREE.MeshBasicMaterial).opacity = 1 - k
    ;(core.material as THREE.MeshBasicMaterial).opacity = 1 - span(k, 0.5, 1)
  })
}

/** Świetlny pocisk od A do B. */
function tracer(ctx: RevealCtx, from: THREE.Vector3, to: THREE.Vector3, color: THREE.Color, life = 0.16, thick = 0.012) {
  const len = from.distanceTo(to)
  const mat = add(color, 2)
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(thick, thick, 1, 6), mat)
  mesh.geometry.translate(0, 0.5, 0)
  const g = new THREE.Group()
  g.position.copy(from)
  g.lookAt(to)
  mesh.rotation.x = Math.PI / 2
  g.add(mesh)
  ctx.fx(g, life, (k) => {
    const head = easeOut(clamp01(k * 1.6))
    const tail = clamp01(k * 1.6 - 0.5)
    mesh.position.z = tail * len
    mesh.scale.y = Math.max(0.001, (head - tail) * len)
    mat.opacity = 1 - span(k, 0.7, 1)
  })
}

/** Odłamki (kostki / trójkąty) lecące z grawitacją i odbijające się od ziemi. */
function debris(ctx: RevealCtx, center: THREE.Vector3, n: number, color: THREE.Color, o: { speed?: number; up?: number; geo?: THREE.BufferGeometry; life?: number; emissive?: boolean } = {}) {
  const geo = o.geo ?? new THREE.BoxGeometry(0.12, 0.12, 0.12)
  const mat = o.emissive
    ? add(color, 1.3)
    : new THREE.MeshStandardMaterial({ color: 0x1b1726, emissive: color, emissiveIntensity: 0.6, roughness: 0.6, transparent: true })
  const inst = new THREE.InstancedMesh(geo, mat, n)
  const st = Array.from({ length: n }, () => ({
    p: center.clone().add(v3((ctx.rng() - 0.5) * 0.8, ctx.rng() * 0.3, (ctx.rng() - 0.5) * 0.8)),
    v: v3(ctx.rng() - 0.5, 0, ctx.rng() - 0.5).normalize().multiplyScalar((o.speed ?? 6) * (0.4 + ctx.rng())).setY((o.up ?? 6) * (0.4 + ctx.rng())),
    r: v3(ctx.rng(), ctx.rng(), ctx.rng()).multiplyScalar(10),
    s: 0.5 + ctx.rng() * 1.3,
  }))
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  let time = 0
  ctx.fx(inst, o.life ?? 1.6, (k, dt) => {
    time += dt
    for (let i = 0; i < n; i++) {
      const d = st[i]
      d.v.y -= 14 * dt
      d.p.addScaledVector(d.v, dt)
      if (d.p.y < 0.05) {
        d.p.y = 0.05
        d.v.y *= -0.35
        d.v.x *= 0.7
        d.v.z *= 0.7
      }
      e.set(d.r.x * time, d.r.y * time, d.r.z * time)
      q.setFromEuler(e)
      const s = d.s * (1 - span(k, 0.7, 1))
      m4.compose(d.p, q, v3(s, s, s))
      inst.setMatrixAt(i, m4)
    }
    inst.instanceMatrix.needsUpdate = true
  })
}

/** Smuga-duch w miejscu postaci (do doskoków i skoków). */
function ghost(ctx: RevealCtx, pos: THREE.Vector3, color: THREE.Color, rotX = 0) {
  const mat = add(color, 0.9)
  const g = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.1, 4, 10), mat)
  g.position.copy(pos).add(v3(0, 0.9, 0))
  g.rotation.x = rotX
  ctx.fx(g, 0.28, (k) => {
    mat.opacity = 0.55 * (1 - k)
    g.scale.set(1 - k * 0.5, 1, 1 - k * 0.5)
  })
}

/** Zostawia smugi-duchy za postacią w trakcie ruchu. */
function trail(ctx: RevealCtx, color: THREE.Color, every = 0.03) {
  let last = -1
  return (t: number, active: boolean) => {
    if (!active || t - last < every) return
    last = t
    ghost(ctx, ctx.holder.position.clone(), color, ctx.spin.rotation.x)
  }
}

/** Świetlna kolumna. */
function pillar(ctx: RevealCtx, radius: number, height: number, color: THREE.Color, life: number, fadeIn = 0.15) {
  const mat = add(color, 1.3)
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 32, 1, true), mat)
  mesh.position.y = height / 2
  const core = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.35, radius * 0.35, height, 16, 1, true), add(WHITE, 1.5))
  mesh.add(core)
  ctx.fx(mesh, life, (k) => {
    const o = k < fadeIn ? k / fadeIn : 1 - span(k, 0.6, 1)
    mat.opacity = o * 0.55
    ;(core.material as THREE.MeshBasicMaterial).opacity = o * 0.8
    mesh.scale.set(1 + k * 0.4, 1, 1 + k * 0.4)
  })
}

/** Krąg run: pierścienie + kreski, obracające się. */
function runeCircle(ctx: RevealCtx, radius: number, spin: number, life: number, rise?: { at: number; to: number }) {
  const g = new THREE.Group()
  const mat = add(ctx.color, 1.5)
  const ring1 = new THREE.Mesh(new THREE.RingGeometry(radius * 0.96, radius, 96), mat)
  const ring2 = new THREE.Mesh(new THREE.RingGeometry(radius * 0.78, radius * 0.8, 96), mat)
  g.add(ring1, ring2)
  const ticks = 18
  const tickGeo = new THREE.PlaneGeometry(radius * 0.05, radius * 0.12)
  for (let i = 0; i < ticks; i++) {
    const a = (i / ticks) * TAU
    const tk = new THREE.Mesh(tickGeo, mat)
    tk.position.set(Math.cos(a) * radius * 0.88, Math.sin(a) * radius * 0.88, 0)
    tk.rotation.z = a + Math.PI / 2
    g.add(tk)
  }
  const pts: THREE.Vector3[] = []
  const sides = 6
  for (let i = 0; i <= sides; i++) {
    const a = ((i * 2) % sides) * (TAU / sides) + Math.PI / 2
    pts.push(v3(Math.cos(a) * radius * 0.76, Math.sin(a) * radius * 0.76, 0))
  }
  g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: ctx.color2, transparent: true, blending: THREE.AdditiveBlending })))
  g.rotation.x = -Math.PI / 2
  g.position.y = 0.03
  ctx.fx(g, life, (k) => {
    const t = k * life
    g.rotation.z = t * spin
    g.scale.setScalar(easeOut(clamp01(t / 0.35)))
    let o = 1 - span(k, 0.85, 1)
    if (rise) {
      const rk = easeInOut(span(t, rise.at, rise.at + 0.8))
      g.position.y = 0.03 + rk * rise.to
      o *= 1 - rk * 0.6
    }
    mat.opacity = o
  })
}

/** Pęknięcie w ziemi: świecące promienie od środka. */
function crack(ctx: RevealCtx) {
  const g = new THREE.Group()
  const mat = add(ctx.color, 1.6)
  for (let i = 0; i < 9; i++) {
    const len = 1.5 + ctx.rng() * 2.5
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.06, len), mat)
    m.geometry.translate(0, len / 2, 0)
    m.rotation.x = -Math.PI / 2
    const holder = new THREE.Group()
    holder.rotation.y = (i / 9) * TAU + ctx.rng() * 0.4
    holder.add(m)
    g.add(holder)
  }
  g.position.y = 0.02
  ctx.fx(g, 2.5, (k) => {
    g.scale.setScalar(easeOut(clamp01(k * 6)))
    mat.opacity = 1 - span(k, 0.3, 1)
  })
}

/** Lądowanie po skoku: fala + iskry + lekki shake. */
function land(ctx: RevealCtx, power = 1) {
  shockwave(ctx, v3(ctx.holder.position.x, 0.05, 0), 4 * power, ctx.color, 0.6)
  sparks(ctx, v3(ctx.holder.position.x, 0.1, 0), Math.round(40 * power), ctx.color2, 5 * power, 8, 0.7)
  ctx.shake(0.4 * power)
}

// ── choreografie ────────────────────────────────────────────

const CHOREOS: Record<RevealStyle, (ctx: RevealCtx) => Choreo> = {
  /** Ciemność → cięcie przez ekran w slow-mo → błysk, postać stoi → teleport-cięcie przez scenę → wybuch płatków. */
  katana(ctx) {
    const s = ctx.side
    const start: Pose = { a: -s * 0.75, r: 2.3, h: 1.45, ly: 1.25, fov: 30 }
    const F = FINAL(s)
    const tr = trail(ctx, ctx.color2, 0.02)
    ctx.reveal(-1)
    const tl = timeline([
      [0.2, () => (screenSlash(ctx, s * 0.14), ctx.slowmo(0.45, 0.25))],
      [
        0.55,
        () => {
          ctx.reveal(10)
          ctx.flash(1)
          ctx.impact(1)
          ctx.shake(0.5)
          ctx.speedlines(0.5)
          sparks(ctx, v3(0, 1.1, 0), 90, ctx.color2, 8, 3, 1.2, 0.06)
          sparks(ctx, v3(0, 2.6, 0), 70, ctx.color, 1.2, 0.7, 2.2, 0.09, 4) // płatki
          shockwave(ctx, v3(0, 0.05, 0), 4, ctx.color, 0.7)
          ctx.act('light', 0.5, 0)
        },
      ],
      [0.95, () => (slashArc(ctx, { y: 1.0, r: 1.35, rotZ: s * 0.55, color: ctx.color, life: 0.3 }), ctx.act('light', 0.3, 1))],
      [1.05, () => slashArc(ctx, { y: 1.25, r: 1.5, rotZ: -s * 0.4, rotY: 1, color: ctx.color2, life: 0.3 })],
      // teleport: znika, przecina scenę, wraca
      [1.25, () => (screenSlash(ctx, -s * 0.5, 0.4), ctx.flash(0.5))],
      [
        1.55,
        () => {
          explosion(ctx, v3(0, 1.0, 0), ctx.rankS ? 1.1 : 0.7, ctx.color)
          sparks(ctx, v3(0, 3, 0), 120, ctx.color2, 1.5, 0.6, 2.5, 0.09, 6, true)
          ctx.act('heavy', 0.6)
        },
      ],
    ])
    return {
      duration: 2.4,
      peak: 0.55,
      update(t) {
        tl(t)
        // teleport-cięcie: postać przelatuje przez scenę w lewo i z powrotem
        const k = span(t, 1.25, 1.5)
        ctx.holder.position.x = k > 0 && k < 1 ? s * Math.sin(k * Math.PI) * 3.5 : 0
        ctx.spin.rotation.y = k > 0 && k < 1 ? -s * 0.6 : 0
        tr(t, k > 0 && k < 1)
        setCam(ctx, mix(start, F, easeInOut(span(t, 0.55, 2.3))))
        if (t < 0.55) ctx.cam.pos.x += t * 0.3 * s
      },
    }
  },

  /** Wkręca się w górę z wiru cięć, wybija w powietrze z saltem, ląduje z wybuchem. */
  blade(ctx) {
    const s = ctx.side
    const start: Pose = { a: -s * 1.6, r: 4.6, h: 0.55, ly: 0.8, fov: 46 }
    const F = FINAL(s)
    const tr = trail(ctx, ctx.color)
    const tl = timeline([
      [0.2, () => slashArc(ctx, { y: 0.5, r: 1.25, rotY: 0, rotZ: 0.2 * s, color: ctx.color })],
      [0.38, () => slashArc(ctx, { y: 1.0, r: 1.35, rotY: 2.1, rotZ: -0.3 * s, color: ctx.color2 })],
      [0.56, () => slashArc(ctx, { y: 1.5, r: 1.45, rotY: 4.2, rotZ: 0.25 * s, color: ctx.color })],
      [0.95, () => (ctx.speedlines(0.6), shockwave(ctx, v3(0, 0.05, 0), 3, ctx.color2, 0.4))],
      [1.2, () => (slashArc(ctx, { y: 3.2, r: 2.0, arc: TAU, color: ctx.color2, life: 0.4 }), ctx.slowmo(0.35, 0.3))],
      [
        1.65,
        () => {
          explosion(ctx, v3(0, 0.4, 0), ctx.rankS ? 1.3 : 0.9, ctx.color)
          crack(ctx)
          ctx.act('light', 0.45, 2)
        },
      ],
    ])
    return {
      duration: 2.5,
      peak: 1.65,
      update(t) {
        tl(t)
        ctx.reveal(easeOut(span(t, 0.15, 0.9)) * 1.95, 'up')
        ctx.holder.rotation.y = s * (1 - easeOut(span(t, 0, 0.95))) * TAU * 2
        jump(ctx, t, 0.95, 1.65, 2.6, -1, 0)
        tr(t, t > 0.95 && t < 1.65)
        setCam(ctx, mix(start, F, easeInOut(span(t, 0, 2.3))), ctx.holder.position.y * 0.5)
      },
    }
  },

  /** Doskok z boku ze smugami, cięcie w X, piruet w powietrzu i drugi X przy lądowaniu. */
  dual(ctx) {
    const s = ctx.side
    const start: Pose = { a: s * 0.05, r: 5.4, h: 1.15, ly: 1.0, fov: 42 }
    const F = FINAL(s)
    const tr = trail(ctx, ctx.color, 0.02)
    const xSlash = (y: number, r: number) => {
      slashArc(ctx, { y, r, rotZ: 0.85, rotY: 0.2, color: ctx.color, life: 0.3 })
      slashArc(ctx, { y, r, rotZ: -0.85, rotY: -0.2, color: ctx.color2, life: 0.3 })
    }
    const tl = timeline([
      [0.1, () => ctx.speedlines(0.4)],
      [
        0.5,
        () => {
          xSlash(1.1, 1.5)
          sparks(ctx, v3(0, 1.1, 0.3), 70, ctx.color2, 8, 5)
          ctx.shake(0.45)
          ctx.flash(0.5)
          ctx.impact(0.6)
          ctx.act('light', 0.35, 0)
        },
      ],
      [0.75, () => ctx.slowmo(0.4, 0.35)],
      [1.0, () => xSlash(2.6, 1.6)],
      [
        1.45,
        () => {
          xSlash(1.0, 2.0)
          explosion(ctx, v3(0, 0.8, 0), ctx.rankS ? 1.1 : 0.75, ctx.color)
          ctx.act('light', 0.35, 1)
        },
      ],
    ])
    ctx.holder.position.x = s * 7
    return {
      duration: 2.3,
      peak: 0.5,
      update(t) {
        tl(t)
        const k = easeOut(span(t, 0.12, 0.45))
        ctx.holder.position.x = s * 7 * (1 - k)
        jump(ctx, t, 0.75, 1.45, 1.9, 0, 2 * s)
        tr(t, (k > 0 && k < 1) || (t > 0.75 && t < 1.45))
        setCam(ctx, mix(start, F, easeInOut(span(t, 0.45, 2.2))), ctx.holder.position.y * 0.4)
      },
    }
  },

  /** Spada z nieba z saltem w przód, slow-mo tuż nad ziemią, WYBUCH, odłamki, pęknięcie. */
  heavy(ctx) {
    const s = ctx.side
    const start: Pose = { a: s * 0.55, r: 3.4, h: 0.32, ly: 1.7, fov: 52 }
    const F = FINAL(s)
    const tr = trail(ctx, ctx.color, 0.025)
    ctx.holder.position.y = 10
    const tl = timeline([
      [0.2, () => (pillar(ctx, 0.35, 14, ctx.color, 0.5), ctx.speedlines(0.5))],
      [0.5, () => ctx.slowmo(0.3, 0.2)],
      [
        0.65,
        () => {
          explosion(ctx, v3(0, 0.5, 0), ctx.rankS ? 1.8 : 1.3, ctx.color)
          ctx.shake(1.4)
          shockwave(ctx, v3(0, 0.05, 0), 10, ctx.color2, 1.0)
          debris(ctx, v3(0, 0.1, 0), 46, ctx.color, { speed: 7, up: 7 })
          crack(ctx)
          ctx.act('heavy', 0.8)
        },
      ],
      [0.95, () => ctx.rankS && shockwave(ctx, v3(0, 0.05, 0), 14, ctx.color, 1.2, false, 0.05)],
      [1.25, () => explosion(ctx, v3(-s * 2.5, 0.4, -2), 0.6, ctx.color2, ctx.color)],
      [1.4, () => explosion(ctx, v3(s * 2.8, 0.4, -1.5), 0.6, ctx.color2, ctx.color)],
    ])
    return {
      duration: 2.4,
      peak: 0.65,
      update(t) {
        tl(t)
        const k = span(t, 0.2, 0.65)
        ctx.holder.position.y = 10 * (1 - easeIn(k))
        ctx.spin.rotation.x = k < 1 ? easeOut(k) * TAU * 1.5 + Math.PI : 0 // salto w przód, ląduje na nogach
        if (k >= 1) ctx.spin.rotation.x = 0
        tr(t, k > 0 && k < 1)
        setCam(ctx, mix(start, F, easeInOut(span(t, 0.75, 2.3))))
      },
    }
  },

  /** Holograficzny „wydruk” w ogniu krzyżowym, salto w tył z pociskami w powietrzu, wybuch za plecami. */
  gun(ctx) {
    const s = ctx.side
    const start: Pose = { a: -s * 1.15, r: 3.3, h: 1.6, ly: 1.1, fov: 38 }
    const F = FINAL(s)
    const gold = new THREE.Color('#ffcf5a')
    const tr = trail(ctx, gold)
    const shot = (fromCenter: boolean) => () => {
      if (fromCenter) {
        // strzały z postaci w powietrzu na wszystkie strony
        const from = ctx.holder.position.clone().add(v3(0, 1, 0))
        const a = ctx.rng() * TAU
        const to = v3(Math.cos(a) * 6, 0.02, Math.sin(a) * 6)
        tracer(ctx, from, to, gold, 0.15)
        shockwave(ctx, to.clone().setY(0.05), 0.8, ctx.color, 0.35)
        sparks(ctx, to, 10, ctx.color2, 3, 6, 0.4, 0.05)
        sparks(ctx, from, 2, gold, 2, 12, 0.9, 0.06) // łuski
        ctx.shake(0.12)
        return
      }
      const a = ctx.rng() * TAU
      const from = v3(Math.cos(a) * 9, 0.6 + ctx.rng() * 2.5, Math.sin(a) * 9)
      const b = ctx.rng() * TAU
      const to = v3(Math.cos(b) * (0.5 + ctx.rng()), 0.4 + ctx.rng() * 1.4, Math.sin(b) * (0.5 + ctx.rng()))
      tracer(ctx, from, to, ctx.rng() < 0.5 ? ctx.color2 : gold)
      sparks(ctx, to, 10, ctx.color2, 4, 6, 0.4, 0.05)
    }
    const events: [number, () => void][] = []
    for (let i = 0; i < 12; i++) events.push([0.05 + i * 0.06, shot(false)])
    for (let i = 0; i < 10; i++) events.push([1.05 + i * 0.05, shot(true)])
    const tl = timeline([
      ...events,
      [0.85, () => (ctx.flash(0.4), ctx.act('light', 0.3, 0))],
      [1.0, () => (ctx.slowmo(0.5, 0.35), ctx.speedlines(0.5))],
      [
        1.65,
        () => {
          land(ctx, 1)
          explosion(ctx, v3(-s * 1.2, 1.2, -2.2), ctx.rankS ? 1.4 : 1.0, ctx.color, gold)
          if (ctx.rankS) debris(ctx, v3(0, 1.6, 0), 24, gold, { speed: 3, up: 4, geo: new THREE.CylinderGeometry(0.02, 0.02, 0.08, 6), emissive: true })
          ctx.act('light', 0.4, 1)
        },
      ],
    ])
    return {
      duration: 2.5,
      peak: 0.85,
      update(t) {
        tl(t)
        ctx.reveal(easeInOut(span(t, 0.25, 0.85)) * 1.95, 'up')
        jump(ctx, t, 1.0, 1.65, 2.2, -1, 0) // salto w tył
        tr(t, t > 1.0 && t < 1.65)
        setCam(ctx, mix(start, F, easeInOut(span(t, 0, 2.4))), ctx.holder.position.y * 0.45)
      },
    }
  },

  /** Kamera tuż przy postaci, seria ciosów odpycha ją do tyłu, na koniec podbródkowy z wyskoku i wybuch. */
  fists(ctx) {
    const s = ctx.side
    const F = FINAL(s)
    let cur: Pose = { a: s * 0.12, r: 1.4, h: 1.45, ly: 1.4, fov: 34 }
    let target = { ...cur }
    const tr = trail(ctx, ctx.color2)
    const punch = (i: number) => () => {
      const side = i % 2 ? 1 : -1
      shockwave(ctx, v3(side * 0.25, 1.15 + (ctx.rng() - 0.5) * 0.3, 0.7), 1.4 + i * 0.25, i % 2 ? ctx.color2 : ctx.color, 0.35, true, 0.2)
      sparks(ctx, v3(side * 0.25, 1.15, 0.7), 16, ctx.color2, 6, 4, 0.5, 0.05)
      ctx.shake(0.28)
      ctx.flash(0.15)
      ctx.act('light', 0.14, i % 3)
      target = { ...target, r: target.r + 0.45, a: target.a - s * 0.06 }
    }
    const tl = timeline([
      [0.2, punch(0)],
      [0.32, punch(1)],
      [0.44, punch(2)],
      [0.56, punch(3)],
      [0.68, punch(4)],
      [
        0.85,
        () => {
          shockwave(ctx, v3(0, 1.1, 0.8), 6, ctx.color, 0.55, true, 0.3)
          ctx.impact(1)
          ctx.flash(0.7)
          ctx.shake(0.9)
          ctx.speedlines(0.5)
          ctx.act('heavy', 0.6)
          target = { a: s * 0.4, r: 5, h: 1.0, ly: 2.2, fov: 44 }
        },
      ],
      [1.25, () => (explosion(ctx, v3(0, 3.6, 0.3), ctx.rankS ? 1.2 : 0.9, ctx.color), ctx.slowmo(0.3, 0.3))],
      [1.7, () => (land(ctx, 1.4), crack(ctx))],
    ])
    return {
      duration: 2.5,
      peak: 0.85,
      update(t, dt) {
        tl(t)
        jump(ctx, t, 0.85, 1.7, 2.4, 0, -2 * s) // podbródkowy z podwójnym piruetem
        tr(t, t > 0.85 && t < 1.7)
        if (t > 1.7) target = F
        cur = mix(cur, target, Math.min(1, dt * (t > 1.7 ? 3 : t > 0.85 ? 5 : 12)))
        setCam(ctx, cur)
      },
    }
  },

  /** Kamera spiralnie zjeżdża, wir broni drzewcowej unosi postać w powietrze — piruety i uderzenie z góry. */
  polearm(ctx) {
    const s = ctx.side
    const start: Pose = { a: -s * 2.6, r: 5.2, h: 4.2, ly: 0.6, fov: 44 }
    const F = FINAL(s)
    const tr = trail(ctx, ctx.color2, 0.025)
    const N = 180
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3))
    const seeds = Array.from({ length: N }, () => ({ a: ctx.rng() * TAU, r: 0.8 + ctx.rng() * 1.2, y: ctx.rng() * 0.4, sp: 3 + ctx.rng() * 3 }))
    const wmat = new THREE.PointsMaterial({ color: ctx.color2, size: 0.05, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    ctx.fx(new THREE.Points(geo, wmat), 2.5, (k) => {
      const at = geo.getAttribute('position') as THREE.BufferAttribute
      const t = k * 2.5
      seeds.forEach((p, i) => {
        const a = p.a + t * p.sp * s
        at.setXYZ(i, Math.cos(a) * p.r * (1 - k * 0.3), (p.y + t * 1.6) % 3.6, Math.sin(a) * p.r * (1 - k * 0.3))
      })
      at.needsUpdate = true
      wmat.opacity = 1 - span(k, 0.7, 1)
    })
    const tl = timeline([
      [0.3, () => slashArc(ctx, { y: 0.8, r: 1.7, arc: Math.PI * 1.9, color: ctx.color, life: 0.45, width: 0.15 })],
      [0.65, () => (slashArc(ctx, { y: 1.3, r: 1.9, arc: Math.PI * 1.9, rotY: 2, color: ctx.color2, life: 0.45, width: 0.15 }), ctx.speedlines(0.8))],
      [1.0, () => slashArc(ctx, { y: 3.0, r: 2.2, arc: Math.PI * 1.9, rotY: 4, color: ctx.color, life: 0.45, width: 0.15 })],
      [1.3, () => (slashArc(ctx, { y: 3.4, r: 2.5, arc: TAU, color: ctx.color2, life: 0.4, width: 0.1 }), ctx.slowmo(0.3, 0.3))],
      [
        1.7,
        () => {
          explosion(ctx, v3(0, 0.3, 0), ctx.rankS ? 1.5 : 1.1, ctx.color)
          crack(ctx)
          ctx.act('heavy', 0.7)
        },
      ],
    ])
    return {
      duration: 2.5,
      peak: 1.7,
      update(t) {
        tl(t)
        ctx.reveal(easeOut(span(t, 0.25, 1.0)) * 1.95, 'up')
        // unosi się z wiatrem, kręci piruety, potem pikuje w dół
        if (t < 1.35) {
          ctx.holder.position.y = easeInOut(span(t, 0.6, 1.3)) * 2.4
          ctx.spin.rotation.y = easeInOut(span(t, 0.5, 1.35)) * TAU * 3 * s
        } else {
          const k = span(t, 1.35, 1.7)
          ctx.holder.position.y = 2.4 * (1 - easeIn(k))
          ctx.spin.rotation.y = 0
          ctx.spin.rotation.x = k < 1 ? easeOut(k) * TAU : 0
        }
        tr(t, t > 0.6 && t < 1.7)
        setCam(ctx, mix(start, F, easeInOut(span(t, 0, 2.3))), ctx.holder.position.y * 0.5)
      },
    }
  },

  /** Deszcz strzał, ostatnia odsłania postać; wyskok z saltem i strzała w niebo, które wybucha deszczem iskier. */
  bow(ctx) {
    const s = ctx.side
    const start: Pose = { a: s * 0.6, r: 5.6, h: 3.6, ly: 0.4, fov: 46 }
    const F = FINAL(s)
    const tr = trail(ctx, ctx.color2)
    ctx.reveal(-1)
    const arrows: [number, () => void][] = []
    for (let i = 0; i < 13; i++) {
      arrows.push([
        0.05 + i * 0.05,
        () => {
          const a = ctx.rng() * TAU
          const r = 1.1 + ctx.rng() * 2.2
          const to = v3(Math.cos(a) * r, 0.02, Math.sin(a) * r)
          tracer(ctx, to.clone().add(v3(-s * 2, 12, 0)), to, ctx.color2, 0.2)
          shockwave(ctx, to.clone().setY(0.04), 0.9, ctx.color, 0.4)
          sparks(ctx, to, 8, ctx.color2, 3, 6, 0.4, 0.04)
        },
      ])
    }
    const tl = timeline([
      ...arrows,
      [0.65, () => tracer(ctx, v3(-s * 3, 16, 0), v3(0, 0.02, 0), WHITE, 0.16, 0.03)],
      [
        0.8,
        () => {
          ctx.reveal(10)
          explosion(ctx, v3(0, 0.4, 0), ctx.rankS ? 1.2 : 0.9, ctx.color)
          ctx.act('light', 0.5, 0)
        },
      ],
      [1.1, () => (ctx.slowmo(0.4, 0.3), ctx.speedlines(0.5))],
      [1.3, () => (pillar(ctx, 0.05, 20, ctx.color2, 0.6, 0.05), ctx.flash(0.5))],
      [1.6, () => firework(ctx, v3(0, 7, -1), ctx.color2)],
      [1.75, () => land(ctx, 1)],
      [1.8, () => firework(ctx, v3(-s * 3, 6, -3), ctx.color)],
      [2.0, () => ctx.rankS && firework(ctx, v3(s * 3, 6.5, -3), ctx.color2)],
    ])
    return {
      duration: 2.5,
      peak: 0.8,
      update(t) {
        tl(t)
        jump(ctx, t, 1.05, 1.75, 2.0, -1, s)
        tr(t, t > 1.05 && t < 1.75)
        setCam(ctx, mix(start, F, easeInOut(span(t, 0.7, 2.4))), ctx.holder.position.y * 0.4)
      },
    }
  },

  /** Kręgi run, kolumna światła, postać wyłania się spod podłogi, lewituje z piruetem, eksplozja magii. */
  magic(ctx) {
    const s = ctx.side
    const start: Pose = { a: -s * 0.45, r: 4.6, h: 2.8, ly: 0.2, fov: 42 }
    const F = FINAL(s)
    ctx.reveal(0, 'down')
    ctx.holder.position.y = -2
    runeCircle(ctx, 1.3, 1.2 * s, 2.6, { at: 1.4, to: 2.2 })
    runeCircle(ctx, 2.0, -0.7 * s, 2.6, { at: 1.5, to: 1.4 })
    if (ctx.rankS) runeCircle(ctx, 2.9, 0.4 * s, 2.6, { at: 1.6, to: 0.8 })
    const tl = timeline([
      [0.4, () => pillar(ctx, 0.75, 9, ctx.color, 1.3)],
      [0.45, () => sparks(ctx, v3(0, 0.1, 0), 60, ctx.color2, 3, -3, 1.5, 0.06, 1.2)],
      [
        1.4,
        () => {
          ctx.reveal(10)
          explosion(ctx, v3(0, 1.6, 0), ctx.rankS ? 1.3 : 0.9, ctx.color)
          ctx.slowmo(0.35, 0.35)
          ctx.act('light', 0.5, 1)
        },
      ],
      [1.75, () => (runeCircle(ctx, 1.0, 3 * s, 0.9), sparks(ctx, v3(0, 2.0, 0), 80, ctx.color2, 3, -1, 1.4, 0.07, 1))],
      [2.05, () => land(ctx, 0.8)],
    ])
    return {
      duration: 2.6,
      peak: 1.4,
      update(t) {
        tl(t)
        // wyłania się spod ziemi, wznosi się do lewitacji i spokojnie osiada
        if (t < 1.4) ctx.holder.position.y = -2 + 2.9 * easeOut(span(t, 0.5, 1.4))
        else ctx.holder.position.y = 0.9 * (1 - easeInOut(span(t, 1.6, 2.05))) + Math.sin(t * 6) * 0.04 * (t < 2.05 ? 1 : 0)
        ctx.spin.rotation.y = easeInOut(span(t, 0.5, 1.5)) * TAU * 2 * s
        setCam(ctx, mix(start, F, easeInOut(span(t, 0.25, 2.4))), Math.max(0, ctx.holder.position.y) * 0.5)
      },
    }
  },

  /** Scena koncertowa: reflektory, postać rysuje się od głowy, piruet z wyskokiem, fajerwerki. */
  support(ctx) {
    const s = ctx.side
    const start: Pose = { a: 0, r: 6.5, h: 1.0, ly: 1.25, fov: 30 }
    const F = FINAL(s)
    const tr = trail(ctx, ctx.color2, 0.035)
    for (let i = 0; i < 3; i++) {
      const mat = add(i === 1 ? ctx.color2 : ctx.color, 0.5)
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1.1, 7, 32, 1, true), mat)
      cone.geometry.translate(0, -3.5, 0)
      const pivot = new THREE.Group()
      const a = (i / 3) * TAU + 0.5
      pivot.position.set(Math.cos(a) * 3, 7, Math.sin(a) * 3)
      pivot.add(cone)
      const swing = (ctx.rng() - 0.5) * 1.6
      ctx.fx(pivot, 2.7, (k) => {
        const t = k * 2.7
        const conv = easeInOut(span(t, 0.2, 1.0))
        pivot.lookAt(0, 0, 0)
        pivot.rotateX(-Math.PI / 2)
        pivot.rotateZ(swing * (1 - conv) * Math.sin(t * 4))
        mat.opacity = 0.35 * (1 - span(k, 0.8, 1))
      })
    }
    const tl = timeline([
      [0.2, () => sparks(ctx, v3(0, 0.3, 0), 50, ctx.color2, 2, -1.5, 2, 0.08, 3)],
      [0.7, () => sparks(ctx, v3(0, 0.3, 0), 50, ctx.color, 2, -1.5, 2, 0.08, 3)],
      [
        1.15,
        () => {
          ctx.flash(0.45, ctx.color2)
          ctx.impact(0.5)
          sparks(ctx, v3(0, 1.4, 0), 70, ctx.color2, 3, -1, 1.6, 0.08, 1)
          ctx.act('light', 0.4, 0)
        },
      ],
      ...[0, 1, 2].map((i): [number, () => void] => [1.15 + i * 0.12, () => shockwave(ctx, v3(0, 0.05, 0), 3 + i * 1.5, i % 2 ? ctx.color : ctx.color2, 0.9, false, 0.06)]),
      [1.4, () => firework(ctx, v3(-2.5, 5, -3), ctx.color)],
      [1.55, () => firework(ctx, v3(2.5, 5.5, -3), ctx.color2)],
      [1.7, () => firework(ctx, v3(0, 6.5, -4), ctx.color)],
      [1.85, () => land(ctx, 0.8)],
      [1.95, () => ctx.rankS && firework(ctx, v3(-1.5, 7, -5), ctx.color2)],
      [2.05, () => ctx.rankS && firework(ctx, v3(1.8, 6.8, -5), ctx.color)],
    ])
    return {
      duration: 2.6,
      peak: 1.15,
      update(t) {
        tl(t)
        ctx.reveal(1.95 - easeInOut(span(t, 0.3, 1.2)) * 1.97, 'down')
        ctx.holder.rotation.y = s * Math.PI * 0.6 * (1 - easeOut(span(t, 0.3, 1.2)))
        jump(ctx, t, 1.3, 1.85, 1.3, 0, 2 * s) // piruet z wyskokiem
        tr(t, t > 1.3 && t < 1.85)
        setCam(ctx, mix(start, F, easeInOut(span(t, 0, 2.4))), ctx.holder.position.y * 0.4)
      },
    }
  },

  /** Bariera formuje się i pulsuje, postać wybija ją od środka — odłamki, wybuch, skok i uderzenie tarczą o ziemię. */
  shield(ctx) {
    const s = ctx.side
    const start: Pose = { a: -s * 0.7, r: 4.9, h: 2.0, ly: 0.9, fov: 42 }
    const F = FINAL(s)
    const tr = trail(ctx, ctx.color)
    const domeGeo = new THREE.IcosahedronGeometry(1.3, 1)
    const faceMat = add(ctx.color, 0.35)
    const lineMat = new THREE.LineBasicMaterial({ color: ctx.color2, transparent: true, blending: THREE.AdditiveBlending })
    const dome = new THREE.Mesh(domeGeo, faceMat)
    dome.add(new THREE.LineSegments(new THREE.EdgesGeometry(domeGeo), lineMat))
    dome.position.y = 0.95
    dome.scale.set(0, 0, 0)
    let shattered = false
    ctx.fx(dome, 2.6, (k) => {
      const t = k * 2.6
      const sc = easeOut(span(t, 0, 0.4)) * (1 + Math.sin(t * 25) * 0.03 * span(t, 0.7, 1.15))
      dome.scale.set(sc, sc * 1.15, sc)
      dome.rotation.y = t * 0.6 * s
      const pulse = 0.5 + 0.5 * Math.sin(t * 18)
      faceMat.opacity = shattered ? 0 : 0.25 + pulse * 0.25 * span(t, 0.7, 1.15)
      lineMat.opacity = shattered ? 0 : 1
    })
    const tl = timeline([
      [0.75, () => (ctx.shake(0.15), ctx.light(v3(0, 1, 0), ctx.color, 20))],
      [0.95, () => (ctx.shake(0.25), ctx.light(v3(0, 1, 0), ctx.color, 30))],
      [
        1.15,
        () => {
          shattered = true
          debris(ctx, v3(0, 0.95, 0), 60, ctx.color, { speed: 9, up: 4, geo: new THREE.TetrahedronGeometry(0.14), emissive: true, life: 1.3 })
          explosion(ctx, v3(0, 1, 0), ctx.rankS ? 1.4 : 1.0, ctx.color)
          ctx.act('heavy', 0.5)
        },
      ],
      [1.4, () => ctx.slowmo(0.3, 0.35)],
      [
        1.85,
        () => {
          land(ctx, 1.6)
          crack(ctx)
          ctx.impact(0.8)
          ctx.flash(0.5)
          if (ctx.rankS) shockwave(ctx, v3(0, 0.05, 0), 12, ctx.color2, 1.1, false, 0.05)
          ctx.act('heavy', 0.6)
        },
      ],
    ])
    return {
      duration: 2.6,
      peak: 1.15,
      update(t) {
        tl(t)
        ctx.reveal(easeOut(span(t, 0.25, 1.0)) * 1.95, 'up')
        jump(ctx, t, 1.3, 1.85, 1.6, 1, 0) // salto w przód i uderzenie
        tr(t, t > 1.3 && t < 1.85)
        setCam(ctx, mix(start, F, easeInOut(span(t, 0.2, 2.4))), ctx.holder.position.y * 0.4)
      },
    }
  },
}

export function createChoreo(style: RevealStyle, ctx: RevealCtx): Choreo {
  return CHOREOS[style](ctx)
}
