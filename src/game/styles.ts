// Styl walki zależny od broni agenta: animacje ataku, zasięg ciosów i superumiejętność.
import type { RangedWeapon } from './weapons'

export type WeaponStyle = 'blade' | 'dual' | 'heavy' | 'polearm' | 'fist' | 'gun' | 'bow' | 'cannon' | 'flame'

const STYLE_OF: Record<string, WeaponStyle> = {}
const put = (s: WeaponStyle, names: string[]) => names.forEach((n) => (STYLE_OF[n] = s))
put('blade', ['Hoshimi Miyabi', 'Soldier 11', 'Anby Demara', 'Soldier 0 - Anby', 'Seth Lowell', 'Sunbringer', 'Komano Manato', 'Yidhari Murphy', 'Lucia Elowen', 'Sunna', 'Alice Thymefield'])
put('dual', ['Jane Doe', 'Nekomiya Mana', 'Pulchra Fellini', 'Seed', 'Dialyn', 'Ju Fufu', 'Evelyn Chevalier', 'Luciana de Montefio', 'Ukinami Yuzuha'])
put('heavy', ['Ellen Joe', 'Koleda Belobog', 'Ben Bigger', 'Corin Wickes', 'Caesar King', 'Anton Ivanov', 'Piper Wheel', 'Hugo Vlad', 'Roxy Ifrita Pryce'])
put('polearm', ['Tsukishiro Yanagi', 'Qingyi', 'Astra Yao', 'Cissia', "Sigrid de L'Azur", 'Velina Airgid', 'Vivian Banshee', 'Remielle Dan', 'Ye Shunguang', 'Nangong Yu', 'Zhao', 'Promeia', 'Aria', 'Claret Flint', 'Norma Hollowell'])
put('fist', ['Pan Yinhu', 'Yixuan', 'Lighter', 'Von Lycaon', 'Banyue', 'Alexandrina Sebastiane'])

export function styleFor(name: string, ranged: RangedWeapon | null): WeaponStyle {
  if (ranged) return ranged.kind === 'bullet' ? 'gun' : ranged.kind === 'arrow' ? 'bow' : ranged.kind === 'shell' ? 'cannon' : 'flame'
  return STYLE_OF[name] ?? 'blade'
}

export interface StyleSpec {
  /** czas trwania kolejnych ciosów kombo */
  dur: [number, number, number]
  dmg: [number, number, number]
  range: number
  /** minimalny cos kąta trafienia (1 = wąsko na wprost, -1 = dookoła) */
  arc: [number, number, number]
  /** skok do przodu przy ciosie [m] */
  lunge: [number, number, number]
  superName: string
  superDur: number
  superCd: number
}

export const STYLE: Record<WeaponStyle, StyleSpec> = {
  blade: { dur: [0.28, 0.28, 0.42], dmg: [11, 12, 24], range: 2.4, arc: [0.35, 0.35, 0.1], lunge: [0.6, 0.6, 1.4], superName: 'Iai — błysk ostrza', superDur: 0.9, superCd: 7 },
  dual: { dur: [0.2, 0.2, 0.36], dmg: [7, 7, 18], range: 2.1, arc: [0.3, 0.3, -0.3], lunge: [0.8, 0.8, 0.5], superName: 'Wir ostrzy', superDur: 1.3, superCd: 7 },
  heavy: { dur: [0.42, 0.42, 0.6], dmg: [17, 19, 38], range: 2.8, arc: [0.2, 0.2, -1], lunge: [0.3, 0.3, 0.2], superName: 'Trzęsienie ziemi', superDur: 1.1, superCd: 8 },
  polearm: { dur: [0.32, 0.3, 0.44], dmg: [11, 10, 22], range: 3.4, arc: [0.75, 0.0, 0.6], lunge: [0.9, 0.2, 1.6], superName: 'Taniec włóczni', superDur: 1.2, superCd: 7 },
  fist: { dur: [0.18, 0.18, 0.4], dmg: [7, 8, 22], range: 1.8, arc: [0.45, 0.45, 0.3], lunge: [0.5, 0.5, 1.0], superName: 'Grad ciosów', superDur: 1.2, superCd: 6 },
  gun: { dur: [0.3, 0.3, 0.42], dmg: [0, 0, 0], range: 15, arc: [1, 1, 1], lunge: [0, 0, 0], superName: 'Ołowiany deszcz', superDur: 1.0, superCd: 7 },
  bow: { dur: [0.3, 0.3, 0.42], dmg: [0, 0, 0], range: 18, arc: [1, 1, 1], lunge: [0, 0, 0], superName: 'Deszcz strzał', superDur: 1.0, superCd: 8 },
  cannon: { dur: [0.3, 0.3, 0.42], dmg: [0, 0, 0], range: 13, arc: [1, 1, 1], lunge: [0, 0, 0], superName: 'Ostrzał orbitalny', superDur: 1.1, superCd: 8 },
  flame: { dur: [0.3, 0.3, 0.42], dmg: [0, 0, 0], range: 5, arc: [1, 1, 1], lunge: [0, 0, 0], superName: 'Pierścień piekła', superDur: 1.0, superCd: 7 },
}

/** Indywidualny „charakter” ruchów postaci (z nazwy): tempo, strona, zamaszystość. */
export interface Flavor {
  tempo: number // 0.85..1.15
  mirror: number // 1 albo -1 — z której strony zaczyna cięcie
  flair: number // 0..1 — wysokość/zamaszystość ruchów, piruety
  stance: number // 0..1 — jak nisko stoi
}

export function flavorFor(name: string): Flavor {
  let h = 2166136261
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619)
  const r = (k: number) => ((h >>> k) & 255) / 255
  return { tempo: 0.85 + r(0) * 0.3, mirror: r(8) < 0.5 ? 1 : -1, flair: r(16), stance: r(24) }
}
