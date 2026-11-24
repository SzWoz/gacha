import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { attachOriginalWeapons, createBoneAnimator, detectFacingFlip, hideFarMeshes, hideFloatingWeapons, SpecGlossPlugin, toonifyMaterials, type BoneAnimator } from './rig'

/** Shape of public/models/manifest.json (keyed by exact roster name). */
export interface ModelEntry {
  url: string
  source?: string | null
  author?: string | null
  license?: string | null
}
export type Manifest = Record<string, ModelEntry>

let manifestPromise: Promise<Manifest> | null = null

/**
 * Fetches /models/manifest.json; a 404 / bad JSON means "no models".
 * Only a non-empty manifest is cached, so models downloaded while the page is open
 * show up the next time a game starts (no reload needed).
 */
export function loadManifest(): Promise<Manifest> {
  if (manifestPromise) return manifestPromise
  const p = fetch(`${import.meta.env.BASE_URL}models/manifest.json`, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : {}))
    .then((j: unknown) => (j && typeof j === 'object' && !Array.isArray(j) ? (j as Manifest) : {}))
    .catch(() => ({}) as Manifest)
  manifestPromise = p
  void p.then((m) => {
    if (!Object.keys(m).length && manifestPromise === p) manifestPromise = null
  })
  return p
}

/** Manifest urls are absolute ("/models/..."); respect a non-root Vite base. */
export function resolveModelUrl(url: string): string {
  // serwer deweloperski Vite nie znajduje plików z „%26” w ścieżce (np. „Orphie Magnusson & Magus”) — surowy „&” działa wszędzie
  url = url.replace(/%26/gi, '&')
  const base = import.meta.env.BASE_URL
  if (/^[a-z]+:/i.test(url) || !url.startsWith('/') || base === '/' || url.startsWith(base)) return url
  return base.replace(/\/$/, '') + url
}

export type ActionKind = 'none' | 'light' | 'heavy' | 'dodge'

export interface AvatarState {
  /** 0..1 — how fast the character is moving relative to max speed */
  speed: number
  action: ActionKind
  /** 0..1 progress of the current action */
  actionT: number
  /** light-attack combo step 0..2 */
  combo: number
  /** broń dystansowa: atak = celowanie zamiast cięcia; side = ręka ostatniego strzału (1 lewa, -1 prawa) */
  ranged?: { dual: boolean; side: number }
}

export interface Avatar {
  root: THREE.Object3D
  kind: 'model' | 'placeholder'
  credit?: string
  /** diagnostyka modelu (rig, broń) */
  debug?: { rig: boolean; clips: number; armed: boolean; hidden: number }
  update(dt: number, s: AvatarState): void
  dispose(): void
}

export const TARGET_HEIGHT = 1.8

// ───────────────────────── glTF model ─────────────────────────

const pickClip = (clips: THREE.AnimationClip[], re: RegExp, exclude?: RegExp) =>
  clips.find((c) => re.test(c.name) && !(exclude && exclude.test(c.name)))

export async function loadModelAvatar(entry: ModelEntry, signal: { cancelled: boolean }, _accent = '#7cffd4'): Promise<Avatar> {
  const loader = new GLTFLoader()
  loader.register((parser) => new SpecGlossPlugin(parser))
  const gltf = await loader.loadAsync(resolveModelUrl(entry.url))
  if (signal.cancelled) {
    disposeObject(gltf.scene)
    throw new Error('cancelled')
  }
  // a fresh load per game session, so the scene is used directly (no clone needed)
  const model = gltf.scene

  model.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) {
      m.castShadow = true
      m.frustumCulled = false
    }
  })
  toonifyMaterials(model)
  // modele mają patrzeć w +Z (tam silnik kieruje „przód” postaci)
  if (detectFacingFlip(model)) model.rotation.y += Math.PI

  // auto-scale to TARGET_HEIGHT, feet on the ground, centered on x/z
  model.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(model)
  const size = box.getSize(new THREE.Vector3())
  const h = size.y > 1e-4 ? size.y : Math.max(size.x, size.z, 1)
  const s = TARGET_HEIGHT / h
  model.scale.multiplyScalar(s)
  model.updateMatrixWorld(true)
  box.setFromObject(model)
  const center = box.getCenter(new THREE.Vector3())
  model.position.x -= center.x
  model.position.z -= center.z
  model.position.y -= box.min.y

  const pivot = new THREE.Group() // lunge/lean applied here
  pivot.add(model)
  const root = new THREE.Group()
  root.add(pivot)

  const clips = gltf.animations ?? []
  // brak klipów → animujemy szkielet proceduralnie (jeśli go rozpoznamy)
  const bones = clips.length ? null : createBoneAnimator(model, root)
  const weapons = bones ? prepareWeapons(bones, root, model) : null
  const mixer = new THREE.AnimationMixer(model)
  const idleClip = pickClip(clips, /idle|stand|wait|breath/i) ?? clips[0]
  const runClip = pickClip(clips, /run|sprint|dash/i) ?? pickClip(clips, /walk|move|jog/i) ?? idleClip
  const attackClip = pickClip(clips, /attack|atk|slash|swing|punch|kick|combo|skill|strike/i, /hit_?react|damage|hurt/i)
  const actions = new Map<THREE.AnimationClip, THREE.AnimationAction>()
  const act = (c: THREE.AnimationClip) => {
    let a = actions.get(c)
    if (!a) {
      a = mixer.clipAction(c)
      actions.set(c, a)
    }
    return a
  }
  let current: THREE.AnimationAction | null = null
  const play = (clip: THREE.AnimationClip | undefined, once = false) => {
    if (!clip) return
    const a = act(clip)
    if (a === current && !once) return
    a.reset()
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity)
    a.clampWhenFinished = once
    a.enabled = true
    a.play()
    if (current && current !== a) current.crossFadeTo(a, 0.15, false)
    current = a
  }
  if (idleClip) play(idleClip)

  let lastAction: ActionKind = 'none'
  let lastCombo = -1

  return {
    root,
    kind: 'model',
    debug: { rig: !!bones, clips: clips.length, armed: weapons?.armed ?? false, hidden: weapons?.hidden ?? 0 },
    credit: entry.author ? `${entry.author}${entry.license ? ` · ${entry.license}` : ''}` : undefined,
    update(dt, st) {
      const attacking = st.action === 'light' || st.action === 'heavy'
      if (attacking && attackClip) {
        if (st.action !== lastAction || st.combo !== lastCombo) {
          play(attackClip, true)
          if (current) current.timeScale = st.action === 'heavy' ? 1.2 : 1.8
        }
      } else if (st.speed > 0.15 && runClip) {
        play(runClip)
        if (current) current.timeScale = runClip === idleClip ? 1 : 0.6 + st.speed * 0.6
      } else if (idleClip) {
        play(idleClip)
        if (current) current.timeScale = 1
      }
      lastAction = st.action
      lastCombo = st.combo
      mixer.update(dt)
      bones?.update(dt, st)

      // procedural accents on top of (or instead of) clips
      const k = st.actionT
      let lean = 0
      let lunge = 0
      let spin = 0
      const b = bones ? 0.35 : 1 // przy animacji kości akcenty całego ciała są subtelniejsze
      pivot.position.y = 0
      if (st.action === 'light' && !attackClip && !st.ranged) {
        lunge = Math.sin(k * Math.PI) * 0.35
        lean = Math.sin(k * Math.PI) * 0.25 * b
        spin = (k - 0.5) * (st.combo === 1 ? -1.4 : 1.4) * b
      } else if (st.action === 'heavy' && !attackClip) {
        spin = k * Math.PI * 2
        lean = Math.sin(k * Math.PI) * 0.2 * b
      } else if (st.action === 'dodge') {
        lean = 0.5 * Math.sin(k * Math.PI) * (bones ? 0.5 : 1)
      } else if (!runClip || runClip === idleClip) {
        lean = st.speed * 0.15 * b
        pivot.position.y = Math.abs(Math.sin(performance.now() / (bones ? 95 : 110))) * (bones ? 0.05 : 0.08) * st.speed
      }
      pivot.rotation.x = THREE.MathUtils.lerp(pivot.rotation.x, lean, 0.35)
      pivot.rotation.y = spin
      pivot.position.z = lunge
    },
    dispose() {
      mixer.stopAllAction()
      mixer.uncacheRoot(model)
      disposeObject(model)
    },
  }
}

/** Przypina oryginalną broń postaci do dłoni i sprząta resztki pozy wystawowej. Nie dokłada żadnej broni. */
function prepareWeapons(bones: BoneAnimator, root: THREE.Object3D, model: THREE.Object3D) {
  hideFloatingWeapons(model)
  const armed = attachOriginalWeapons(model, bones.rightHand, bones.leftHand)
  // poza spoczynkowa → sprzątnięcie „wiszących” resztek
  const idle: AvatarState = { speed: 0, action: 'none', actionT: 0, combo: 0 }
  for (let i = 0; i < 4; i++) bones.update(1, idle)
  root.updateMatrixWorld(true)
  // oś postaci = pozycja głowy (środek bounding boxa bywa przesunięty przez rekwizyty z pozy wystawowej)
  const headW = bones.head ? bones.head.getWorldPosition(new THREE.Vector3()) : null
  const axis = headW ? headW.clone().applyMatrix4(root.matrixWorld.clone().invert()) : undefined
  const headY = axis ? axis.y : TARGET_HEIGHT
  const maxY = bones.inferred ? Infinity : headY + TARGET_HEIGHT * 0.12
  const hidden = hideFarMeshes(model, root, TARGET_HEIGHT * 0.42, maxY, armed, axis)
  if (hidden > 0) refitVisible(model, root)
  return { armed, hidden }
}

/** Po ukryciu części modelu: ponownie skaluje do TARGET_HEIGHT i stawia stopy na ziemi (wg widocznych siatek). */
function refitVisible(model: THREE.Object3D, root: THREE.Object3D) {
  const measure = () => {
    root.updateMatrixWorld(true)
    const inv = root.matrixWorld.clone().invert()
    const box = new THREE.Box3()
    const tmp = new THREE.Box3()
    model.traverse((o) => {
      const m = o as THREE.SkinnedMesh
      if (!m.isMesh || !m.visible) return
      if (m.isSkinnedMesh) m.computeBoundingBox()
      else if (!m.geometry.boundingBox) m.geometry.computeBoundingBox()
      const bb = m.isSkinnedMesh ? m.boundingBox : m.geometry.boundingBox
      if (bb && !bb.isEmpty()) box.union(tmp.copy(bb).applyMatrix4(m.matrixWorld).applyMatrix4(inv))
    })
    return box
  }
  let box = measure()
  const h = box.max.y - box.min.y
  if (!(h > 1e-3)) return
  model.scale.multiplyScalar(TARGET_HEIGHT / h)
  box = measure()
  const c = box.getCenter(new THREE.Vector3())
  model.position.x -= c.x
  model.position.z -= c.z
  model.position.y -= box.min.y
  root.updateMatrixWorld(true)
}

// ───────────────────────── procedural placeholder ─────────────────────────

export function createPlaceholderAvatar(color: string, accent: string): Avatar {
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)

  const main = new THREE.MeshStandardMaterial({ color: 0x1a1726, roughness: 0.5, metalness: 0.3 })
  const tint = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, roughness: 0.4 })
  const glow = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 2.2 })
  const geos: THREE.BufferGeometry[] = []
  const g = <T extends THREE.BufferGeometry>(x: T) => (geos.push(x), x)

  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
    const m = new THREE.Mesh(geo, mat)
    m.castShadow = true
    return m
  }

  // torso
  const torso = mesh(g(new THREE.CapsuleGeometry(0.26, 0.5, 4, 10)), tint)
  torso.position.y = 1.15
  body.add(torso)
  const chest = mesh(g(new THREE.BoxGeometry(0.44, 0.16, 0.3)), main)
  chest.position.set(0, 1.32, 0.04)
  body.add(chest)
  // head
  const head = mesh(g(new THREE.SphereGeometry(0.2, 16, 12)), main)
  head.position.y = 1.66
  body.add(head)
  const visor = mesh(g(new THREE.BoxGeometry(0.3, 0.06, 0.08)), glow)
  visor.position.set(0, 1.68, 0.17)
  body.add(visor)

  const limbGeo = g(new THREE.CapsuleGeometry(0.08, 0.42, 4, 8))
  const limb = (x: number, y: number, mat: THREE.Material) => {
    const pivot = new THREE.Group()
    pivot.position.set(x, y, 0)
    const m = mesh(limbGeo, mat)
    m.position.y = -0.28
    pivot.add(m)
    body.add(pivot)
    return pivot
  }
  const armL = limb(-0.36, 1.42, main)
  const armR = limb(0.36, 1.42, main)
  const legL = limb(-0.14, 0.78, main)
  const legR = limb(0.14, 0.78, main)

  // weapon in right hand
  const blade = mesh(g(new THREE.BoxGeometry(0.06, 0.08, 0.9)), glow)
  blade.position.set(0, -0.58, 0.4)
  armR.add(blade)

  let phase = 0
  return {
    root,
    kind: 'placeholder',
    update(dt, st) {
      phase += dt * (4 + st.speed * 8)
      const swing = Math.sin(phase) * 0.9 * st.speed
      legL.rotation.x = swing
      legR.rotation.x = -swing
      armL.rotation.x = -swing * 0.8
      armR.rotation.x = swing * 0.8
      armR.rotation.z = 0
      body.position.y = Math.abs(Math.sin(phase)) * 0.06 * st.speed + Math.sin(phase * 0.5) * 0.01
      body.rotation.x = st.speed * 0.15
      body.rotation.y = 0

      const k = st.actionT
      if (st.action === 'light') {
        const dir = st.combo === 1 ? -1 : 1
        const wind = k < 0.35 ? k / 0.35 : 1 - (k - 0.35) / 0.65
        if (st.combo === 2) {
          armR.rotation.x = -2.6 + k * 3.6 // overhead slam
        } else {
          armR.rotation.x = -1.4
          armR.rotation.z = dir * (1.4 - k * 2.8)
        }
        body.rotation.y = dir * (wind - 0.5) * 0.8
        body.rotation.x = 0.2 * Math.sin(k * Math.PI)
      } else if (st.action === 'heavy') {
        armR.rotation.x = -1.5
        armL.rotation.x = -1.5
        body.rotation.y = k * Math.PI * 2
        body.position.y = Math.sin(k * Math.PI) * 0.5
      } else if (st.action === 'dodge') {
        body.rotation.x = 0.7 * Math.sin(k * Math.PI)
        legL.rotation.x = 0.9
        legR.rotation.x = -0.6
      }
    },
    dispose() {
      geos.forEach((x) => x.dispose())
      main.dispose()
      tint.dispose()
      glow.dispose()
    },
  }
}

// ───────────────────────── utils ─────────────────────────

export function disposeObject(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    m.geometry?.dispose()
    const mats = Array.isArray(m.material) ? m.material : [m.material]
    for (const mat of mats) {
      if (!mat) continue
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose()
      mat.dispose()
    }
  })
}
