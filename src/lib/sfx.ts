// Tiny WebAudio synth – no asset files needed.
let ctx: AudioContext | null = null
let muted = localStorage.getItem('signal-gacha:muted') === '1'

export const isMuted = () => muted
export const setMuted = (m: boolean) => {
  muted = m
  localStorage.setItem('signal-gacha:muted', m ? '1' : '0')
}

function ac() {
  if (!ctx) ctx = new AudioContext()
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.15, delay = 0, slideTo?: number) {
  if (muted) return
  const a = ac()
  const t0 = a.currentTime + delay
  const o = a.createOscillator()
  const g = a.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, t0)
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur)
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  o.connect(g).connect(a.destination)
  o.start(t0)
  o.stop(t0 + dur + 0.05)
}

function noise(dur: number, gain = 0.2, delay = 0, freqFrom = 400, freqTo = 4000) {
  if (muted) return
  const a = ac()
  const t0 = a.currentTime + delay
  const buf = a.createBuffer(1, a.sampleRate * dur, a.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  const src = a.createBufferSource()
  src.buffer = buf
  const f = a.createBiquadFilter()
  f.type = 'bandpass'
  f.Q.value = 1.2
  f.frequency.setValueAtTime(freqFrom, t0)
  f.frequency.exponentialRampToValueAtTime(freqTo, t0 + dur)
  const g = a.createGain()
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(gain, t0 + dur * 0.8)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  src.connect(f).connect(g).connect(a.destination)
  src.start(t0)
}

export const sfx = {
  click: () => tone(880, 0.06, 'square', 0.05),
  hover: () => tone(1400, 0.03, 'sine', 0.025),
  warp: () => {
    noise(2.4, 0.18, 0, 200, 6000)
    tone(80, 2.4, 'sawtooth', 0.05, 0, 400)
  },
  burst: (tier: number) => {
    noise(0.6, 0.3, 0, 3000, 300)
    tone(55, 0.8, 'sine', 0.4)
    const base = [392, 523.25, 659.25][tier]
    ;[0, 0.08, 0.16, 0.24].forEach((d, i) => tone(base * [1, 1.25, 1.5, 2][i], 0.9, 'triangle', 0.08, d))
  },
  reveal: (tier: number) => {
    if (tier === 2) {
      ;[523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(f, 1.2, 'triangle', 0.09, i * 0.07))
      tone(65, 1.2, 'sine', 0.35)
    } else if (tier === 1) {
      ;[440, 554.37, 659.25].forEach((f, i) => tone(f, 0.6, 'triangle', 0.07, i * 0.06))
    } else tone(660, 0.15, 'triangle', 0.06)
  },
  flip: () => tone(1200, 0.05, 'square', 0.03, 0, 600),
}
