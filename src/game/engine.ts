import * as THREE from 'three'
import { ELEMENT_COLORS, type Item } from '../data/roster'
import {
  createPlaceholderAvatar,
  loadManifest,
  loadModelAvatar,
  type ActionKind,
  type Avatar,
} from './avatar'
import { createEnemyRig, disposeEnemyGeometries, type EnemyKind, type EnemyRig } from './enemies'

// ───────────────────────── tuning ─────────────────────────

const ARENA = 18 // half-size of the playable square
const PLAYER_R = 0.45
const MOVE_SPEED = 7
const LIGHT_DUR = [0.3, 0.3, 0.42]
const LIGHT_DMG = [10, 12, 22]
const LIGHT_RANGE = 2.3
const COMBO_WINDOW = 0.45
const HEAVY_DUR = 0.55
const HEAVY_CD = 6
const HEAVY_RADIUS = 5
const HEAVY_DMG = 45
const DODGE_DUR = 0.22
const DODGE_SPEED = 19
const DODGE_IFRAMES = 0.35
const DODGE_CD = 0.8

const ENEMY: Record<EnemyKind, { hp: number; speed: number; r: number; dmg: number; reach: number; windup: number; score: number; color: number }> = {
  grunt: { hp: 30, speed: 3.2, r: 0.5, dmg: 8, reach: 1.5, windup: 0.6, score: 100, color: 0xff3e5a },
  spiker: { hp: 22, speed: 4.6, r: 0.45, dmg: 6, reach: 1.4, windup: 0.45, score: 120, color: 0xffa03e },
  brute: { hp: 160, speed: 2.2, r: 1.1, dmg: 20, reach: 2.6, windup: 0.95, score: 500, color: 0xb04dff },
}

export interface HudState {
  hp: number
  maxHp: number
  special: number // seconds left on cooldown
  specialMax: number
  dodge: number
  wave: number
  kills: number
  score: number
  enemies: number
  loading: boolean
  modelKind: 'model' | 'placeholder' | null
  credit?: string
  gameOver: boolean
  banner: string | null
}

export type GameAction = 'attack' | 'special' | 'dodge'

interface Enemy {
  kind: EnemyKind
  mesh: THREE.Group
  rig: EnemyRig
  ring: THREE.Mesh
  pos: THREE.Vector3
  vel: THREE.Vector3 // knockback velocity
  hp: number
  maxHp: number
  state: 'spawn' | 'chase' | 'windup' | 'strike' | 'recover'
  t: number
  flash: number
  dmg: number
  speed: number
  r: number
  dead: boolean
  seed: number
}

interface Particle {
  mesh: THREE.Mesh
  vel: THREE.Vector3
  life: number
  max: number
}

interface Burst {
  mesh: THREE.Mesh
  t: number
  max: number
  scale: number
}

interface Floater {
  el: HTMLDivElement
  pos: THREE.Vector3
  t: number
}

export interface EngineOptions {
  agent: Item
  onHud: (h: HudState) => void
}

// ───────────────────────── engine ─────────────────────────

export class GameEngine {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private clock = new THREE.Clock()
  private raf = 0
  private disposed = false
  private overlay: HTMLDivElement
  private cleanups: (() => void)[] = []
  private disposables: { dispose(): void }[] = []

  private colorA: THREE.Color
  private colorB: THREE.Color

  // player
  private player = new THREE.Group()
  private avatar: Avatar | null = null
  private ppos = new THREE.Vector3()
  private facing = 0
  private hp = 100
  private maxHp = 100
  private dmgMul = 1
  private action: ActionKind = 'none'
  private actionT = 0
  private actionDur = 0
  private combo = 0
  private comboTimer = 0
  private queuedAttack = false
  private swingHit = false
  private specialCd = 0
  private dodgeCd = 0
  private iframes = 0
  private dodgeDir = new THREE.Vector3()
  private speedFactor = 0
  private playerFlash = 0

  // world
  private enemies: Enemy[] = []
  private particles: Particle[] = []
  private bursts: Burst[] = []
  private floaters: Floater[] = []
  private props: { pos: THREE.Vector3; r: number }[] = []
  private hitStop = 0
  private shake = 0
  private time = 0

  // waves
  private wave = 0
  private toSpawn: EnemyKind[] = []
  private spawnTimer = 0
  private waveDelay = 1.2
  private kills = 0
  private score = 0
  private gameOver = false
  private banner: string | null = null
  private bannerT = 0

  // input
  private keys = new Set<string>()
  private stick = new THREE.Vector2()

  // hud
  private hudT = 0
  private loading = true
  private onHud: (h: HudState) => void

  // shared geometries/materials
  private geo = {
    ring: new THREE.RingGeometry(0.85, 1, 40),
    shard: new THREE.TetrahedronGeometry(0.12, 0),
    sphere: new THREE.SphereGeometry(1, 24, 16),
  }
  private ringMat = new THREE.MeshBasicMaterial({ color: 0xff2244, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false })

  private container: HTMLElement

  constructor(container: HTMLElement, opts: EngineOptions) {
    this.container = container
    this.onHud = opts.onHud
    const agent = opts.agent
    const [c1, c2] = agent.element ? ELEMENT_COLORS[agent.element] : ['#7cffd4', '#ffffff']
    this.colorA = new THREE.Color(c1)
    this.colorB = new THREE.Color(c2)
    if (agent.rank === 'S') {
      this.maxHp = 130
      this.dmgMul = 1.2
    } else {
      this.maxHp = 100
      this.dmgMul = 1
    }
    this.hp = this.maxHp

    // renderer
    const w = container.clientWidth || window.innerWidth
    const h = container.clientHeight || window.innerHeight
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(w, h)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.1
    this.renderer.domElement.className = 'game-canvas'
    container.appendChild(this.renderer.domElement)

    this.overlay = document.createElement('div')
    this.overlay.className = 'game-floaters'
    container.appendChild(this.overlay)

    this.camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 200)
    this.camera.position.set(0, 7.2, 8.6)

    this.buildArena()
    this.scene.add(this.player)
    this.disposables.push(this.ringMat, ...Object.values(this.geo))

    this.bindInput()
    void this.loadAvatar(agent)
    this.startWave()
    this.clock.start()
    this.loop()
  }

  // ───────────── setup ─────────────

  private buildArena() {
    const s = this.scene
    s.background = new THREE.Color(0x07060d)
    s.fog = new THREE.Fog(0x07060d, 18, 55)

    s.add(new THREE.HemisphereLight(0x8fa8ff, 0x1a0f2a, 1.1))
    const amb = new THREE.AmbientLight(0xffffff, 0.35)
    s.add(amb)
    const sun = new THREE.DirectionalLight(0xffffff, 1.6)
    sun.position.set(8, 16, 6)
    sun.castShadow = true
    sun.shadow.mapSize.set(1024, 1024)
    const sc = sun.shadow.camera
    sc.left = -14
    sc.right = 14
    sc.top = 14
    sc.bottom = -14
    sc.near = 1
    sc.far = 50
    s.add(sun, sun.target)
    this.sun = sun
    const rim = new THREE.PointLight(this.colorA, 30, 14)
    rim.position.set(0, 3, 0)
    this.player.add(rim)

    // floor: neon grid shader
    const floorMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0x7cffd4) },
        uAccent: { value: this.colorA.clone() },
        uSize: { value: ARENA },
        fogColor: { value: new THREE.Color(0x07060d) },
      },
      vertexShader: `varying vec2 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xz; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `
        uniform float uTime; uniform vec3 uColor; uniform vec3 uAccent; uniform float uSize; varying vec2 vW;
        void main(){
          vec2 g = vW/2.;
          vec2 a = abs(fract(g-0.5)-0.5)/fwidth(g);
          float line = 1.0 - min(min(a.x,a.y),1.0);
          float d = max(abs(vW.x), abs(vW.y));
          float inside = step(d, uSize);
          float edge = smoothstep(uSize-1.5, uSize, d) * inside;
          float r = length(vW);
          float pulse = 0.5+0.5*sin(r*0.6-uTime*2.);
          vec3 base = vec3(0.035,0.03,0.06);
          vec3 col = base + uColor*line*(0.18+0.25*pulse)*inside + uAccent*edge*0.6;
          col += uColor*line*0.05*(1.-inside);
          float fade = smoothstep(60., 20., r);
          gl_FragColor = vec4(mix(vec3(0.027,0.024,0.05), col, fade), 1.);
        }`,
    })
    this.floorMat = floorMat
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), floorMat)
    floor.rotation.x = -Math.PI / 2
    s.add(floor)
    // invisible shadow receiver on top
    const shadowFloor = new THREE.Mesh(new THREE.PlaneGeometry(ARENA * 2 + 4, ARENA * 2 + 4), new THREE.ShadowMaterial({ opacity: 0.45 }))
    shadowFloor.rotation.x = -Math.PI / 2
    shadowFloor.position.y = 0.01
    shadowFloor.receiveShadow = true
    s.add(shadowFloor)

    // boundary: glowing rails
    const railMat = new THREE.MeshStandardMaterial({ color: 0x7cffd4, emissive: 0x7cffd4, emissiveIntensity: 1.6 })
    const railGeo = new THREE.BoxGeometry(ARENA * 2 + 0.4, 0.15, 0.15)
    for (let i = 0; i < 4; i++) {
      const rail = new THREE.Mesh(railGeo, railMat)
      const a = (i * Math.PI) / 2
      rail.position.set(Math.sin(a) * (ARENA + 0.2), 0.6, Math.cos(a) * (ARENA + 0.2))
      rail.rotation.y = a
      s.add(rail)
    }
    // corner pylons
    const pyGeo = new THREE.CylinderGeometry(0.35, 0.5, 4, 6)
    const pyMat = new THREE.MeshStandardMaterial({ color: 0x15121f, roughness: 0.6, metalness: 0.4 })
    const capMat = new THREE.MeshStandardMaterial({ color: this.colorA, emissive: this.colorA, emissiveIntensity: 2 })
    const capGeo = new THREE.OctahedronGeometry(0.4, 0)
    for (const [x, z] of [
      [ARENA, ARENA],
      [-ARENA, ARENA],
      [ARENA, -ARENA],
      [-ARENA, -ARENA],
    ]) {
      const p = new THREE.Mesh(pyGeo, pyMat)
      p.position.set(x, 2, z)
      s.add(p)
      const cap = new THREE.Mesh(capGeo, capMat)
      cap.position.set(x, 4.5, z)
      s.add(cap)
      this.spinners.push(cap)
    }

    // props: cover pillars / crates (collidable)
    const crateGeo = new THREE.BoxGeometry(1.6, 1.6, 1.6)
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x221d33, roughness: 0.7, metalness: 0.2, emissive: 0x7cffd4, emissiveIntensity: 0.04 })
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x7cffd4, transparent: true, opacity: 0.6 })
    const edges = new THREE.EdgesGeometry(crateGeo)
    const spots: [number, number][] = [
      [-8, -6],
      [9, -7],
      [-10, 8],
      [7, 9],
      [0, -12],
      [13, 1],
      [-14, -1],
    ]
    for (const [x, z] of spots) {
      const c = new THREE.Mesh(crateGeo, crateMat)
      c.position.set(x, 0.8, z)
      c.rotation.y = (x * 0.37 + z) % Math.PI
      c.castShadow = true
      c.receiveShadow = true
      c.add(new THREE.LineSegments(edges, edgeMat))
      s.add(c)
      this.props.push({ pos: new THREE.Vector3(x, 0, z), r: 1.15 })
    }

    // floating dust
    const n = 300
    const pts = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      pts[i * 3] = (Math.random() - 0.5) * 60
      pts[i * 3 + 1] = Math.random() * 12
      pts[i * 3 + 2] = (Math.random() - 0.5) * 60
    }
    const dustGeo = new THREE.BufferGeometry()
    dustGeo.setAttribute('position', new THREE.BufferAttribute(pts, 3))
    const dustMat = new THREE.PointsMaterial({ color: 0x7cffd4, size: 0.06, transparent: true, opacity: 0.5 })
    this.dust = new THREE.Points(dustGeo, dustMat)
    s.add(this.dust)

    this.disposables.push(floorMat, floor.geometry, shadowFloor.geometry, shadowFloor.material as THREE.Material, railMat, railGeo, pyGeo, pyMat, capMat, capGeo, crateGeo, crateMat, edgeMat, edges, dustGeo, dustMat)
  }
  private sun!: THREE.DirectionalLight
  private floorMat!: THREE.ShaderMaterial
  private dust!: THREE.Points
  private spinners: THREE.Object3D[] = []

  private async loadAvatar(agent: Item) {
    const [c1, c2] = agent.element ? ELEMENT_COLORS[agent.element] : ['#7cffd4', '#ffffff']
    const cancel = { cancelled: false }
    this.cleanups.push(() => (cancel.cancelled = true))
    let av: Avatar | null = null
    try {
      const manifest = await loadManifest()
      const entry = manifest[agent.name]
      if (typeof entry?.url === 'string' && entry.url && !this.disposed) av = await loadModelAvatar(entry, cancel, '#' + this.colorA.getHexString())
    } catch (e) {
      if (!cancel.cancelled) console.warn('[game] model load failed, using placeholder', e)
    }
    if (this.disposed) {
      av?.dispose()
      return
    }
    av ??= createPlaceholderAvatar(c1, c2)
    this.avatar = av
    this.player.add(av.root)
    this.loading = false
    this.emitHud(true)
  }

  // ───────────── input ─────────────

  private bindInput() {
    const on = <K extends keyof WindowEventMap>(t: EventTarget, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn as EventListener, opts)
      this.cleanups.push(() => t.removeEventListener(type, fn as EventListener, opts))
    }
    on(window, 'keydown', (e) => {
      const k = e.key.toLowerCase()
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault()
      if (e.repeat) return
      this.keys.add(k)
      if (k === 'j') this.trigger('attack')
      else if (k === 'k') this.trigger('special')
      else if (k === ' ' || k === 'shift') this.trigger('dodge')
    })
    on(window, 'keyup', (e) => this.keys.delete(e.key.toLowerCase()))
    on(window, 'blur', () => this.keys.clear())
    const cv = this.renderer.domElement
    on(cv, 'mousedown', (e) => {
      if (e.button === 0) this.trigger('attack')
      else if (e.button === 2) this.trigger('special')
    })
    on(cv, 'contextmenu', (e) => e.preventDefault())
    on(window, 'resize', () => this.resize())
    const ro = new ResizeObserver(() => this.resize())
    ro.observe(this.container)
    this.cleanups.push(() => ro.disconnect())
  }

  /** Virtual joystick input (-1..1, y up = forward). */
  setStick(x: number, y: number) {
    this.stick.set(x, y)
  }

  trigger(a: GameAction) {
    if (this.gameOver || this.loading) return
    if (a === 'attack') {
      if (this.action === 'none') this.startLight()
      else if (this.action === 'light') this.queuedAttack = true
    } else if (a === 'special') {
      if (this.specialCd <= 0 && (this.action === 'none' || this.action === 'light')) this.startHeavy()
    } else if (a === 'dodge') {
      if (this.dodgeCd <= 0 && this.action !== 'heavy') this.startDodge()
    }
  }

  private resize() {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  // ───────────── player actions ─────────────

  private moveInput(out: THREE.Vector3) {
    let x = this.stick.x
    let y = this.stick.y
    const k = this.keys
    if (k.has('w') || k.has('arrowup')) y += 1
    if (k.has('s') || k.has('arrowdown')) y -= 1
    if (k.has('a') || k.has('arrowleft')) x -= 1
    if (k.has('d') || k.has('arrowright')) x += 1
    // camera-relative
    const fwd = new THREE.Vector3()
    this.camera.getWorldDirection(fwd)
    fwd.y = 0
    fwd.normalize()
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x)
    out.set(0, 0, 0).addScaledVector(fwd, y).addScaledVector(right, x)
    const len = out.length()
    if (len > 1) out.divideScalar(len)
    return out
  }

  private faceNearest(maxDist: number) {
    let best: Enemy | null = null
    let bd = maxDist
    for (const e of this.enemies) {
      if (e.dead || e.state === 'spawn') continue
      const d = e.pos.distanceTo(this.ppos)
      if (d < bd) {
        bd = d
        best = e
      }
    }
    if (best) this.facing = Math.atan2(best.pos.x - this.ppos.x, best.pos.z - this.ppos.z)
  }

  private startLight() {
    const inp = this.moveInput(new THREE.Vector3())
    if (inp.lengthSq() > 0.01) this.facing = Math.atan2(inp.x, inp.z)
    this.faceNearest(4)
    if (this.comboTimer <= 0) this.combo = 0
    this.action = 'light'
    this.actionT = 0
    this.actionDur = LIGHT_DUR[this.combo]
    this.swingHit = false
    this.queuedAttack = false
  }

  private startHeavy() {
    this.action = 'heavy'
    this.actionT = 0
    this.actionDur = HEAVY_DUR
    this.specialCd = HEAVY_CD
    this.swingHit = false
    this.queuedAttack = false
    this.iframes = Math.max(this.iframes, HEAVY_DUR)
  }

  private startDodge() {
    const inp = this.moveInput(new THREE.Vector3())
    if (inp.lengthSq() < 0.01) inp.set(Math.sin(this.facing), 0, Math.cos(this.facing))
    this.dodgeDir.copy(inp).normalize()
    this.facing = Math.atan2(inp.x, inp.z)
    this.action = 'dodge'
    this.actionT = 0
    this.actionDur = DODGE_DUR
    this.iframes = DODGE_IFRAMES
    this.dodgeCd = DODGE_CD
    this.queuedAttack = false
    this.combo = 0
    for (let i = 0; i < 8; i++) this.spawnParticle(this.ppos.clone().setY(0.4), this.colorB, 3, 0.35)
  }

  private resolveHits() {
    if (this.swingHit) return
    if (this.action === 'light') {
      const k = this.actionT / this.actionDur
      if (k < 0.35) return
      this.swingHit = true
      const fx = Math.sin(this.facing)
      const fz = Math.cos(this.facing)
      const isFinisher = this.combo === 2
      const range = LIGHT_RANGE + (isFinisher ? 0.5 : 0)
      let any = false
      for (const e of this.enemies) {
        if (e.dead || e.state === 'spawn') continue
        const dx = e.pos.x - this.ppos.x
        const dz = e.pos.z - this.ppos.z
        const d = Math.hypot(dx, dz)
        if (d > range + e.r) continue
        const dot = d > 0.01 ? (dx * fx + dz * fz) / d : 1
        if (dot < (isFinisher ? 0.1 : 0.35)) continue
        const dmg = Math.round(LIGHT_DMG[this.combo] * this.dmgMul * (0.9 + Math.random() * 0.2))
        this.damageEnemy(e, dmg, isFinisher ? 9 : 5, isFinisher)
        any = true
      }
      // swing slash vfx
      this.spawnSlash(isFinisher)
      if (any) {
        this.hitStop = isFinisher ? 0.09 : 0.05
        this.shake = Math.max(this.shake, isFinisher ? 0.35 : 0.15)
      }
    } else if (this.action === 'heavy') {
      const k = this.actionT / this.actionDur
      if (k < 0.5) return
      this.swingHit = true
      this.spawnBurst(this.ppos, HEAVY_RADIUS)
      for (let i = 0; i < 40; i++) this.spawnParticle(this.ppos.clone().setY(0.5), i % 2 ? this.colorA : this.colorB, 10, 0.7)
      let any = false
      for (const e of this.enemies) {
        if (e.dead || e.state === 'spawn') continue
        const d = e.pos.distanceTo(this.ppos)
        if (d > HEAVY_RADIUS + e.r) continue
        const dmg = Math.round(HEAVY_DMG * this.dmgMul * (0.9 + Math.random() * 0.2))
        this.damageEnemy(e, dmg, 14, true)
        any = true
      }
      this.shake = 0.6
      if (any) this.hitStop = 0.12
    }
  }

  private damageEnemy(e: Enemy, dmg: number, knock: number, crit: boolean) {
    e.hp -= dmg
    e.flash = 0.12
    const dir = e.pos.clone().sub(this.ppos).setY(0)
    if (dir.lengthSq() < 1e-4) dir.set(Math.sin(this.facing), 0, Math.cos(this.facing))
    dir.normalize()
    const mass = e.kind === 'brute' ? 0.35 : 1
    e.vel.addScaledVector(dir, knock * mass)
    if (e.state === 'windup' && e.kind !== 'brute') {
      e.state = 'recover' // interrupt
      e.t = 0.4
      e.ring.visible = false
    }
    this.floatText(e.pos.clone().setY(e.r * 2 + 0.6), String(dmg), crit ? 'crit' : '')
    for (let i = 0; i < 5; i++) this.spawnParticle(e.pos.clone().setY(e.r), this.colorA, 5, 0.35)
    if (e.hp <= 0) this.killEnemy(e)
  }

  private killEnemy(e: Enemy) {
    e.dead = true
    this.kills++
    this.score += ENEMY[e.kind].score * this.wave
    const c = new THREE.Color(ENEMY[e.kind].color)
    const n = e.kind === 'brute' ? 50 : 22
    for (let i = 0; i < n; i++) this.spawnParticle(e.pos.clone().setY(e.r), i % 3 ? c : this.colorB, e.kind === 'brute' ? 9 : 6, 0.8)
    this.scene.remove(e.mesh)
    e.rig.dispose()
    ;(e.ring.material as THREE.Material).dispose()
    if (e.kind === 'brute') {
      this.shake = 0.5
      this.hitStop = 0.15
      this.hp = Math.min(this.maxHp, this.hp + 15)
      this.floatText(this.ppos.clone().setY(2.4), '+15', 'heal')
    }
  }

  private hurtPlayer(dmg: number, from: THREE.Vector3) {
    if (this.iframes > 0 || this.gameOver) return
    this.hp = Math.max(0, this.hp - dmg)
    this.iframes = 0.5
    this.playerFlash = 0.2
    this.shake = Math.max(this.shake, 0.4)
    this.hitStop = 0.06
    const push = this.ppos.clone().sub(from).setY(0).normalize().multiplyScalar(0.6)
    this.ppos.add(push)
    this.floatText(this.ppos.clone().setY(2.2), `-${dmg}`, 'hurt')
    this.container.classList.remove('hurt')
    void this.container.offsetWidth
    this.container.classList.add('hurt')
    if (this.hp <= 0) {
      this.gameOver = true
      this.action = 'none'
      for (let i = 0; i < 40; i++) this.spawnParticle(this.ppos.clone().setY(1), this.colorA, 7, 1)
      this.emitHud(true)
    }
  }

  // ───────────── waves & enemies ─────────────

  private startWave() {
    this.wave++
    const n = this.wave
    const list: EnemyKind[] = []
    const count = 3 + n * 2
    for (let i = 0; i < count; i++) list.push(n >= 2 && Math.random() < 0.3 + n * 0.03 ? 'spiker' : 'grunt')
    if (n % 3 === 0) for (let i = 0; i < Math.floor(n / 3); i++) list.splice(Math.floor(list.length / 2), 0, 'brute')
    this.toSpawn = list
    this.spawnTimer = 0.4
    this.showBanner(n % 3 === 0 ? `FALA ${n} · BOSS` : `FALA ${n}`)
  }

  private showBanner(text: string) {
    this.banner = text
    this.bannerT = 2
    this.emitHud(true)
  }

  private spawnEnemy(kind: EnemyKind) {
    const cfg = ENEMY[kind]
    const scale = 1 + (this.wave - 1) * 0.12
    // spawn at a random edge point, away from the player
    const pos = new THREE.Vector3()
    for (let tries = 0; tries < 8; tries++) {
      const side = Math.floor(Math.random() * 4)
      const t = (Math.random() * 2 - 1) * (ARENA - 1.5)
      const edge = ARENA - 1.2
      if (side === 0) pos.set(t, 0, edge)
      else if (side === 1) pos.set(t, 0, -edge)
      else if (side === 2) pos.set(edge, 0, t)
      else pos.set(-edge, 0, t)
      if (pos.distanceTo(this.ppos) > 8) break
    }
    const rig = createEnemyRig(kind, cfg.color)
    const mesh = new THREE.Group()
    mesh.add(rig.root)
    const ring = new THREE.Mesh(this.geo.ring, this.ringMat.clone())
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.03
    ring.visible = false
    mesh.add(ring)
    mesh.position.copy(pos)
    this.scene.add(mesh)
    const hp = Math.round(cfg.hp * scale)
    const e: Enemy = {
      kind,
      mesh,
      rig,
      ring,
      pos,
      vel: new THREE.Vector3(),
      hp,
      maxHp: hp,
      state: 'spawn',
      t: 0.7,
      flash: 0,
      dmg: Math.round(cfg.dmg * (1 + (this.wave - 1) * 0.08)),
      speed: cfg.speed * (0.9 + Math.random() * 0.2) * Math.min(1.35, 1 + (this.wave - 1) * 0.03),
      r: cfg.r,
      dead: false,
      seed: Math.random() * 100,
    }
    // spawn column vfx
    for (let i = 0; i < 10; i++) this.spawnParticle(pos.clone().setY(0.2), new THREE.Color(cfg.color), 3, 0.6, true)
    this.enemies.push(e)
  }

  private updateEnemies(dt: number) {
    const tmp = new THREE.Vector3()
    for (const e of this.enemies) {
      if (e.dead) continue
      const cfg = ENEMY[e.kind]
      const toP = tmp.copy(this.ppos).sub(e.pos).setY(0)
      const dist = toP.length()
      e.t -= dt
      switch (e.state) {
        case 'spawn': {
          if (e.t <= 0) e.state = 'chase'
          break
        }
        case 'chase': {
          if (dist > 0.01) {
            const desired = toP.clone().divideScalar(dist)
            e.pos.addScaledVector(desired, e.speed * dt)
            e.mesh.rotation.y = Math.atan2(desired.x, desired.z)
          }
          if (dist < cfg.reach + PLAYER_R && !this.gameOver) {
            e.state = 'windup'
            e.t = cfg.windup
            e.ring.visible = true
          }
          break
        }
        case 'windup': {
          const k = 1 - e.t / cfg.windup
          const rr = cfg.reach + 0.2
          e.ring.scale.setScalar(rr * (0.3 + 0.7 * k))
          ;(e.ring.material as THREE.MeshBasicMaterial).opacity = 0.3 + 0.5 * k
          e.mesh.rotation.y = Math.atan2(toP.x, toP.z)
          if (e.t <= 0) {
            e.state = 'strike'
            e.t = 0.15
            e.ring.visible = false
            // lunge
            if (dist > 0.01) e.vel.addScaledVector(toP.clone().divideScalar(dist), e.kind === 'brute' ? 5 : 8)
            if (dist < cfg.reach + PLAYER_R + 0.3) this.hurtPlayer(e.dmg, e.pos)
            if (e.kind === 'brute') {
              this.shake = Math.max(this.shake, 0.45)
              this.spawnBurst(e.pos, cfg.reach, new THREE.Color(cfg.color))
            }
          }
          break
        }
        case 'strike':
          if (e.t <= 0) {
            e.state = 'recover'
            e.t = e.kind === 'brute' ? 0.9 : 0.6
          }
          break
        case 'recover':
          if (e.t <= 0) e.state = 'chase'
          break
      }

      // knockback
      e.pos.addScaledVector(e.vel, dt)
      e.vel.multiplyScalar(Math.exp(-8 * dt))

      // rig animation
      e.flash -= dt
      const recoverDur = e.kind === 'brute' ? 0.9 : 0.6
      const stateDur = e.state === 'spawn' ? 0.7 : e.state === 'windup' ? cfg.windup : e.state === 'strike' ? 0.15 : e.state === 'recover' ? recoverDur : 1
      e.rig.update(dt, {
        state: e.state,
        k: Math.min(1, Math.max(0, 1 - e.t / stateDur)),
        moving: e.state === 'chase' && dist > 0.3,
        time: this.time + e.seed,
        flash: e.flash > 0,
      })
    }

    // separation between enemies
    const alive = this.enemies.filter((e) => !e.dead)
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i]
        const b = alive[j]
        const dx = b.pos.x - a.pos.x
        const dz = b.pos.z - a.pos.z
        const d = Math.hypot(dx, dz)
        const min = a.r + b.r
        if (d < min && d > 1e-4) {
          const push = (min - d) / 2
          a.pos.x -= (dx / d) * push
          a.pos.z -= (dz / d) * push
          b.pos.x += (dx / d) * push
          b.pos.z += (dz / d) * push
        }
      }
    }
    for (const e of alive) {
      this.collide(e.pos, e.r)
      e.mesh.position.copy(e.pos)
    }
    this.enemies = alive
  }

  private collide(p: THREE.Vector3, r: number) {
    for (const pr of this.props) {
      const dx = p.x - pr.pos.x
      const dz = p.z - pr.pos.z
      const d = Math.hypot(dx, dz)
      const min = pr.r + r
      if (d < min) {
        if (d < 1e-4) p.x += min
        else {
          p.x = pr.pos.x + (dx / d) * min
          p.z = pr.pos.z + (dz / d) * min
        }
      }
    }
    const lim = ARENA - r
    p.x = THREE.MathUtils.clamp(p.x, -lim, lim)
    p.z = THREE.MathUtils.clamp(p.z, -lim, lim)
  }

  // ───────────── vfx ─────────────

  private spawnParticle(at: THREE.Vector3, color: THREE.Color, speed: number, life: number, up = false) {
    if (this.particles.length > 400) return
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true })
    const m = new THREE.Mesh(this.geo.shard, mat)
    m.position.copy(at)
    m.rotation.set(Math.random() * 6, Math.random() * 6, 0)
    const v = new THREE.Vector3(Math.random() - 0.5, up ? 1 + Math.random() : Math.random() * 0.8 + 0.2, Math.random() - 0.5)
      .normalize()
      .multiplyScalar(speed * (0.5 + Math.random() * 0.7))
    this.scene.add(m)
    this.particles.push({ mesh: m, vel: v, life, max: life })
  }

  private spawnBurst(at: THREE.Vector3, radius: number, color?: THREE.Color) {
    const mat = new THREE.MeshBasicMaterial({
      color: color ?? this.colorA,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const ring = new THREE.Mesh(this.geo.ring, mat)
    ring.rotation.x = -Math.PI / 2
    ring.position.copy(at).setY(0.05)
    this.scene.add(ring)
    this.bursts.push({ mesh: ring, t: 0, max: 0.45, scale: radius })
    if (!color) {
      const dome = new THREE.Mesh(this.geo.sphere, mat.clone())
      ;(dome.material as THREE.MeshBasicMaterial).color = this.colorB.clone()
      dome.position.copy(at).setY(0)
      this.scene.add(dome)
      this.bursts.push({ mesh: dome, t: 0, max: 0.35, scale: radius * 0.8 })
    }
  }

  private spawnSlash(big: boolean) {
    const mat = new THREE.MeshBasicMaterial({
      color: this.colorB,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const geo = new THREE.RingGeometry(LIGHT_RANGE * 0.55, LIGHT_RANGE, 24, 1, -Math.PI * 0.35, Math.PI * 0.7)
    const m = new THREE.Mesh(geo, mat)
    m.rotation.x = -Math.PI / 2
    // ring arc is centred on local +X; lay it flat, then yaw it so +X points along `facing`
    m.rotation.order = 'YXZ'
    m.rotation.set(-Math.PI / 2, this.facing - Math.PI / 2, 0)
    m.position.copy(this.ppos).setY(big ? 0.4 : 0.9)
    this.scene.add(m)
    this.bursts.push({ mesh: m, t: 0, max: 0.18, scale: big ? 1.25 : 1 })
  }

  private floatText(at: THREE.Vector3, text: string, cls: string) {
    const el = document.createElement('div')
    el.className = `dmg ${cls}`
    el.textContent = text
    this.overlay.appendChild(el)
    this.floaters.push({ el, pos: at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, 0)), t: 0 })
  }

  private updateVfx(dt: number) {
    for (const p of this.particles) {
      p.life -= dt
      p.vel.y -= 14 * dt
      p.mesh.position.addScaledVector(p.vel, dt)
      if (p.mesh.position.y < 0.05) {
        p.mesh.position.y = 0.05
        p.vel.multiplyScalar(0.5)
        p.vel.y = Math.abs(p.vel.y) * 0.3
      }
      p.mesh.rotation.x += dt * 8
      const k = Math.max(0, p.life / p.max)
      p.mesh.scale.setScalar(k)
      ;(p.mesh.material as THREE.MeshBasicMaterial).opacity = k
      if (p.life <= 0) {
        this.scene.remove(p.mesh)
        ;(p.mesh.material as THREE.Material).dispose()
      }
    }
    this.particles = this.particles.filter((p) => p.life > 0)

    for (const b of this.bursts) {
      b.t += dt
      const k = Math.min(1, b.t / b.max)
      const s = b.scale * (0.2 + 0.8 * (1 - (1 - k) ** 3))
      b.mesh.scale.setScalar(s)
      ;(b.mesh.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - k)
      if (b.t >= b.max) {
        this.scene.remove(b.mesh)
        ;(b.mesh.material as THREE.Material).dispose()
        if (b.mesh.geometry !== this.geo.ring && b.mesh.geometry !== this.geo.sphere) b.mesh.geometry.dispose()
      }
    }
    this.bursts = this.bursts.filter((b) => b.t < b.max)

    const w = this.container.clientWidth
    const h = this.container.clientHeight
    const v = new THREE.Vector3()
    for (const f of this.floaters) {
      f.t += dt
      v.copy(f.pos).setY(f.pos.y + f.t * 1.4).project(this.camera)
      const x = (v.x * 0.5 + 0.5) * w
      const y = (-v.y * 0.5 + 0.5) * h
      const pop = f.t < 0.1 ? 1 + (0.1 - f.t) * 6 : 1
      f.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${pop})`
      f.el.style.opacity = String(Math.max(0, 1 - Math.max(0, f.t - 0.45) / 0.35))
      if (f.t > 0.8) f.el.remove()
    }
    this.floaters = this.floaters.filter((f) => f.t <= 0.8)
  }

  // ───────────── main loop ─────────────

  private loop = () => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.loop)
    const rawDt = Math.min(this.clock.getDelta(), 0.05)
    this.time += rawDt
    let dt = rawDt
    if (this.hitStop > 0) {
      this.hitStop -= rawDt
      dt = rawDt * 0.05
    }
    this.update(dt, rawDt)
    this.renderer.render(this.scene, this.camera)
  }

  private update(dt: number, rawDt: number) {
    // timers
    this.specialCd = Math.max(0, this.specialCd - dt)
    this.dodgeCd = Math.max(0, this.dodgeCd - dt)
    this.iframes = Math.max(0, this.iframes - dt)
    this.comboTimer = Math.max(0, this.comboTimer - dt)
    this.playerFlash = Math.max(0, this.playerFlash - dt)

    // player movement & actions
    const inp = this.moveInput(new THREE.Vector3())
    let moveSpeed = 0
    if (!this.gameOver && !this.loading) {
      if (this.action === 'dodge') {
        this.ppos.addScaledVector(this.dodgeDir, DODGE_SPEED * dt * (1 - this.actionT / this.actionDur * 0.6))
        if (Math.random() < 0.6) this.spawnParticle(this.ppos.clone().setY(0.3 + Math.random()), this.colorA, 1, 0.3)
      } else {
        const mul = this.action === 'light' ? 0.25 : this.action === 'heavy' ? 0 : 1
        const len = inp.length()
        if (len > 0.05) {
          this.ppos.addScaledVector(inp, MOVE_SPEED * mul * dt)
          if (this.action === 'none') {
            const target = Math.atan2(inp.x, inp.z)
            let diff = target - this.facing
            diff = Math.atan2(Math.sin(diff), Math.cos(diff))
            this.facing += diff * Math.min(1, dt * 14)
          }
          moveSpeed = len * mul
        }
      }
      if (this.action !== 'none') {
        this.actionT += dt
        this.resolveHits()
        if (this.actionT >= this.actionDur) {
          const was = this.action
          this.action = 'none'
          this.actionT = 0
          if (was === 'light') {
            this.combo = (this.combo + 1) % 3
            this.comboTimer = this.combo === 0 ? 0 : COMBO_WINDOW
            if (this.queuedAttack) this.startLight()
          }
        }
      }
      this.collide(this.ppos, PLAYER_R)
    }
    this.speedFactor = THREE.MathUtils.lerp(this.speedFactor, moveSpeed, Math.min(1, dt * 12))
    this.player.position.copy(this.ppos)
    this.player.rotation.y = this.facing
    this.player.visible = !this.gameOver && (this.iframes <= 0 || this.action !== 'none' || Math.floor(this.time * 20) % 2 === 0)
    this.avatar?.update(dt, {
      speed: this.speedFactor,
      action: this.action,
      actionT: this.actionDur ? Math.min(1, this.actionT / this.actionDur) : 0,
      combo: this.combo,
    })

    // waves
    if (!this.gameOver && !this.loading) {
      if (this.toSpawn.length) {
        this.spawnTimer -= dt
        if (this.spawnTimer <= 0) {
          this.spawnEnemy(this.toSpawn.shift()!)
          this.spawnTimer = Math.max(0.25, 0.9 - this.wave * 0.05)
        }
      } else if (this.enemies.length === 0) {
        this.waveDelay -= dt
        if (this.waveDelay <= 0) {
          this.waveDelay = 2.5
          this.startWave()
        }
      }
    }
    this.updateEnemies(dt)
    this.updateVfx(dt)

    if (this.bannerT > 0) {
      this.bannerT -= rawDt
      if (this.bannerT <= 0) {
        this.banner = null
        this.emitHud(true)
      }
    }

    // camera follow + shake
    const camTarget = new THREE.Vector3(this.ppos.x, 0, this.ppos.z)
    const desired = camTarget.clone().add(new THREE.Vector3(0, 7.2, 8.6))
    this.camera.position.lerp(desired, 1 - Math.exp(-6 * rawDt))
    this.shake = Math.max(0, this.shake - rawDt * 1.8)
    if (this.shake > 0) {
      const s = this.shake * this.shake * 0.6
      this.camera.position.x += (Math.random() - 0.5) * s
      this.camera.position.y += (Math.random() - 0.5) * s
    }
    this.camera.lookAt(this.camera.position.x, 0.8, this.camera.position.z - 8.6)

    this.sun.position.set(this.ppos.x + 8, 16, this.ppos.z + 6)
    this.sun.target.position.copy(this.ppos)
    this.floorMat.uniforms.uTime.value = this.time
    this.dust.rotation.y += rawDt * 0.01
    for (const s of this.spinners) s.rotation.y += rawDt * 1.5

    this.hudT -= rawDt
    if (this.hudT <= 0) this.emitHud()
  }

  private emitHud(force = false) {
    if (!force && this.hudT > 0) return
    this.hudT = 0.08
    this.onHud({
      hp: this.hp,
      maxHp: this.maxHp,
      special: this.specialCd,
      specialMax: HEAVY_CD,
      dodge: this.dodgeCd,
      wave: this.wave,
      kills: this.kills,
      score: this.score,
      enemies: this.enemies.length + this.toSpawn.length,
      loading: this.loading,
      modelKind: this.avatar?.kind ?? null,
      credit: this.avatar?.credit,
      gameOver: this.gameOver,
      banner: this.banner,
    })
  }

  restart() {
    for (const e of this.enemies) {
      this.scene.remove(e.mesh)
      e.rig.dispose()
      ;(e.ring.material as THREE.Material).dispose()
    }
    this.enemies = []
    this.toSpawn = []
    this.hp = this.maxHp
    this.ppos.set(0, 0, 0)
    this.facing = 0
    this.action = 'none'
    this.actionT = 0
    this.combo = 0
    this.comboTimer = 0
    this.queuedAttack = false
    this.specialCd = 0
    this.dodgeCd = 0
    this.iframes = 1
    this.wave = 0
    this.kills = 0
    this.score = 0
    this.waveDelay = 1.2
    this.gameOver = false
    this.startWave()
    this.emitHud(true)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.cleanups.forEach((f) => f())
    for (const e of this.enemies) {
      e.rig.dispose()
      ;(e.ring.material as THREE.Material).dispose()
    }
    for (const p of this.particles) (p.mesh.material as THREE.Material).dispose()
    for (const b of this.bursts) {
      ;(b.mesh.material as THREE.Material).dispose()
      if (b.mesh.geometry !== this.geo.ring && b.mesh.geometry !== this.geo.sphere) b.mesh.geometry.dispose()
    }
    this.avatar?.dispose()
    disposeEnemyGeometries()
    this.disposables.forEach((d) => d.dispose())
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.renderer.domElement.remove()
    this.overlay.remove()
    this.container.classList.remove('hurt')
  }
}
