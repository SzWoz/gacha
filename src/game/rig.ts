// ─────────────────────────────────────────────────────────────
//  Proceduralna animacja szkieletu dla modeli bez klipów animacji.
//  Obsługuje szkielet „Bip001” (3ds Max biped), który mają modele ZZZ.
//
//  Każdą kość obracamy w przestrzeni postaci (Y = góra, +Z = przód,
//  +X = lewa strona postaci) względem pozy spoczynkowej (T/A-pose):
//    local = restLocal · (restWorld⁻¹ · R · restWorld)
//  dzięki czemu nie trzeba znać lokalnych osi kości.
// ─────────────────────────────────────────────────────────────

import * as THREE from 'three'
import type { GLTFLoaderPlugin, GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { AvatarState } from './avatar'

// ───────────── materiały KHR_materials_pbrSpecularGlossiness ─────────────
// three.js nie wspiera już tego rozszerzenia — bez niego tekstury są ignorowane,
// a materiał dostaje metalness = 1 (stąd „biały, metaliczny” wygląd).

interface SpecGlossExt {
  diffuseFactor?: number[]
  diffuseTexture?: { index: number }
  glossinessFactor?: number
}

export class SpecGlossPlugin implements GLTFLoaderPlugin {
  readonly name = 'KHR_materials_pbrSpecularGlossiness'
  private parser: GLTFParser
  constructor(parser: GLTFParser) {
    this.parser = parser
  }

  extendMaterialParams(materialIndex: number, params: Record<string, unknown>) {
    const def = this.parser.json.materials?.[materialIndex]
    const ext = def?.extensions?.[this.name] as SpecGlossExt | undefined
    if (!ext) return Promise.resolve()
    const f = ext.diffuseFactor
    if (Array.isArray(f) && f.length >= 3) {
      params.color = new THREE.Color().setRGB(f[0], f[1], f[2], THREE.LinearSRGBColorSpace)
      if (f.length > 3) params.opacity = f[3]
    } else {
      params.color = new THREE.Color(1, 1, 1)
    }
    params.metalness = 0
    params.roughness = THREE.MathUtils.clamp(1 - (ext.glossinessFactor ?? 0.3), 0.45, 1)
    const pending: Promise<unknown>[] = []
    if (ext.diffuseTexture) {
      pending.push(this.parser.assignTexture(params, 'map', ext.diffuseTexture, THREE.SRGBColorSpace))
    }
    return Promise.all(pending)
  }
}

/** Anime-owe tekstury mają już „namalowane” światło — rozjaśniamy cienie, żeby nie były błotniste. */
export function toonifyMaterials(model: THREE.Object3D) {
  model.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const mats = Array.isArray(m.material) ? m.material : [m.material]
    for (const mat of mats) {
      const s = mat as THREE.MeshStandardMaterial
      if (!s.isMeshStandardMaterial) continue
      s.metalness = Math.min(s.metalness, 0.1)
      s.roughness = Math.max(s.roughness, 0.55)
      if (s.map && !s.emissiveMap) {
        s.emissiveMap = s.map
        s.emissive = new THREE.Color(0.32, 0.32, 0.32)
      }
      s.needsUpdate = true
    }
  })
}

/**
 * Chowa siatki efektów (Eff_*) — w modelach UI wiszą jako luźne płaszczyzny.
 */
export function hideFloatingWeapons(model: THREE.Object3D): number {
  let hidden = 0
  model.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const mats = Array.isArray(m.material) ? m.material : [m.material]
    if (mats.some((x) => /^eff_/i.test(x?.name ?? ''))) {
      m.visible = false
      hidden++
    }
  })
  return hidden
}

/**
 * Przypina oryginalne bronie do dłoni. W modelach „UI” kości Bip001 Prop1/Prop2
 * (dzieci dłoni) są odsunięte do pozy wystawowej — zerujemy je, żeby broń trafiła do ręki.
 * Kości broni wiszące na korzeniu szkieletu (np. katana) przepinamy do prawej dłoni.
 * Zwraca true, jeśli postać ma widoczną broń w ręce.
 */
export function attachOriginalWeapons(model: THREE.Object3D, rHand: THREE.Object3D, lHand: THREE.Object3D): boolean {
  const isHand = (o: THREE.Object3D | null) => o === rHand || o === lHand
  const underHand = (o: THREE.Object3D) => {
    for (let p = o.parent; p; p = p.parent) if (isHand(p)) return true
    return false
  }
  const WEAPON_BONE = /weapon|wpn|wepon|katana|sword|blade|hilt/i
  const props: THREE.Object3D[] = []
  const loose: THREE.Object3D[] = []
  model.traverse((o) => {
    const n = normName(o.name)
    if ((/^bip001 prop[12]$/.test(n) || /(^|_)(bow|wpn|weapon|wepon)/i.test(o.name)) && isHand(o.parent)) props.push(o)
    else if (WEAPON_BONE.test(o.name) && !(o as THREE.Mesh).isMesh && !underHand(o)) {
      // tylko najwyższa kość broni w gałęzi, wisząca na korzeniu (nie na kręgosłupie — to np. kołczan)
      const parentName = normName(o.parent?.name ?? '')
      if (!WEAPON_BONE.test(o.parent?.name ?? '') && /^(bip001|rootjoint|bip001 pelvis)$/.test(parentName.replace(/^_/, ''))) loose.push(o)
    }
  })
  for (const p of props) {
    p.position.set(0, 0, 0)
    p.quaternion.identity()
  }
  // luźne bronie — tylko jeśli prawa dłoń nie ma już broni z Prop1
  const rightHasProp = props.some((p) => p.parent === rHand && p.children.length > 0)
  if (!rightHasProp) {
    for (const b of loose) {
      rHand.add(b)
      b.position.set(0, 0, 0)
      b.quaternion.identity()
      b.scale.set(1, 1, 1)
    }
  }
  // czy jakakolwiek widoczna siatka broni jest teraz związana z dłonią?
  let armed = false
  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh
    if (!m.isSkinnedMesh || !m.visible) return
    const mats = Array.isArray(m.material) ? m.material : [m.material]
    if (!mats.some((x) => /weapon|wpn|wepon/i.test(x?.name ?? ''))) return
    if (m.skeleton.bones.some((b) => underHand(b) && b.name && WEAPON_BONE.test(b.name + (b.parent?.name ?? '')))) armed = true
    else if (m.skeleton.bones.some((b) => /prop[12]/i.test(b.name) && isHand(b.parent))) armed = armed || props.length > 0
  })
  return armed || props.some((p) => p.children.length > 0)
}

/** Chowa siatki, których środek jest daleko od osi postaci (resztki pozy wystawowej). */
export function hideFarMeshes(model: THREE.Object3D, root: THREE.Object3D, maxDist: number, maxY = Infinity) {
  root.updateMatrixWorld(true)
  const inv = root.matrixWorld.clone().invert()
  const box = new THREE.Box3()
  const c = new THREE.Vector3()
  let hidden = 0
  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh
    if (!m.isMesh || !m.visible) return
    if (m.isSkinnedMesh) m.computeBoundingBox()
    else if (!m.geometry.boundingBox) m.geometry.computeBoundingBox()
    const bb = m.isSkinnedMesh ? m.boundingBox : m.geometry.boundingBox
    if (!bb || bb.isEmpty()) return
    box.copy(bb).applyMatrix4(m.matrixWorld).applyMatrix4(inv)
    box.getCenter(c)
    if (Math.hypot(c.x, c.z) > maxDist || c.y > maxY) {
      m.visible = false
      hidden++
    }
  })
  return hidden
}

// ───────────── mapowanie kości ─────────────

const BONES = {
  spine: 'bip001 spine',
  spine1: 'bip001 spine1',
  spine2: 'bip001 spine2',
  neck: 'bip001 neck',
  head: 'bip001 head',
  lUpper: 'bip001 l upperarm',
  lFore: 'bip001 l forearm',
  lHand: 'bip001 l hand',
  rUpper: 'bip001 r upperarm',
  rFore: 'bip001 r forearm',
  rHand: 'bip001 r hand',
  lThigh: 'bip001 l thigh',
  lCalf: 'bip001 l calf',
  lFoot: 'bip001 l foot',
  rThigh: 'bip001 r thigh',
  rCalf: 'bip001 r calf',
  rFoot: 'bip001 r foot',
} as const
type BoneKey = keyof typeof BONES

// „Bip001_L_UpperArm_074” → „bip001 l upperarm”
const normName = (n: string) =>
  n
    .replace(/_\d+$/, '')
    .replace(/[\s_]+/g, ' ')
    .trim()
    .toLowerCase()

interface RigBone {
  bone: THREE.Object3D
  restLocal: THREE.Quaternion
  restWorld: THREE.Quaternion
  restWorldInv: THREE.Quaternion
  /** kierunek kości w pozie spoczynkowej (do następnego stawu) w przestrzeni postaci */
  dir: THREE.Vector3
}

const AX = new THREE.Vector3(1, 0, 0)
const AY = new THREE.Vector3(0, 1, 0)
const AZ = new THREE.Vector3(0, 0, 1)
const DOWN = new THREE.Vector3(0, -1, 0)

const _q = new THREE.Quaternion()
const _q2 = new THREE.Quaternion()
const _q3 = new THREE.Quaternion()

const axisAngle = (out: THREE.Quaternion, axis: THREE.Vector3, a: number) => out.setFromAxisAngle(axis, a)

function applyRot(b: RigBone, R: THREE.Quaternion) {
  _q.copy(b.restWorldInv).multiply(R).multiply(b.restWorld)
  b.bone.quaternion.copy(b.restLocal).multiply(_q)
}

/** płynnie dążące parametry pozy */
class Pose {
  v: Record<string, number> = {}
  get(k: string) {
    return this.v[k] ?? 0
  }
  to(k: string, target: number, rate: number, dt: number) {
    const c = this.get(k)
    this.v[k] = c + (target - c) * (1 - Math.exp(-rate * dt))
    return this.v[k]
  }
}

export interface BoneAnimator {
  update(dt: number, s: AvatarState): void
  rightHand: THREE.Object3D
  leftHand: THREE.Object3D
  head: THREE.Object3D | null
  rightForearm: THREE.Object3D
}

/**
 * Szuka szkieletu Bip001 i, jeśli jest kompletny, zwraca animator.
 * Wywołać PO ustawieniu skali/obrotu modelu i z modelem w korzeniu o tożsamościowej transformacji.
 * Zwraca też `facingFlip` — true, gdy model patrzy w -Z (trzeba go obrócić o 180°).
 */
export function detectFacingFlip(model: THREE.Object3D): boolean {
  const found = findBones(model)
  if (!found.lUpper || !found.rUpper) return false
  model.updateMatrixWorld(true)
  const l = found.lUpper.getWorldPosition(new THREE.Vector3())
  const r = found.rUpper.getWorldPosition(new THREE.Vector3())
  // postać patrząca w +Z ma lewą rękę po stronie +X
  return l.x < r.x
}

function findBones(model: THREE.Object3D) {
  const byName = new Map<string, BoneKey>()
  for (const [k, n] of Object.entries(BONES)) byName.set(n, k as BoneKey)
  const found: Partial<Record<BoneKey, THREE.Object3D>> = {}
  model.traverse((o) => {
    const key = byName.get(normName(o.name))
    if (key && !found[key]) found[key] = o
  })
  return found
}

export function createBoneAnimator(model: THREE.Object3D, reference: THREE.Object3D): BoneAnimator | null {
  const found = findBones(model)
  const required: BoneKey[] = ['spine', 'lUpper', 'lFore', 'lHand', 'rUpper', 'rFore', 'rHand', 'lThigh', 'lCalf', 'lFoot', 'rThigh', 'rCalf', 'rFoot']
  if (required.some((k) => !found[k])) return null

  reference.updateMatrixWorld(true)
  const refInv = reference.getWorldQuaternion(new THREE.Quaternion()).invert()
  const refMatInv = reference.matrixWorld.clone().invert()
  const posOf = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3()).applyMatrix4(refMatInv)

  const mk = (key: BoneKey, child?: BoneKey): RigBone | null => {
    const bone = found[key]
    if (!bone) return null
    const restWorld = refInv.clone().multiply(bone.getWorldQuaternion(new THREE.Quaternion()))
    const dir = new THREE.Vector3(0, 1, 0)
    if (child && found[child]) {
      dir.copy(posOf(found[child]!)).sub(posOf(bone))
      if (dir.lengthSq() > 1e-10) dir.normalize()
      else dir.set(0, 1, 0)
    }
    return { bone, restLocal: bone.quaternion.clone(), restWorld, restWorldInv: restWorld.clone().invert(), dir }
  }

  const B = {
    spine: mk('spine')!,
    spine1: mk('spine1'),
    spine2: mk('spine2'),
    neck: mk('neck'),
    head: mk('head'),
    lUpper: mk('lUpper', 'lFore')!,
    lFore: mk('lFore', 'lHand')!,
    rUpper: mk('rUpper', 'rFore')!,
    rFore: mk('rFore', 'rHand')!,
    lThigh: mk('lThigh', 'lCalf')!,
    lCalf: mk('lCalf', 'lFoot')!,
    rThigh: mk('rThigh', 'rCalf')!,
    rCalf: mk('rCalf', 'rFoot')!,
  }
  const spines = [B.spine, B.spine1, B.spine2].filter((x): x is RigBone => !!x)

  // ramiona: obrót z T/A-pose do opuszczonych wzdłuż ciała (lekko odsuniętych)
  const armDown = (b: RigBone, side: number) => {
    const target = new THREE.Vector3(side * Math.sin(0.2), -Math.cos(0.2), 0.04).normalize()
    return new THREE.Quaternion().setFromUnitVectors(b.dir, target)
  }
  // side: +1 = lewa ręka (po +X), -1 = prawa
  const arms = [
    { up: B.lUpper, fore: B.lFore, side: 1, down: armDown(B.lUpper, 1), p: 'l' },
    { up: B.rUpper, fore: B.rFore, side: -1, down: armDown(B.rUpper, -1), p: 'r' },
  ]
  // oś zgięcia łokcia (w pozie spoczynkowej): obraca przedramię w stronę +Z
  const elbowAxis = (fore: RigBone) => {
    const a = new THREE.Vector3().crossVectors(fore.dir, AZ)
    return a.lengthSq() < 1e-6 ? AX.clone() : a.normalize()
  }
  const elbowAxes = { l: elbowAxis(B.lFore), r: elbowAxis(B.rFore) }
  // nogi: prostujemy do pionu (część modeli stoi w lekkim rozkroku)
  const legDown = (b: RigBone, side: number) => {
    const target = new THREE.Vector3(side * 0.06, -1, 0).normalize()
    const flat = b.dir.clone()
    return new THREE.Quaternion().setFromUnitVectors(flat, target).slerp(new THREE.Quaternion(), 0.5)
  }
  const legs = [
    { thigh: B.lThigh, calf: B.lCalf, side: 1, down: legDown(B.lThigh, 1), p: 'l' },
    { thigh: B.rThigh, calf: B.rCalf, side: -1, down: legDown(B.rThigh, -1), p: 'r' },
  ]
  const kneeAxis = (calf: RigBone) => {
    // zgięcie kolana: stopa idzie do tyłu (-Z)
    const a = new THREE.Vector3().crossVectors(calf.dir.lengthSq() ? calf.dir : DOWN, new THREE.Vector3(0, 0, -1))
    return a.lengthSq() < 1e-6 ? AX.clone() : a.normalize()
  }
  const kneeAxes = { l: kneeAxis(B.lCalf), r: kneeAxis(B.rCalf) }

  const P = new Pose()
  let phase = 0
  let time = 0
  const ident = new THREE.Quaternion()

  return {
    rightHand: found.rHand!,
    leftHand: found.lHand!,
    head: found.head ?? null,
    rightForearm: found.rFore!,
    update(dt, s) {
      time += dt
      const sp = s.speed
      phase += dt * (7 + 5 * sp) * (sp > 0.05 ? 1 : 0)
      const k = s.actionT
      const breathe = Math.sin(time * 2.2)

      // ── cele pozy ──
      const T: Record<string, number> = {
        lPitch: 0, rPitch: 0, lYaw: 0, rYaw: 0, lOut: 0, rOut: 0, lElbow: 0.25, rElbow: 0.25,
        lThigh: 0, rThigh: 0, lKnee: 0.04, rKnee: 0.04,
        lean: 0.02 + breathe * 0.015, twist: 0, side: 0, headPitch: -breathe * 0.01, headYaw: 0,
      }
      let rate = 14

      // bieg
      if (sp > 0.05) {
        const sL = Math.sin(phase)
        const sR = Math.sin(phase + Math.PI)
        T.lThigh = sL * 0.75 * sp
        T.rThigh = sR * 0.75 * sp
        T.lKnee = (0.15 + 1.0 * Math.max(0, Math.sin(phase - 1.3))) * sp + 0.04
        T.rKnee = (0.15 + 1.0 * Math.max(0, Math.sin(phase + Math.PI - 1.3))) * sp + 0.04
        T.lPitch = -sL * 0.7 * sp
        T.rPitch = -sR * 0.7 * sp
        T.lElbow = 0.25 + 1.0 * sp
        T.rElbow = 0.25 + 1.0 * sp
        T.lean = 0.22 * sp
        T.twist = sL * 0.18 * sp
        T.headYaw = -sL * 0.1 * sp
        rate = 22
      }

      // ataki — prawa ręka trzyma broń
      const ease = (x: number) => {
        const t = Math.min(1, Math.max(0, x))
        return t * t * (3 - 2 * t)
      }
      if (s.action === 'light') {
        rate = 40
        const wind = ease(k / 0.28)
        const hit = ease((k - 0.28) / 0.32)
        const back = ease((k - 0.7) / 0.3)
        if (s.combo === 2) {
          // cios znad głowy oburącz
          const raise = 2.9 * wind - 2.4 * hit
          T.rPitch = T.lPitch = raise * (1 - back)
          T.rElbow = T.lElbow = (0.5 - 0.3 * hit) * (1 - back) + 0.25 * back
          T.lYaw = -0.35 * (1 - back)
          T.rYaw = 0.35 * (1 - back)
          T.lean = (-0.25 * wind + 0.65 * hit) * (1 - back)
          T.lKnee = T.rKnee = 0.5 * hit * (1 - back)
          T.lThigh = 0.35 * hit * (1 - back)
          T.rThigh = -0.25 * hit * (1 - back)
        } else {
          // cięcie poziome: combo 0 z prawej na lewo, combo 1 odwrotnie
          const dir = s.combo === 0 ? 1 : -1
          const from = -1.3 * dir
          const to = 1.0 * dir
          const yaw = from * wind + (to - from) * hit
          T.rPitch = (1.45 * wind) * (1 - back)
          T.rYaw = yaw * (1 - back)
          T.rElbow = (0.15 + 0.4 * (1 - hit)) * (1 - back)
          T.twist = (from * 0.45 * wind + (to - from) * 0.45 * hit) * (1 - back)
          T.lPitch = 0.5 * (1 - back)
          T.lElbow = 1.2
          T.lean = 0.18 * (1 - back)
          T.lThigh = 0.4 * (1 - back)
          T.rThigh = -0.3 * (1 - back)
          T.lKnee = 0.35 * (1 - back)
          T.rKnee = 0.25 * (1 - back)
        }
      } else if (s.action === 'heavy') {
        rate = 30
        // obrót z rozłożonymi rękami, na końcu przysiad
        const open = ease(k / 0.2)
        const land = ease((k - 0.75) / 0.25)
        T.lOut = T.rOut = 0.9 * open * (1 - land * 0.6)
        T.lPitch = T.rPitch = 0.3 * open
        T.lElbow = T.rElbow = 0.1
        T.lKnee = T.rKnee = 0.25 + 0.6 * land
        T.lThigh = T.rThigh = 0.4 * land
        T.lean = 0.35 * land
      } else if (s.action === 'dodge') {
        rate = 40
        T.lThigh = 0.9
        T.rThigh = -0.7
        T.lKnee = 0.9
        T.rKnee = 0.6
        T.lPitch = -0.9
        T.rPitch = -0.9
        T.lElbow = T.rElbow = 0.4
        T.lean = 0.3
      }

      for (const key of Object.keys(T)) P.to(key, T[key], rate, dt)

      // ── zastosuj na kościach ──
      // kręgosłup — rozłożony na segmenty
      const n = spines.length
      for (const b of spines) {
        axisAngle(_q2, AX, P.get('lean') / n)
        axisAngle(_q3, AY, P.get('twist') / n)
        _q2.premultiply(_q3)
        axisAngle(_q3, AZ, P.get('side') / n)
        _q2.premultiply(_q3)
        applyRot(b, _q2)
      }
      if (B.head) {
        axisAngle(_q2, AX, P.get('headPitch') - P.get('lean') * 0.4)
        axisAngle(_q3, AY, P.get('headYaw') - P.get('twist') * 0.5)
        applyRot(B.head, _q2.premultiply(_q3))
      }

      for (const a of arms) {
        const p = a.p
        // R = yaw · pitch · slerp(down → T-pose, out)
        _q2.copy(a.down).slerp(ident, P.get(p + 'Out'))
        axisAngle(_q3, AX, -P.get(p + 'Pitch'))
        _q2.premultiply(_q3)
        axisAngle(_q3, AY, P.get(p + 'Yaw'))
        _q2.premultiply(_q3)
        applyRot(a.up, _q2)
        axisAngle(_q2, elbowAxes[p as 'l' | 'r'], P.get(p + 'Elbow'))
        applyRot(a.fore, _q2)
      }

      for (const l of legs) {
        const p = l.p
        axisAngle(_q3, AX, -P.get(p + 'Thigh'))
        _q2.copy(l.down).premultiply(_q3)
        applyRot(l.thigh, _q2)
        axisAngle(_q2, kneeAxes[p as 'l' | 'r'], P.get(p + 'Knee'))
        applyRot(l.calf, _q2)
      }
    },
  }
}
