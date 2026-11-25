// Pozy ataków i superumiejętności dla animatora kości — osobne dla każdego stylu broni,
// z indywidualnym „charakterem” postaci (Flavor: tempo, strona, zamaszystość, niska postawa).
//
// Kanały pozy (radiany): xPitch = ramię do przodu/góry, xYaw = zamach poziomy, xOut = odwiedzenie w bok,
// xElbow = zgięcie łokcia, xThigh = udo do przodu, xKnee = zgięcie kolana, lean = pochylenie tułowia,
// twist = skręt tułowia, side = przechył, headPitch/headYaw.
import type { Flavor, WeaponStyle } from './styles'

export interface PoseInput {
  action: 'light' | 'heavy'
  style: WeaponStyle
  flavor: Flavor
  combo: number
  k: number // 0..1
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const ease = (x: number) => {
  const t = clamp01(x)
  return t * t * (3 - 2 * t)
}
/** 0→1 na [a,b] */
const seg = (k: number, a: number, b: number) => ease((k - a) / (b - a))

type T = Record<string, number>

/** Ustawia cele pozy dla ataku. Zwraca szybkość dążenia do pozy. */
export function attackPose(T: T, p: PoseInput): number {
  const { k, combo, flavor: f } = p
  const m = f.mirror
  const low = 0.15 + f.stance * 0.35 // jak nisko w kolanach
  const set = (o: T) => Object.assign(T, o)

  if (p.action === 'heavy') return superPose(T, p, low)

  switch (p.style) {
    case 'blade': {
      const wind = seg(k, 0, 0.28)
      const hit = seg(k, 0.28, 0.55)
      const back = seg(k, 0.72, 1)
      const r = 1 - back
      if (combo === 0) {
        // poziome cięcie od boku
        const from = -1.3 * m
        const to = 1.0 * m
        set({ rPitch: 1.45 * wind * r, rYaw: (from * wind + (to - from) * hit) * r, rElbow: (0.15 + 0.4 * (1 - hit)) * r, twist: (from * wind + (to - from) * hit) * 0.45 * r, lPitch: 0.5 * r, lElbow: 1.2, lean: 0.18 * r, lThigh: 0.4 * r, rThigh: -0.3 * r, lKnee: low * r, rKnee: low * 0.7 * r })
      } else if (combo === 1) {
        // cięcie wznoszące po skosie
        set({ rPitch: (0.2 + 2.3 * hit) * r, rYaw: (-0.9 * m * wind + 1.5 * m * hit) * r, rElbow: 0.5 - 0.4 * hit, twist: (-0.5 * m * wind + 0.9 * m * hit) * r, lean: (0.3 * wind - 0.2 * hit) * r, lPitch: 0.3, lElbow: 1.0, lOut: 0.4 * hit * r, rThigh: 0.35 * r, lThigh: -0.2 * r, lKnee: low * 1.4 * wind * r })
      } else {
        // finisz iai: dobycie z biodra, niski wypad, szerokie cięcie
        const draw = seg(k, 0, 0.35)
        const cut = seg(k, 0.35, 0.5)
        set({ rPitch: (0.6 * draw + 0.9 * cut) * r, rYaw: (1.3 * m * draw - 2.8 * m * cut) * r, rElbow: 0.9 * draw * (1 - cut), lPitch: 0.7 * draw * r, lYaw: 0.8 * m * draw * r, lElbow: 1.4, twist: (0.7 * m * draw - 1.4 * m * cut) * r, lean: (0.35 + 0.2 * cut) * r, lThigh: 0.9 * r, rThigh: -0.6 * r, lKnee: (0.5 + low) * r, rKnee: 0.5 * r, headYaw: -0.3 * m * draw * r })
      }
      return 40 * f.tempo
    }
    case 'dual': {
      const wind = seg(k, 0, 0.25)
      const hit = seg(k, 0.25, 0.5)
      const r = 1 - seg(k, 0.7, 1)
      if (combo < 2) {
        // pchnięcie jedną ręką, druga odciągnięta — na zmianę
        const a = (combo === 0 ? 1 : -1) * m > 0 ? 'r' : 'l'
        const b = a === 'r' ? 'l' : 'r'
        const s = a === 'r' ? 1 : -1
        set({ [a + 'Pitch']: (0.6 * wind + 1.0 * hit) * r, [a + 'Elbow']: 1.7 * wind * (1 - hit) + 0.05, [a + 'Yaw']: 0.25 * s * hit * r, [b + 'Pitch']: (-0.4 + 0.2 * hit) * r, [b + 'Elbow']: 1.3, twist: (-0.5 * s * wind + 0.9 * s * hit) * r, lean: 0.3 * r, lThigh: 0.5 * hit * r * s, rThigh: -0.5 * hit * r * s, lKnee: low, rKnee: low })
      } else {
        // krzyżowe cięcie „X”: obie ręce w górę i na zewnątrz, potem przez siebie
        set({ lPitch: (2.2 * wind - 1.4 * hit) * r, rPitch: (2.2 * wind - 1.4 * hit) * r, lYaw: (-0.8 * wind + 1.6 * hit) * r, rYaw: (0.8 * wind - 1.6 * hit) * r, lElbow: 0.3, rElbow: 0.3, lean: (-0.2 * wind + 0.6 * hit) * r, lKnee: (low + 0.4 * hit) * r, rKnee: (low + 0.4 * hit) * r, lThigh: 0.3 * hit * r, headPitch: -0.2 * wind * r })
      }
      return 46 * f.tempo
    }
    case 'heavy': {
      const wind = seg(k, 0, 0.38)
      const hit = seg(k, 0.38, 0.6)
      const r = 1 - seg(k, 0.75, 1)
      if (combo === 0) {
        // ukośny zamach oburącz znad prawego barku
        set({ rPitch: (2.3 * wind - 2.0 * hit) * r, lPitch: (2.1 * wind - 1.8 * hit) * r, rYaw: (-0.6 * m * wind + 1.4 * m * hit) * r, lYaw: (-0.3 * m * wind + 1.2 * m * hit) * r, rElbow: 0.6 - 0.4 * hit, lElbow: 0.8 - 0.4 * hit, twist: (-0.8 * m * wind + 1.5 * m * hit) * r, lean: (-0.2 * wind + 0.6 * hit) * r, lThigh: 0.5 * r, rThigh: -0.3 * r, lKnee: (low + 0.3 * hit) * r, rKnee: low * r })
      } else if (combo === 1) {
        // niski zamach poziomy z powrotem
        set({ rPitch: 0.9 * r, lPitch: 0.9 * r, rYaw: (1.4 * m * wind - 2.6 * m * hit) * r, lYaw: (1.2 * m * wind - 2.4 * m * hit) * r, rElbow: 0.3, lElbow: 0.6, twist: (1.0 * m * wind - 1.9 * m * hit) * r, lean: 0.45 * r, lKnee: (0.4 + low) * r, rKnee: (0.4 + low) * r, side: 0.15 * m * hit * r })
      } else {
        // skok i miażdżący cios znad głowy
        set({ rPitch: (3.0 * wind - 2.7 * hit) * r, lPitch: (3.0 * wind - 2.7 * hit) * r, rYaw: 0.3 * r, lYaw: -0.3 * r, rElbow: 0.5 * (1 - hit), lElbow: 0.5 * (1 - hit), lean: (-0.35 * wind + 0.85 * hit) * r, lKnee: (0.3 * wind + 0.9 * hit) * r, rKnee: (0.3 * wind + 0.9 * hit) * r, lThigh: (0.5 * wind + 0.4 * hit) * r, rThigh: (-0.2 + 0.6 * hit) * r, headPitch: -0.3 * wind * r })
      }
      return 28 * f.tempo
    }
    case 'polearm': {
      const wind = seg(k, 0, 0.3)
      const hit = seg(k, 0.3, 0.52)
      const r = 1 - seg(k, 0.72, 1)
      if (combo === 0) {
        // pchnięcie: obie ręce prowadzą drzewce, wypad
        set({ rPitch: 1.3 * r, lPitch: 1.15 * r, rElbow: 1.5 * wind * (1 - hit) + 0.1, lElbow: 0.9 * wind * (1 - hit) + 0.3, lYaw: -0.5 * r, rYaw: 0.1 * r, twist: (0.6 * m * wind - 0.4 * m * hit) * r, lean: (0.1 + 0.35 * hit) * r, lThigh: 0.9 * hit * r, rThigh: -0.6 * hit * r, lKnee: (low + 0.5 * hit) * r, rKnee: 0.3 * r })
      } else if (combo === 1) {
        // szerokie zamiatanie dookoła — tułów i ręce rozłożone
        set({ rPitch: 0.8 * r, lPitch: 0.6 * r, rOut: 0.6 * r, lOut: 0.3 * r, rYaw: (-1.4 * m * wind + 2.8 * m * hit) * r, lYaw: (-1.0 * m * wind + 2.2 * m * hit) * r, twist: (-1.0 * m * wind + 2.0 * m * hit) * r, lean: 0.25 * r, lKnee: (low + 0.3) * r, rKnee: (low + 0.3) * r, side: -0.2 * m * hit * r })
      } else {
        // wybicie: drzewce nad głową, potem dźgnięcie w dół z długim wypadem
        set({ rPitch: (2.7 * wind - 1.5 * hit) * r, lPitch: (2.5 * wind - 1.4 * hit) * r, rElbow: 0.6 * wind * (1 - hit) + 0.1, lElbow: 0.9 * wind * (1 - hit) + 0.2, lYaw: -0.3 * r, lean: (-0.3 * wind + 0.75 * hit) * r, lThigh: (0.3 * wind + 0.9 * hit) * r, rThigh: -0.8 * hit * r, lKnee: (0.2 + 0.6 * hit) * r, rKnee: 0.2 * r, headPitch: -0.25 * wind * r })
      }
      return 34 * f.tempo
    }
    case 'fist': {
      const wind = seg(k, 0, 0.2)
      const hit = seg(k, 0.2, 0.42)
      const r = 1 - seg(k, 0.65, 1)
      // gardę trzymamy cały czas
      set({ lPitch: 1.1, rPitch: 1.1, lElbow: 1.9, rElbow: 1.9, lYaw: -0.4, rYaw: 0.4, lKnee: low + 0.15, rKnee: low + 0.15, lThigh: 0.25, rThigh: -0.15, lean: 0.15 })
      if (combo === 0) {
        // prosty prawą
        set({ rPitch: 1.1 + 0.45 * hit * r, rElbow: 1.9 * (1 - hit * r) + 0.05, rYaw: 0.4 - 0.4 * hit * r, twist: (-0.25 * wind + 0.55 * hit) * m * r, lean: 0.15 + 0.15 * hit * r })
      } else if (combo === 1) {
        // sierpowy lewą
        set({ lPitch: 1.1 + 0.4 * hit * r, lElbow: 1.9 - 0.9 * hit * r, lYaw: (-0.4 - 0.6 * wind + 1.6 * hit) * r, lOut: 0.5 * wind * (1 - hit), twist: (0.3 * wind - 0.7 * hit) * m * r })
      } else {
        // podbródkowy: przysiad i wybicie w górę
        set({ rPitch: (0.3 + 2.6 * hit) * r + 1.1 * (1 - r), rElbow: (1.5 - 0.9 * hit) * r + 1.9 * (1 - r), rYaw: 0.2, lKnee: (0.9 * wind * (1 - hit) + low) * r, rKnee: (0.9 * wind * (1 - hit) + low) * r, lean: (0.45 * wind - 0.35 * hit) * r, twist: (-0.5 * wind + 0.6 * hit) * m * r, headPitch: -0.3 * hit * r })
      }
      return 50 * f.tempo
    }
    default:
      return 30
  }
}

function superPose(T: T, p: PoseInput, low: number): number {
  const { k, flavor: f } = p
  const m = f.mirror
  const set = (o: T) => Object.assign(T, o)
  const out = 1 - seg(k, 0.85, 1)
  switch (p.style) {
    case 'blade': {
      // przyczajenie z ręką na rękojeści → błyskawiczny przelot → zastygnięcie po cięciu
      const crouch = seg(k, 0, 0.3)
      const dash = seg(k, 0.3, 0.42)
      set({ rPitch: (0.5 * crouch + 0.6 * dash) * out, rYaw: (1.1 * m * crouch - 2.6 * m * dash) * out, rElbow: 1.2 * crouch * (1 - dash) + 0.1, lPitch: 0.6 * crouch * out, lYaw: 0.8 * m * crouch * out, lElbow: 1.3, twist: (0.6 * m * crouch - 1.1 * m * dash) * out, lean: (0.5 * crouch + 0.2 * dash) * out, lThigh: (0.7 + 0.4 * dash) * out, rThigh: -0.7 * out, lKnee: (0.9 + low) * crouch * out, rKnee: 0.6 * out, headYaw: -0.4 * m * crouch * out })
      return 40
    }
    case 'dual': {
      // wir: ręce szeroko, ostrza tną dookoła (obrót całego ciała robi awatar)
      const w = Math.sin(k * Math.PI * 10)
      set({ lOut: 0.95 * out, rOut: 0.95 * out, lPitch: (0.4 + 0.3 * w) * out, rPitch: (0.4 - 0.3 * w) * out, lElbow: 0.15, rElbow: 0.15, lean: 0.2 * out, lKnee: (low + 0.2) * out, rKnee: (low + 0.2) * out, side: 0.15 * w * out, headPitch: 0.1 })
      return 40
    }
    case 'heavy': {
      // przysiad z bronią nad głową → skok (awatar podnosi) → uderzenie w ziemię
      const load = seg(k, 0, 0.3)
      const smash = seg(k, 0.55, 0.65)
      set({ rPitch: (3.0 * load - 2.8 * smash) * out, lPitch: (3.0 * load - 2.8 * smash) * out, rElbow: 0.4 * (1 - smash), lElbow: 0.4 * (1 - smash), lean: (-0.3 * load + 0.95 * smash) * out, lKnee: (0.9 * load * (1 - seg(k, 0.3, 0.4)) + 1.0 * smash) * out, rKnee: (0.9 * load * (1 - seg(k, 0.3, 0.4)) + 1.0 * smash) * out, lThigh: (0.6 * load + 0.6 * smash) * out, rThigh: (0.6 * load - 0.2 * smash) * out, headPitch: -0.3 * load * (1 - smash) })
      return 30
    }
    case 'polearm': {
      // wirowanie drzewcem nad głową, na koniec pchnięcie
      const thrust = seg(k, 0.7, 0.8)
      const w = k * Math.PI * 8
      set({ rPitch: (2.4 - 1.1 * thrust) * out, lPitch: (1.6 - 0.4 * thrust) * out, rYaw: Math.sin(w) * 0.6 * (1 - thrust) * out, lYaw: Math.cos(w) * 0.6 * (1 - thrust) * out - 0.4 * thrust, rElbow: 0.3 + 0.9 * (1 - thrust) * 0.3, lElbow: 0.6, lean: (0.1 + 0.6 * thrust) * out, lThigh: 0.9 * thrust * out, rThigh: -0.6 * thrust * out, lKnee: (low + 0.5 * thrust) * out, rKnee: low * out })
      return 32
    }
    case 'fist': {
      // seria ciosów na zmianę, a na koniec potężny podbródkowy
      const finish = seg(k, 0.72, 0.85)
      const phase = Math.sin(k * Math.PI * 16)
      const a = Math.max(0, phase)
      const b = Math.max(0, -phase)
      set({ rPitch: ((1.1 + 0.45 * a) * (1 - finish) + 2.9 * finish) * out, lPitch: (1.1 + 0.45 * b) * (1 - finish) * out, rElbow: (1.9 - 1.8 * a) * (1 - finish) + 0.5 * finish, lElbow: 1.9 - 1.8 * b, rYaw: 0.3 * (1 - a), lYaw: -0.3 * (1 - b), twist: (0.35 * (a - b)) * m * (1 - finish) * out, lean: (0.3 * (1 - finish) - 0.3 * finish) * out, lKnee: (low + 0.3 + 0.4 * (1 - finish)) * out, rKnee: (low + 0.3 + 0.4 * (1 - finish)) * out, lThigh: 0.35, rThigh: -0.2, headPitch: -0.25 * finish })
      return 55
    }
    case 'gun': {
      // obie ręce wyprostowane, omiatanie ogniem z prawej na lewą
      const sweep = Math.sin(k * Math.PI * 2) * 1.1
      set({ rPitch: 1.5 * out, lPitch: 1.5 * out, rElbow: 0.05, lElbow: 0.05, rYaw: (0.15 + 0.1 * sweep) * out, lYaw: (-0.15 + 0.1 * sweep) * out, twist: sweep * out, lean: 0.05, lKnee: low + 0.15, rKnee: low + 0.15, lThigh: 0.3, rThigh: -0.3 })
      return 30
    }
    case 'bow': {
      // napięcie łuku ku niebu
      const draw = seg(k, 0, 0.35)
      set({ lPitch: (1.5 + 1.0 * draw) * out, lElbow: 0.05, rPitch: (1.5 + 0.9 * draw) * out, rElbow: 1.8 * draw * (1 - seg(k, 0.4, 0.45)), rYaw: -0.25, lean: -0.35 * draw * out, headPitch: -0.5 * draw * out, lThigh: 0.35, rThigh: -0.35, lKnee: 0.2, rKnee: 0.3 })
      return 30
    }
    case 'cannon': {
      // zaparcie się nisko, broń przed sobą, odrzut przy każdej salwie
      const recoil = Math.max(0, Math.sin(k * Math.PI * 10))
      set({ rPitch: (1.3 + 0.3 * recoil) * out, lPitch: (1.2 + 0.3 * recoil) * out, rElbow: 0.4 + 0.3 * recoil, lElbow: 0.9, lYaw: -0.4, lean: (0.3 - 0.25 * recoil) * out, lKnee: (0.6 + low) * out, rKnee: (0.6 + low) * out, lThigh: 0.6 * out, rThigh: -0.4 * out })
      return 40
    }
    case 'flame': {
      // ramiona szeroko — pierścień ognia wokół
      const open = seg(k, 0, 0.25)
      set({ lOut: 1.0 * open * out, rOut: 1.0 * open * out, lPitch: 0.4 * open * out, rPitch: 0.4 * open * out, lElbow: 0.2, rElbow: 0.2, lean: -0.15 * open * out, headPitch: -0.3 * open * out, lKnee: low, rKnee: low })
      return 30
    }
  }
}
