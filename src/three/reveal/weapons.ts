import type { Item, Role } from '../../data/roster'

/**
 * Styl wejścia postaci w animacji losowania — zależy od broni.
 *  katana  — jedno cięcie przez ekran, postać pojawia się w błysku
 *  blade   — wkręca się w górę z wiru cięć
 *  dual    — doskok z boku ze smugami, cięcie w X
 *  heavy   — spada z nieba, uderzenie w ziemię, odłamki
 *  gun     — smugi pocisków, łuski, hologram
 *  fists   — seria ciosów, fale uderzeniowe na kamerę
 *  polearm — spiralny wir broni drzewcowej
 *  bow     — deszcz strzał światła
 *  magic   — wyłania się z kręgu run pod podłogą
 *  support — reflektory, iskierki, scena koncertowa
 *  shield  — heksagonalna bariera, która pęka
 */
export type RevealStyle = 'katana' | 'blade' | 'dual' | 'heavy' | 'gun' | 'fists' | 'polearm' | 'bow' | 'magic' | 'support' | 'shield'

/** Broń znanych agentów. Reszta dostaje styl po roli (ROLE_STYLE) — dopisz tu, jeśli coś nie pasuje. */
const WEAPON_STYLE: Record<string, RevealStyle> = {
  // katany / miecze z jednym cięciem
  'Hoshimi Miyabi': 'katana',
  'Ye Shunguang': 'katana',
  Kafka: 'katana',
  'Alice Thymefield': 'katana',
  // ostrza
  'Anby Demara': 'blade',
  'Soldier 0 - Anby': 'blade',
  'Soldier 11': 'blade',
  // podwójne ostrza / szpony / noże
  'Jane Doe': 'dual',
  'Nekomiya Mana': 'dual',
  'Pulchra Fellini': 'dual',
  Promeia: 'dual',
  // ciężka broń
  'Ellen Joe': 'heavy',
  'Corin Wickes': 'heavy',
  'Koleda Belobog': 'heavy',
  'Ben Bigger': 'heavy',
  'Piper Wheel': 'heavy',
  'Luciana de Montefio': 'heavy',
  'Ju Fufu': 'heavy',
  'Pan Yinhu': 'heavy',
  // broń palna / miotacze
  'Billy Kid': 'gun',
  'Starlight - Billy Kid': 'gun',
  'Zhu Yuan': 'gun',
  'Nicole Demara': 'gun',
  'Grace Howard': 'gun',
  'Burnice White': 'gun',
  Trigger: 'gun',
  'Orphie Magnusson & Magus': 'gun',
  // pięści / rękawice / kopnięcia
  'Von Lycaon': 'fists',
  Lighter: 'fists',
  Qingyi: 'fists',
  'Anton Ivanov': 'fists',
  // drzewcowa / kosa
  'Tsukishiro Yanagi': 'polearm',
  Soukaku: 'polearm',
  'Hugo Vlad': 'polearm',
  // łuk
  'Asaba Harumasa': 'bow',
  // magia / sznurki / tusz
  'Alexandrina Sebastiane': 'magic',
  'Evelyn Chevalier': 'magic',
  'Vivian Banshee': 'magic',
  Yixuan: 'magic',
  Aria: 'magic',
  // wsparcie / scena
  'Astra Yao': 'support',
  'Ukinami Yuzuha': 'support',
  'Lucia Elowen': 'support',
  Robin: 'support',
  // tarcze
  'Seth Lowell': 'shield',
  'Caesar King': 'shield',
}

const ROLE_STYLE: Record<Role, RevealStyle> = {
  Attack: 'blade',
  Stun: 'heavy',
  Anomaly: 'magic',
  Support: 'support',
  Defense: 'shield',
  Rupture: 'dual',
  Armorer: 'gun',
}

export function revealStyleFor(item: Item): RevealStyle {
  return WEAPON_STYLE[item.name] ?? (item.role ? ROLE_STYLE[item.role] : 'blade')
}

/** Deterministyczny seed z nazwy — każda postać ma własny wariant kamery/kierunku. */
export function nameSeed(name: string) {
  let h = 2166136261
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619)
  return h >>> 0
}

export function mulberry32(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
