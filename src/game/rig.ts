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
 * Przypina oryginalne bronie do dłoni. W modelach „UI” kości Bip001 Prop1 (prawa dłoń) i Prop2 (lewa)
 * często wiszą na korzeniu szkieletu albo miednicy, w pozie wystawowej — przepinamy je do dłoni i zerujemy.
 * Luźne korzenie broni („Xxx_Weapon”, „Weapon_L01”, „Ctr_Wpn…” na korzeniu) trafiają do dłoni po stronie
 * wskazanej nazwą (L → lewa), a gdy dłoń ma już Prop — do niego.
 * Zwraca true, jeśli postać ma widoczną broń w ręce.
 */
let KEEP_GRIP = false
/** tylko do diagnostyki: zostaw oryginalny chwyt Propów, które już są w dłoni */
export function setKeepGrip(v: boolean) {
  KEEP_GRIP = v
}

export function attachOriginalWeapons(model: THREE.Object3D, rHand: THREE.Object3D, lHand: THREE.Object3D): boolean {
  const isHand = (o: THREE.Object3D | null) => o === rHand || o === lHand
  const underHand = (o: THREE.Object3D) => {
    for (let p = o.parent; p; p = p.parent) if (isHand(p)) return true
    return false
  }
  const WEAPON_BONE = /weapon|wpn|wepon|katana|sword|blade|hilt/i
  // kości ciała, pod którymi broń jest „noszona” (plecy, udo…), a nie wystawiona
  const BODY = /bip00\d (spine|neck|head|l |r |pelvis)/
  const bodyAncestor = (o: THREE.Object3D) => {
    for (let p = o.parent; p; p = p.parent) {
      const n = normName(p.name)
      if (BODY.test(n) && !/pelvis/.test(n)) return true
    }
    return false
  }

  const props: { bone: THREE.Object3D; hand: THREE.Object3D }[] = []
  const loose: THREE.Object3D[] = []
  model.traverse((o) => {
    const n = normName(o.name)
    if ((o as THREE.Mesh).isMesh) return
    if (/^bip00\d prop1$/.test(n)) props.push({ bone: o, hand: rHand })
    else if (/^bip00\d prop2$/.test(n)) props.push({ bone: o, hand: lHand })
    else if (/(^|_)(bow|wpn|weapon|wepon)/i.test(o.name) && isHand(o.parent)) props.push({ bone: o, hand: o.parent! })
    else if (WEAPON_BONE.test(o.name) && !underHand(o) && !WEAPON_BONE.test(o.parent?.name ?? '') && !bodyAncestor(o) && !/fx|eff/i.test(o.name)) loose.push(o)
  })
  model.updateMatrixWorld(true)
  const wp = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3())
  for (const { bone, hand } of props) {
    // Prop już w dłoni i tuż przy niej = poprawny chwyt z modelu (zostawiamy obrót);
    // inaczej (na korzeniu/miednicy albo odsunięty) — przepinamy i zerujemy
    const forearm = hand.parent ?? hand
    const armLen = wp(hand).distanceTo(wp(forearm)) || 1
    if (KEEP_GRIP && bone.parent === hand && wp(bone).distanceTo(wp(hand)) < armLen * 0.25) continue
    if (bone.parent !== hand) hand.add(bone)
    bone.position.set(0, 0, 0)
    bone.quaternion.identity()
  }
  const propOf = (hand: THREE.Object3D) => props.find((p) => p.hand === hand)?.bone
  const filled = new Set(props.filter((p) => hasWeaponMesh(model, p.bone)).map((p) => p.hand))
  for (const b of loose) {
    const left = /(^|[_\s])l(\d|[_\s]|$)|left/i.test(b.name)
    const hand = left ? lHand : rHand
    if (filled.has(hand) && !hasWeaponMesh(model, b)) continue
    const target = propOf(hand) ?? hand
    target.add(b)
    b.position.set(0, 0, 0)
    b.quaternion.identity()
    b.scale.set(1, 1, 1)
  }
  return hasWeaponMesh(model, rHand) || hasWeaponMesh(model, lHand)
}

/** Czy jakaś widoczna siatka broni jest związana z kośćmi pod `node` (albo jest jego dzieckiem)? */
function hasWeaponMesh(model: THREE.Object3D, node: THREE.Object3D) {
  const under = (o: THREE.Object3D) => {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === node) return true
    return false
  }
  let found = false
  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh
    if (found || !m.isMesh || !m.visible) return
    if (m.isSkinnedMesh) {
      if (m.skeleton.bones.some((b) => b !== node && under(b)) && (isWeaponMesh(m) || meshMostlyUnder(m, under))) found = true
    } else if (under(m)) found = true
  })
  return found
}

/** Siatka bez nazwanego materiału broni (np. MMD) — liczy się, jeśli większość jej kości jest pod węzłem. */
function meshMostlyUnder(m: THREE.SkinnedMesh, under: (o: THREE.Object3D) => boolean) {
  const bones = m.skeleton.bones
  return bones.length > 0 && bones.filter(under).length / bones.length > 0.6
}

export function isWeaponMesh(m: THREE.Mesh) {
  const mats = Array.isArray(m.material) ? m.material : [m.material]
  return mats.some((x) => /weapon|wpn|wepon/i.test(x?.name ?? '')) || /weapon|wpn|wepon/i.test(m.name)
}

/** Chowa siatki, których środek jest daleko od osi postaci (resztki pozy wystawowej). */
export function hideFarMeshes(model: THREE.Object3D, root: THREE.Object3D, maxDist: number, maxY = Infinity, keepWeapons = false, axis?: THREE.Vector3) {
  root.updateMatrixWorld(true)
  const inv = root.matrixWorld.clone().invert()
  const box = new THREE.Box3()
  const c = new THREE.Vector3()
  let hidden = 0
  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh
    if (!m.isMesh || !m.visible) return
    if (keepWeapons && isWeaponMesh(m)) return
    if (m.isSkinnedMesh) m.computeBoundingBox()
    else if (!m.geometry.boundingBox) m.geometry.computeBoundingBox()
    const bb = m.isSkinnedMesh ? m.boundingBox : m.geometry.boundingBox
    if (!bb || bb.isEmpty()) return
    box.copy(bb).applyMatrix4(m.matrixWorld).applyMatrix4(inv)
    box.getCenter(c)
    if (Math.hypot(c.x - (axis?.x ?? 0), c.z - (axis?.z ?? 0)) > maxDist || c.y > maxY) {
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
// „ValveBiped.Bip01_L_UpperArm_102” → „bip001 l upperarm” (szkielet Source/SFM)
const normName = (n: string) =>
  n
    .replace(/_\d+$/, '')
    .replace(/^valvebiped\.?bip01/i, 'Bip001')
    .replace(/[\s_]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/^bip001 (neck|head)1$/, 'bip001 $1')
    .replace(/^bip001 spine4$/, 'bip001 spine2')

interface RigBone {
  bone: THREE.Object3D
  restLocal: THREE.Quaternion
  restWorld: THREE.Quaternion
  restWorldInv: THREE.Quaternion
  /** kierunek kości w pozie spoczynkowej (do następnego stawu) w przestrzeni postaci */
  dir: THREE.Vector3
  /** bliźniaki obracane tak samo (MMD: łańcuchy D) */
  extra?: RigBone[]
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
  if (b.extra) for (const e of b.extra) applyRot(e, R)
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
  /** szkielet rozpoznany z kształtu (bez nazw kości) — mniej pewna głowa/rekwizyty */
  inferred: boolean
}

/**
 * Szuka szkieletu Bip001 i, jeśli jest kompletny, zwraca animator.
 * Wywołać PO ustawieniu skali/obrotu modelu i z modelem w korzeniu o tożsamościowej transformacji.
 * Zwraca też `facingFlip` — true, gdy model patrzy w -Z (trzeba go obrócić o 180°).
 */
export function detectFacingFlip(model: THREE.Object3D): boolean {
  const res = resolveBones(model)
  if (res.flip !== undefined) return res.flip
  const found = res.found
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

const REQUIRED: BoneKey[] = ['spine', 'lUpper', 'lFore', 'lHand', 'rUpper', 'rFore', 'rHand', 'lThigh', 'lCalf', 'lFoot', 'rThigh', 'rCalf', 'rFoot']

interface Resolved {
  found: Partial<Record<BoneKey, THREE.Object3D>>
  /** kości-bliźniaki (np. MMD „足D”) — w tej samej pozycji, obracane razem z główną */
  twins: Map<THREE.Object3D, THREE.Object3D[]>
  /** tylko dla szkieletów rozpoznanych z kształtu: czy model patrzy w -Z */
  flip?: boolean
}

/** Najpierw po nazwach (Bip001/ValveBiped), a gdy ich brak — z kształtu szkieletu (MMD z utraconymi nazwami). */
export function resolveBones(model: THREE.Object3D): Resolved {
  const found = findBones(model)
  if (REQUIRED.every((k) => found[k])) return { found, twins: new Map() }
  return inferBones(model) ?? { found, twins: new Map() }
}

/**
 * Rozpoznaje kończyny po geometrii szkieletu:
 *  nogi — łańcuch od stopy (nisko) przez kolano do biodra,
 *  dłonie — kość z ≥3 „palcami” (dziećmi, które mają własne dzieci), z dala od osi,
 *  kręgosłup — droga od wspólnego przodka ramion do wspólnego przodka z nogami.
 */
function inferBones(model: THREE.Object3D): Resolved | null {
  model.updateMatrixWorld(true)
  const bones: THREE.Object3D[] = []
  model.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.push(o)
  })
  if (bones.length < 15) return null
  const isBone = new Set(bones)
  const P = new Map<THREE.Object3D, THREE.Vector3>()
  for (const b of bones) P.set(b, b.getWorldPosition(new THREE.Vector3()))
  let minY = Infinity
  let maxY = -Infinity
  let cx = 0
  let cz = 0
  for (const p of P.values()) {
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y)
    cx += p.x
    cz += p.z
  }
  cx /= bones.length
  cz /= bones.length
  const H = maxY - minY
  if (!(H > 1e-6)) return null
  const yN = (b: THREE.Object3D) => (P.get(b)!.y - minY) / H
  const hor = (b: THREE.Object3D) => Math.hypot(P.get(b)!.x - cx, P.get(b)!.z - cz) / H
  const dist = (a: THREE.Object3D, b: THREE.Object3D) => P.get(a)!.distanceTo(P.get(b)!) / H
  const parentBone = (b: THREE.Object3D) => (b.parent && isBone.has(b.parent) ? b.parent : null)
  const ancestors = (b: THREE.Object3D) => {
    const out: THREE.Object3D[] = []
    for (let p = parentBone(b); p; p = parentBone(p)) out.push(p)
    return out
  }

  // ── nogi ──
  type Leg = { thigh: THREE.Object3D; calf: THREE.Object3D; foot: THREE.Object3D }
  const legs: Leg[] = []
  for (const tip of bones) {
    if (yN(tip) > 0.16) continue
    const up = [tip, ...ancestors(tip)]
    const ci = up.findIndex((a) => yN(a) > yN(tip) + 0.12)
    if (ci < 1) continue
    const calf = up[ci]
    const foot = up[ci - 1]
    const ti = up.findIndex((a, i) => i > ci && yN(a) > yN(calf) + 0.12)
    if (ti < 0) continue
    const thigh = up[ti]
    if (yN(thigh) < 0.35 || yN(thigh) > 0.72 || yN(calf) < 0.12 || yN(calf) > 0.45 || hor(thigh) > 0.2) continue
    if (Math.abs(P.get(calf)!.x - P.get(thigh)!.x) / H > 0.12) continue
    if (!legs.some((l) => l.thigh === thigh && l.calf === calf && l.foot === foot)) legs.push({ thigh, calf, foot })
  }
  if (legs.length < 2) return null

  // kierunek „przodu” — palce stóp wystają do przodu
  let fwd = 0
  for (const l of legs)
    for (const c of l.foot.children) if (isBone.has(c)) fwd += P.get(c)!.z - P.get(l.foot)!.z
  const F = fwd < 0 ? -1 : 1
  // oś ciała = środek między biodrami (średnia wszystkich kości bywa przesunięta przez włosy/uszy/rekwizyty)
  const hx = legs.reduce((a, l) => a + P.get(l.thigh)!.x, 0) / legs.length
  // lewa strona postaci patrzącej w +Z leży po +X
  const sideOf = (b: THREE.Object3D) => Math.sign((P.get(b)!.x - hx) * F)
  const lat = (b: THREE.Object3D) => Math.abs(P.get(b)!.x - hx) / H

  // ── dłonie ──
  const hasKids = (b: THREE.Object3D) => b.children.some((c) => isBone.has(c))
  type Arm = { upper: THREE.Object3D; fore: THREE.Object3D; hand: THREE.Object3D }
  const arms: Arm[] = []
  for (const hand of bones) {
    const fingers = hand.children.filter((c) => isBone.has(c) && hasKids(c))
    if (fingers.length < 3 || yN(hand) < 0.3 || lat(hand) < 0.08) continue
    const up = ancestors(hand)
    const fi = up.findIndex((a) => dist(a, hand) > 0.09)
    if (fi < 0) continue
    const fore = up[fi]
    const ui = up.findIndex((a, i) => i > fi && dist(a, fore) > 0.09)
    if (ui < 0) continue
    const upper = up[ui]
    if (yN(upper) < 0.6 || yN(upper) > 0.92) continue
    // dłoń wisi nie wyżej niż bark i dalej od osi niż ramię, po tej samej stronie
    if (yN(hand) > yN(upper) + 0.03 || lat(hand) < lat(upper) || sideOf(hand) !== sideOf(upper)) continue
    arms.push({ upper, fore, hand })
  }

  const pick = <T extends { [k: string]: THREE.Object3D }>(list: T[], side: number, first: keyof T) => {
    const mine = list.filter((x) => sideOf(x[first]) === side)
    if (!mine.length) return null
    // główny = ten z największą liczbą potomków (zwykle ma na sobie siatkę), reszta w tym samym miejscu = bliźniaki
    const main = mine[0]
    const twins = mine.slice(1).filter((x) => Object.keys(x).every((k) => dist(x[k], main[k]) < 0.02))
    return { main, twins }
  }
  const lLeg = pick(legs, 1, 'thigh')
  const rLeg = pick(legs, -1, 'thigh')
  const lArm = pick(arms, 1, 'upper')
  const rArm = pick(arms, -1, 'upper')
  if (!lLeg || !rLeg || !lArm || !rArm) return null

  // ── kręgosłup i głowa ──
  const ancU = [lArm.main.upper, ...ancestors(lArm.main.upper)]
  const chest = ancestors(rArm.main.upper).find((a) => ancU.includes(a))
  if (!chest) return null
  const hips = ancestors(lLeg.main.thigh)
  const spinePath = [chest, ...ancestors(chest)]
  const stop = spinePath.findIndex((a) => hips.includes(a))
  const spines = (stop > 0 ? spinePath.slice(0, stop) : [chest]).reverse() // od dołu
  const armRoots = new Set([lArm.main.upper, rArm.main.upper, ...ancestors(lArm.main.upper), ...ancestors(rArm.main.upper)])
  const headChain: THREE.Object3D[] = []
  let cur = chest
  for (let i = 0; i < 4; i++) {
    const next = cur.children
      .filter((c) => isBone.has(c) && !armRoots.has(c))
      .filter((c) => hor(c) < 0.06 && yN(c) > yN(cur) - 0.005)
      .sort((a, b) => yN(b) - yN(a))[0]
    if (!next) break
    headChain.push(next)
    cur = next
  }

  const found: Partial<Record<BoneKey, THREE.Object3D>> = {
    spine: spines[0],
    spine1: spines[1],
    spine2: spines[2],
    neck: headChain.length > 1 ? headChain[0] : undefined,
    head: headChain.length > 1 ? headChain[1] : headChain[0],
    lUpper: lArm.main.upper,
    lFore: lArm.main.fore,
    lHand: lArm.main.hand,
    rUpper: rArm.main.upper,
    rFore: rArm.main.fore,
    rHand: rArm.main.hand,
    lThigh: lLeg.main.thigh,
    lCalf: lLeg.main.calf,
    lFoot: lLeg.main.foot,
    rThigh: rLeg.main.thigh,
    rCalf: rLeg.main.calf,
    rFoot: rLeg.main.foot,
  }
  const twins = new Map<THREE.Object3D, THREE.Object3D[]>()
  const addTwins = (main: Record<string, THREE.Object3D>, list: Record<string, THREE.Object3D>[]) => {
    for (const k of Object.keys(main)) {
      const t = list.map((x) => x[k]).filter((b) => b !== main[k])
      if (t.length) twins.set(main[k], t)
    }
  }
  addTwins(lLeg.main, lLeg.twins)
  addTwins(rLeg.main, rLeg.twins)
  addTwins(lArm.main, lArm.twins)
  addTwins(rArm.main, rArm.twins)
  return { found, twins, flip: F < 0 }
}

export function createBoneAnimator(model: THREE.Object3D, reference: THREE.Object3D): BoneAnimator | null {
  const { found, twins, flip } = resolveBones(model)
  if (REQUIRED.some((k) => !found[k])) return null
  const inferred = flip !== undefined

  reference.updateMatrixWorld(true)
  const refInv = reference.getWorldQuaternion(new THREE.Quaternion()).invert()
  const refMatInv = reference.matrixWorld.clone().invert()
  const posOf = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3()).applyMatrix4(refMatInv)

  const mk = (key: BoneKey, child?: BoneKey): RigBone | null => {
    const bone = found[key]
    if (!bone) return null
    const rb = mkBone(bone, child)
    const t = twins.get(bone)
    if (t) rb.extra = t.map((x) => ({ ...mkBone(x, child), dir: rb.dir }))
    return rb
  }
  const mkBone = (bone: THREE.Object3D, child?: BoneKey): RigBone => {
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
    inferred,
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
      if (s.action === 'light' && s.ranged) {
        // celowanie: ręka z bronią wyprostowana na wysokości barku, odrzut przy strzale
        rate = 30
        const recoil = Math.max(0, 1 - k / 0.35) * (k > 0.2 ? 1 : 0)
        const aim = (p: 'l' | 'r', fire: boolean) => {
          T[p + 'Pitch'] = 1.5 + (fire ? 0.35 * recoil : 0)
          T[p + 'Elbow'] = 0.05 + (fire ? 0.25 * recoil : 0)
          T[p + 'Yaw'] = p === 'r' ? 0.12 : -0.12
        }
        if (s.ranged.dual) {
          aim('r', s.ranged.side < 0)
          aim('l', s.ranged.side > 0)
        } else {
          aim('r', true)
          // druga ręka podtrzymuje broń
          T.lPitch = 1.2
          T.lElbow = 0.9
          T.lYaw = -0.5
        }
        T.lean = 0.06 - 0.06 * recoil
        T.lThigh = 0.15
        T.rThigh = -0.15
        T.lKnee = T.rKnee = 0.15
      } else if (s.action === 'light') {
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
