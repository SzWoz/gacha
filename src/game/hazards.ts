import * as THREE from 'three'
import { CELL, MAP, ci, cj, cx, cz } from './grid'
import { Ground, type DecorCtx } from './world'

// ─────────────────────────────────────────────────────────────
//  Zagrożenia środowiskowe — każdy biom ma własne:
//   • miasto/noc — wybuchające rury pod ulicami (studzienki)
//   • las       — trujące pąki zarodników
//   • arktyka   — pękająca kra + zamieć
//   • wulkan    — spadające kule ognia + lawa
//  Działają na gracza i na wrogów (ciała z pozycją i prędkością).
// ─────────────────────────────────────────────────────────────

export interface Body {
  pos: THREE.Vector3
  /** prędkość pozioma (wyrzut, odrzut) */
  vel: THREE.Vector3
  vy: number
  grounded: boolean
  r: number
  player: boolean
  dead?: boolean
}

export interface HazardApi {
  bodies: Body[]
  damage(b: Body, dmg: number, from: THREE.Vector3): void
  launch(b: Body, vy: number, push?: THREE.Vector3): void
  fx(at: THREE.Vector3, radius: number, color: number, shake: number): void
  notice(text: string): void
}

export interface Hazards {
  /** krótki opis na baner poziomu */
  hint: string
  update(dt: number, time: number, api: HazardApi): void
}

const tick = new WeakMap<Body, number>()
/** obrażenia „co chwilę” zamiast co klatkę */
function dot(api: HazardApi, b: Body, dt: number, every: number, dmg: number, from: THREE.Vector3) {
  const t = (tick.get(b) ?? 0) - dt
  if (t <= 0) {
    api.damage(b, dmg, from)
    tick.set(b, every)
  } else tick.set(b, t)
}

function glowTex() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.4, 'rgba(255,255,255,0.45)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
}

export function createHazards(ctx: DecorCtx): Hazards {
  switch (ctx.biome) {
    case 'volcano':
      return meteors(ctx)
    case 'arctic':
      return thinIce(ctx)
    case 'forest':
      return spores(ctx)
    default:
      return pipes(ctx)
  }
}

// ── miasto: wybuchające rury pod studzienkami ──────────────
function pipes(ctx: DecorCtx): Hazards {
  const { group, T, rng, walk, floorY } = ctx
  const coverMat = T(new THREE.MeshStandardMaterial({ color: 0x2e2c2a, roughness: 0.5, metalness: 0.8, emissive: 0xff5a1a, emissiveIntensity: 0 }))
  const coverGeo = T(new THREE.CylinderGeometry(0.75, 0.75, 0.06, 18))
  const holes = walk.filter(([i, j]) => MAP[j][i] === '.' && floorY(i, j) === 0 && rng() < 0.3)
  const vents = holes.map(([i, j]) => {
    const pos = new THREE.Vector3(cx(i) + (rng() - 0.5) * 2.5, 0, cz(j) + (rng() - 0.5) * 2.5)
    const mat = coverMat.clone()
    T(mat)
    const m = new THREE.Mesh(coverGeo, mat)
    m.position.copy(pos).setY(0.03)
    m.receiveShadow = true
    group.add(m)
    return { pos, mat, m, state: 'idle' as 'idle' | 'warn' | 'blow', t: 0, hit: new Set<Body>() }
  })
  const tex = T(glowTex())
  const colMat = T(new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
  const colGeo = T(new THREE.CylinderGeometry(0.5, 1.0, 1, 14, 1, true))
  colGeo.translate(0, 0.5, 0)
  const puffs: { s: THREE.Sprite; v: THREE.Vector3; life: number; max: number }[] = []
  const puff = (at: THREE.Vector3, color: number, up: number, size: number) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity: 0.6, depthWrite: false }))
    s.position.copy(at)
    s.scale.setScalar(size)
    group.add(s)
    puffs.push({ s, v: new THREE.Vector3((Math.random() - 0.5) * 0.6, up, (Math.random() - 0.5) * 0.6), life: 1.2, max: 1.2 })
  }
  let timer = 2.5
  const columns: { m: THREE.Mesh; t: number }[] = []
  return {
    hint: 'Uważaj na studzienki — rury pod ulicą wybuchają',
    update(dt, _time, api) {
      const p = api.bodies[0].pos
      timer -= dt
      if (timer <= 0 && vents.length) {
        timer = 1.6 + Math.random() * 1.6
        const near = vents.filter((v) => v.state === 'idle' && v.pos.distanceTo(p) < 14)
        if (near.length) {
          near.sort((a, b) => a.pos.distanceTo(p) - b.pos.distanceTo(p))
          const v = Math.random() < 0.5 ? near[0] : near[Math.floor(Math.random() * near.length)]
          v.state = 'warn'
          v.t = 1.3
        }
      }
      for (const v of vents) {
        if (v.state === 'idle') continue
        v.t -= dt
        if (v.state === 'warn') {
          const k = 1 - v.t / 1.3
          v.mat.emissiveIntensity = (0.4 + 0.6 * Math.abs(Math.sin(k * 18))) * k * 2
          v.m.position.y = 0.03 + Math.random() * 0.05 * k
          if (Math.random() < 0.35) puff(v.pos.clone().setY(0.3), 0xd8d0c8, 1.2 + k * 2, 0.8)
          if (v.t <= 0) {
            v.state = 'blow'
            v.t = 0.9
            v.hit.clear()
            api.fx(v.pos.clone().setY(0.2), 2.2, 0xff8a3a, 0.35)
            const m = new THREE.Mesh(colGeo, colMat.clone())
            T(m.material as THREE.Material)
            m.position.copy(v.pos)
            group.add(m)
            columns.push({ m, t: 0 })
          }
        } else {
          // erupcja: obrażenia + wyrzut w powietrze
          for (const b of api.bodies) {
            if (b.dead || v.hit.has(b)) continue
            const d = Math.hypot(b.pos.x - v.pos.x, b.pos.z - v.pos.z)
            if (d < 1.8 + b.r * 0.5 && b.pos.y < 3) {
              v.hit.add(b)
              api.damage(b, b.player ? 16 : 40, v.pos)
              api.launch(b, 13, b.pos.clone().sub(v.pos).setY(0).normalize().multiplyScalar(2))
            }
          }
          if (Math.random() < 0.6) puff(v.pos.clone().setY(0.5 + Math.random() * 3), 0xffb060, 4, 1.4)
          v.mat.emissiveIntensity = 2
          if (v.t <= 0) {
            v.state = 'idle'
            v.mat.emissiveIntensity = 0
            v.m.position.y = 0.03
          }
        }
      }
      for (const c of columns) {
        c.t += dt
        const k = c.t / 0.9
        c.m.scale.set(1 + k * 0.4, 7 * Math.min(1, k * 4), 1 + k * 0.4)
        ;(c.m.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - k)
        if (k >= 1) group.remove(c.m)
      }
      for (let k = columns.length - 1; k >= 0; k--) if (columns[k].t >= 0.9) columns.splice(k, 1)
      updatePuffs(puffs, group, dt)
    },
  }
}

function updatePuffs(puffs: { s: THREE.Sprite; v: THREE.Vector3; life: number; max: number }[], group: THREE.Group, dt: number) {
  for (let k = puffs.length - 1; k >= 0; k--) {
    const p = puffs[k]
    p.life -= dt
    p.s.position.addScaledVector(p.v, dt)
    const m = p.s.material as THREE.SpriteMaterial
    m.opacity = Math.max(0, (p.life / p.max) * 0.6)
    p.s.scale.multiplyScalar(1 + dt * 0.8)
    if (p.life <= 0) {
      group.remove(p.s)
      m.dispose()
      puffs.splice(k, 1)
    }
  }
}

// ── las: trujące pąki zarodników ───────────────────────────
function spores(ctx: DecorCtx): Hazards {
  const { group, T, rng, walk, floorY, ground } = ctx
  const cand = walk.filter(([i, j]) => ground(i, j) === Ground.Normal && MAP[j][i] !== 'S' && MAP[j][i] !== 'B')
  const budMat = T(new THREE.MeshStandardMaterial({ color: 0x8a2cff, emissive: 0xc04dff, emissiveIntensity: 0.6, roughness: 0.4 }))
  const leafMat = T(new THREE.MeshStandardMaterial({ color: 0x2f6a3a, side: THREE.DoubleSide }))
  const budGeo = T(new THREE.SphereGeometry(0.45, 14, 10))
  const leafGeo = T(new THREE.ConeGeometry(0.9, 0.5, 6, 1, true))
  const tex = T(glowTex())
  const pods = Array.from({ length: Math.min(22, Math.floor(cand.length / 6)) }, () => {
    const [i, j] = cand[Math.floor(rng() * cand.length)]
    const pos = new THREE.Vector3(cx(i) + (rng() - 0.5) * 3.5, floorY(i, j), cz(j) + (rng() - 0.5) * 3.5)
    const g = new THREE.Group()
    const leaf = new THREE.Mesh(leafGeo, leafMat)
    leaf.rotation.x = Math.PI
    leaf.position.y = 0.25
    const mat = budMat.clone()
    T(mat)
    const bud = new THREE.Mesh(budGeo, mat)
    bud.position.y = 0.55
    g.add(leaf, bud)
    g.position.copy(pos)
    group.add(g)
    return { pos, g, bud, mat, state: 'idle' as 'idle' | 'arm' | 'gone', t: 0, ph: rng() * 6 }
  })
  const clouds: { s: THREE.Sprite[]; pos: THREE.Vector3; t: number }[] = []
  const CLOUD_T = 3.6
  const R = 3
  return {
    hint: 'Pulsujące pąki wybuchają trującymi zarodnikami — trzymaj dystans',
    update(dt, time, api) {
      for (const p of pods) {
        if (p.state === 'gone') {
          p.t -= dt
          if (p.t <= 0) {
            p.state = 'idle'
            p.g.visible = true
            p.bud.scale.setScalar(1)
          }
          continue
        }
        if (p.state === 'idle') {
          p.mat.emissiveIntensity = 0.5 + Math.sin(time * 2.5 + p.ph) * 0.3
          if (api.bodies.some((b) => !b.dead && b.grounded && Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z) < 2.2)) {
            p.state = 'arm'
            p.t = 0.75
          }
          continue
        }
        // arm → puchnie i miga, potem pęka
        p.t -= dt
        const k = 1 - p.t / 0.75
        p.bud.scale.setScalar(1 + k * 0.7 + Math.sin(k * 40) * 0.08)
        p.mat.emissiveIntensity = 1 + k * 3
        p.mat.emissive.setHex(k > 0.5 ? 0xff3ec0 : 0xc04dff)
        if (p.t <= 0) {
          p.state = 'gone'
          p.t = 12
          p.g.visible = false
          p.mat.emissive.setHex(0xc04dff)
          api.fx(p.pos.clone().setY(0.6), R, 0xb04dff, 0.15)
          const s: THREE.Sprite[] = []
          for (let c = 0; c < 9; c++) {
            const sp = new THREE.Sprite(T(new THREE.SpriteMaterial({ map: tex, color: c % 2 ? 0xa04dff : 0x6aff9a, transparent: true, opacity: 0, depthWrite: false })))
            sp.position.copy(p.pos).add(new THREE.Vector3((Math.random() - 0.5) * R * 1.4, 0.6 + Math.random() * 1.8, (Math.random() - 0.5) * R * 1.4))
            sp.scale.setScalar(2.5 + Math.random() * 2)
            group.add(sp)
            s.push(sp)
          }
          clouds.push({ s, pos: p.pos.clone(), t: 0 })
        }
      }
      for (let k = clouds.length - 1; k >= 0; k--) {
        const c = clouds[k]
        c.t += dt
        const a = Math.min(1, c.t * 4) * Math.max(0, 1 - c.t / CLOUD_T)
        for (const [n, sp] of c.s.entries()) {
          ;(sp.material as THREE.SpriteMaterial).opacity = a * 0.45
          sp.position.y += dt * 0.25
          sp.material.rotation = time * 0.3 + n
        }
        for (const b of api.bodies) {
          if (b.dead) continue
          if (Math.hypot(b.pos.x - c.pos.x, b.pos.z - c.pos.z) < R && b.pos.y < c.pos.y + 3) dot(api, b, dt, 0.5, b.player ? 6 : 12, c.pos)
        }
        if (c.t >= CLOUD_T) {
          for (const sp of c.s) {
            group.remove(sp)
            sp.material.dispose()
          }
          clouds.splice(k, 1)
        }
      }
    },
  }
}

// ── arktyka: pękająca kra + zamieć ─────────────────────────
function thinIce(ctx: DecorCtx): Hazards {
  const { group, T, walk, floorY, ground, setHole, rng } = ctx
  const crackTex = T(
    new THREE.CanvasTexture(
      (() => {
        const c = document.createElement('canvas')
        c.width = c.height = 256
        const g = c.getContext('2d')!
        g.strokeStyle = 'rgba(255,255,255,0.95)'
        g.lineWidth = 2.2
        for (let k = 0; k < 9; k++) {
          g.beginPath()
          let x = 128
          let y = 128
          g.moveTo(x, y)
          const a0 = (k / 9) * Math.PI * 2
          for (let s = 0; s < 7; s++) {
            const a = a0 + (Math.random() - 0.5) * 0.9
            x += Math.cos(a) * 20
            y += Math.sin(a) * 20
            g.lineTo(x, y)
          }
          g.stroke()
        }
        return c
      })(),
    ),
  )
  const iceMat = T(new THREE.MeshStandardMaterial({ color: 0xc8ecff, roughness: 0.08, metalness: 0.15, transparent: true, opacity: 0.85 }))
  const waterMat = T(new THREE.MeshStandardMaterial({ color: 0x0b2a44, roughness: 0.15, metalness: 0.3 }))
  const plateGeo = T(new THREE.BoxGeometry(CELL - 0.08, 0.14, CELL - 0.08))
  const quadGeo = T(new THREE.PlaneGeometry(CELL, CELL))
  quadGeo.rotateX(-Math.PI / 2)
  const chunkGeo = T(new THREE.BoxGeometry(1, 0.14, 1))
  const cells = walk
    .filter(([i, j]) => ground(i, j) === Ground.Ice)
    .map(([i, j]) => {
      const y = floorY(i, j)
      const plate = new THREE.Mesh(plateGeo, iceMat)
      plate.position.set(cx(i), y + 0.06, cz(j))
      plate.receiveShadow = true
      const crackMat = T(new THREE.MeshBasicMaterial({ map: crackTex, transparent: true, opacity: 0, depthWrite: false }))
      const crack = new THREE.Mesh(quadGeo, crackMat)
      crack.position.set(cx(i), y + 0.14, cz(j))
      crack.rotation.y = rng() * Math.PI
      const water = new THREE.Mesh(quadGeo, waterMat)
      water.position.set(cx(i), y + 0.03, cz(j))
      water.visible = false
      const chunks: THREE.Mesh[] = []
      for (let k = 0; k < 4; k++) {
        const c = new THREE.Mesh(chunkGeo, iceMat)
        c.scale.set(0.6 + rng(), 1, 0.6 + rng())
        c.position.set(cx(i) + (rng() - 0.5) * 4, y + 0.06, cz(j) + (rng() - 0.5) * 4)
        c.rotation.y = rng() * 3
        c.visible = false
        chunks.push(c)
      }
      group.add(plate, crack, water, ...chunks)
      return { i, j, plate, crack, crackMat, water, chunks, state: 'intact' as 'intact' | 'crack' | 'broken', t: 0 }
    })
  // zamieć
  const SN = 500
  const arr = new Float32Array(SN * 3)
  const geo = T(new THREE.BufferGeometry())
  geo.setAttribute('position', new THREE.BufferAttribute(arr, 3))
  const snowMat = T(new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, transparent: true, opacity: 0, depthWrite: false }))
  const snow = new THREE.Points(geo, snowMat)
  group.add(snow)
  const gust = { t: 14, on: 0, dir: new THREE.Vector3() }
  return {
    hint: 'Cienki lód pęka pod stopami, a zamieć spycha z nóg',
    update(dt, time, api) {
      for (const c of cells) {
        const on = api.bodies.filter((b) => !b.dead && ci(b.pos.x) === c.i && cj(b.pos.z) === c.j && b.pos.y < floorY(c.i, c.j) + 0.4)
        if (c.state === 'intact') {
          if (on.some((b) => b.grounded)) {
            c.state = 'crack'
            c.t = 0
          }
        } else if (c.state === 'crack') {
          c.t += dt
          const k = c.t / 0.95
          c.crackMat.opacity = Math.min(1, k * 1.3)
          c.crack.scale.setScalar(0.4 + k * 0.8)
          c.plate.position.y = floorY(c.i, c.j) + 0.06 + (Math.random() - 0.5) * 0.04 * k
          if (k >= 1) {
            c.state = 'broken'
            c.t = 0
            setHole(c.i, c.j, true)
            c.plate.visible = false
            c.crack.visible = false
            c.water.visible = true
            for (const ch of c.chunks) ch.visible = true
            api.fx(new THREE.Vector3(cx(c.i), floorY(c.i, c.j) + 0.2, cz(c.j)), 3, 0xc8ecff, 0.25)
          }
        } else {
          c.t += dt
          for (const [n, ch] of c.chunks.entries()) {
            ch.position.y = floorY(c.i, c.j) + 0.04 + Math.sin(time * 2 + n) * 0.04
            ch.rotation.y += dt * 0.1 * (n % 2 ? 1 : -1)
          }
          // zamarza z powrotem, gdy nikogo nad nim nie ma
          if (c.t > 8 && !on.length) {
            c.state = 'intact'
            setHole(c.i, c.j, false)
            c.plate.visible = true
            c.crack.visible = true
            c.crackMat.opacity = 0
            c.water.visible = false
            for (const ch of c.chunks) ch.visible = false
          }
        }
      }
      // zamieć co kilkanaście sekund
      const p = api.bodies[0].pos
      gust.t -= dt
      if (gust.t <= 0 && gust.on <= 0) {
        gust.on = 3.5
        gust.t = 14 + Math.random() * 8
        const a = Math.random() * Math.PI * 2
        gust.dir.set(Math.cos(a), 0, Math.sin(a))
        for (let k = 0; k < SN; k++) arr.set([p.x + (Math.random() - 0.5) * 40 - gust.dir.x * 15, Math.random() * 6, p.z + (Math.random() - 0.5) * 40 - gust.dir.z * 15], k * 3)
        api.notice('ZAMIEĆ!')
      }
      if (gust.on > 0) {
        gust.on -= dt
        const k = Math.min(1, gust.on * 2, (3.5 - gust.on) * 2)
        snowMat.opacity = 0.8 * k
        for (const b of api.bodies) if (!b.dead) b.pos.addScaledVector(gust.dir, (b.player ? 3.4 : 2) * k * dt)
        const a = geo.getAttribute('position') as THREE.BufferAttribute
        for (let n = 0; n < SN; n++) a.setXYZ(n, a.getX(n) + gust.dir.x * dt * 22, a.getY(n) - dt * 0.5, a.getZ(n) + gust.dir.z * dt * 22)
        a.needsUpdate = true
      } else snowMat.opacity = 0
    },
  }
}

// ── wulkan: kule ognia z nieba + lawa ──────────────────────
function meteors(ctx: DecorCtx): Hazards {
  const { group, T } = ctx
  const ringGeo = T(new THREE.RingGeometry(0.85, 1, 40))
  ringGeo.rotateX(-Math.PI / 2)
  const discGeo = T(new THREE.CircleGeometry(1, 32))
  discGeo.rotateX(-Math.PI / 2)
  const rockGeo = T(new THREE.DodecahedronGeometry(0.7, 0))
  const rockMat = T(new THREE.MeshBasicMaterial({ color: 0xffb040 }))
  const tex = T(glowTex())
  const R = 2.8
  const falls: { at: THREE.Vector3; t: number; T: number; ring: THREE.Mesh; disc: THREE.Mesh; rock: THREE.Mesh; glow: THREE.Sprite; from: THREE.Vector3 }[] = []
  const scorch: { m: THREE.Mesh; t: number }[] = []
  const trail: { s: THREE.Sprite; life: number }[] = []
  let timer = 2.5
  const tmp = new THREE.Vector3()
  return {
    hint: 'Z nieba spadają kule ognia — uciekaj z czerwonych kręgów. Lawa parzy!',
    update(dt, _time, api) {
      const pb = api.bodies[0]
      // lawa parzy wszystko, co na niej stoi
      for (const b of api.bodies) {
        if (b.dead || !b.grounded) continue
        if (ctx.ground(ci(b.pos.x), cj(b.pos.z)) === Ground.Lava) dot(api, b, dt, 0.4, b.player ? 9 : 15, b.pos)
      }
      timer -= dt
      if (timer <= 0) {
        timer = 1.5 + Math.random() * 1.6
        // celuje w gracza (z wyprzedzeniem) albo obok
        const at = pb.pos.clone().setY(0)
        if (Math.random() < 0.55) at.addScaledVector(pb.vel, 0.6).add(new THREE.Vector3((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2))
        else at.add(new THREE.Vector3((Math.random() - 0.5) * 16, 0, (Math.random() - 0.5) * 16))
        if (ctx.boxes.some((b) => b.top === undefined && at.x > b.minX && at.x < b.maxX && at.z > b.minZ && at.z < b.maxZ)) return
        const fy = ctx.floorY(ci(at.x), cj(at.z))
        at.y = fy
        const ring = new THREE.Mesh(ringGeo, T(new THREE.MeshBasicMaterial({ color: 0xff3a1a, transparent: true, opacity: 0.9, depthWrite: false })))
        ring.position.copy(at).setY(fy + 0.08)
        ring.scale.setScalar(R)
        const disc = new THREE.Mesh(discGeo, T(new THREE.MeshBasicMaterial({ color: 0xff3a1a, transparent: true, opacity: 0, depthWrite: false })))
        disc.position.copy(ring.position)
        const rock = new THREE.Mesh(rockGeo, rockMat)
        const glow = new THREE.Sprite(T(new THREE.SpriteMaterial({ map: tex, color: 0xff7a2a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })))
        glow.scale.setScalar(4)
        const from = at.clone().add(new THREE.Vector3(8 + Math.random() * 6, 45, -6 + Math.random() * 4))
        rock.position.copy(from)
        glow.position.copy(from)
        group.add(ring, disc, rock, glow)
        falls.push({ at, t: 0, T: 1.6, ring, disc, rock, glow, from })
      }
      for (let k = falls.length - 1; k >= 0; k--) {
        const f = falls[k]
        f.t += dt
        const u = f.t / f.T
        ;(f.disc.material as THREE.MeshBasicMaterial).opacity = 0.35 * u
        f.disc.scale.setScalar(R * u)
        ;(f.ring.material as THREE.MeshBasicMaterial).opacity = 0.5 + Math.sin(f.t * 20) * 0.4
        // kula leci po prostej, przyspieszając
        const e = u * u
        tmp.lerpVectors(f.from, f.at, e)
        f.rock.position.copy(tmp)
        f.rock.rotation.x += dt * 8
        f.glow.position.copy(tmp)
        if (Math.random() < 0.8) {
          const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: Math.random() < 0.5 ? 0xff5a1a : 0x553322, transparent: true, opacity: 0.7, depthWrite: false }))
          s.position.copy(tmp)
          s.scale.setScalar(1.8)
          group.add(s)
          trail.push({ s, life: 0.6 })
        }
        if (u >= 1) {
          api.fx(f.at.clone().setY(f.at.y + 0.3), R, 0xff6a1a, 0.55)
          for (const b of api.bodies) {
            if (b.dead) continue
            const d = Math.hypot(b.pos.x - f.at.x, b.pos.z - f.at.z)
            if (d < R + b.r * 0.4 && Math.abs(b.pos.y - f.at.y) < 2.5) {
              api.damage(b, b.player ? 20 : 50, f.at)
              api.launch(b, 7, b.pos.clone().sub(f.at).setY(0).normalize().multiplyScalar(4))
            }
          }
          const sc = new THREE.Mesh(discGeo, T(new THREE.MeshBasicMaterial({ color: 0xff5a10, transparent: true, opacity: 0.8, depthWrite: false })))
          sc.position.copy(f.at).setY(f.at.y + 0.06)
          sc.scale.setScalar(R * 0.7)
          group.add(sc)
          scorch.push({ m: sc, t: 3 })
          group.remove(f.ring, f.disc, f.rock, f.glow)
          falls.splice(k, 1)
        }
      }
      for (let k = scorch.length - 1; k >= 0; k--) {
        const s = scorch[k]
        s.t -= dt
        ;(s.m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, s.t / 3) * 0.8
        if (s.t <= 0) {
          group.remove(s.m)
          scorch.splice(k, 1)
        }
      }
      for (let k = trail.length - 1; k >= 0; k--) {
        const t = trail[k]
        t.life -= dt
        t.s.material.opacity = Math.max(0, t.life / 0.6) * 0.7
        t.s.scale.multiplyScalar(1 + dt * 1.5)
        if (t.life <= 0) {
          group.remove(t.s)
          t.s.material.dispose()
          trail.splice(k, 1)
        }
      }
    },
  }
}
