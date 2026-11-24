// Broń dystansowa agentów — zwykły atak strzela pociskami zamiast ciąć.
//  bullet — szybkie pociski (pistolety, karabiny); `dual` = strzały na zmianę z obu rąk
//  arrow  — strzała: wolniejsza, przebija kilku wrogów
//  shell  — pocisk energetyczny: wolny, wybucha obszarowo
//  flame  — miotacz: krótki stożek płomieni

export type ProjectileKind = 'bullet' | 'arrow' | 'shell' | 'flame'

export interface RangedWeapon {
  kind: ProjectileKind
  /** strzały na zmianę z prawej i lewej ręki */
  dual?: boolean
  /** pocisków na jedno naciśnięcie (w kombo) */
  burst?: number
}

const RANGED: Record<string, RangedWeapon> = {
  'Billy Kid': { kind: 'bullet', dual: true, burst: 2 },
  'Starlight - Billy Kid': { kind: 'bullet', dual: true, burst: 2 },
  'Zhu Yuan': { kind: 'bullet', burst: 3 },
  Trigger: { kind: 'bullet' },
  'Orphie Magnusson & Magus': { kind: 'bullet', burst: 2 },
  'Grace Howard': { kind: 'bullet', burst: 2 },
  'Nicole Demara': { kind: 'shell' },
  'Asaba Harumasa': { kind: 'arrow' },
  'Burnice White': { kind: 'flame', dual: true },
}

export function rangedWeaponFor(name: string): RangedWeapon | null {
  return RANGED[name] ?? null
}

export interface ProjectileSpec {
  speed: number
  range: number
  radius: number
  dmg: number
  pierce: number
  /** promień wybuchu (0 = brak) */
  splash: number
  life: number
}

export const PROJECTILE: Record<ProjectileKind, ProjectileSpec> = {
  bullet: { speed: 34, range: 15, radius: 0.35, dmg: 7, pierce: 1, splash: 0, life: 0.6 },
  arrow: { speed: 26, range: 18, radius: 0.4, dmg: 14, pierce: 3, splash: 0, life: 0.8 },
  shell: { speed: 15, range: 13, radius: 0.5, dmg: 16, pierce: 1, splash: 2.4, life: 1 },
  flame: { speed: 12, range: 5, radius: 0.7, dmg: 4, pierce: 4, splash: 0, life: 0.4 },
}
