import { useEffect, useRef } from 'react'
import * as THREE from 'three'

const TIER_COLORS = [new THREE.Color('#3fa9ff'), new THREE.Color('#c56bff'), new THREE.Color('#ffb800')]

function glowTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.15, 'rgba(255,255,255,0.8)')
  grd.addColorStop(0.4, 'rgba(255,255,255,0.15)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 256, 256)
  return new THREE.CanvasTexture(c)
}

interface Props {
  tier: number // 0 B, 1 A, 2 S
  duration: number // seconds until onDone
  onDone: () => void
}

/** Hyperspace tunnel: streaks rush towards the camera, then the core blooms in the rarity colour. */
export function WarpScene({ tier, duration, onDone }: Props) {
  const mount = useRef<HTMLDivElement>(null)
  const doneRef = useRef(onDone)
  doneRef.current = onDone

  useEffect(() => {
    const el = mount.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(el.clientWidth, el.clientHeight)
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.fog = new THREE.FogExp2(0x05040a, 0.0025)
    const camera = new THREE.PerspectiveCamera(75, el.clientWidth / el.clientHeight, 0.1, 2000)
    camera.position.z = 0

    // streaks
    const N = 2200
    const pos = new Float32Array(N * 6)
    const col = new Float32Array(N * 6)
    const data = Array.from({ length: N }, () => {
      const a = Math.random() * Math.PI * 2
      const r = 6 + Math.random() * 60
      return { x: Math.cos(a) * r, y: Math.sin(a) * r, z: -Math.random() * 1200, hue: Math.random() }
    })
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending })
    const lines = new THREE.LineSegments(geo, mat)
    scene.add(lines)

    // rotating hexagon rings
    const rings: THREE.Mesh[] = []
    for (let i = 0; i < 14; i++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(18, 18.6, 6),
        new THREE.MeshBasicMaterial({ color: 0x7cffd4, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
      )
      ring.position.z = -i * 80
      scene.add(ring)
      rings.push(ring)
    }

    // core glow
    const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
    core.position.z = -300
    core.scale.setScalar(20)
    scene.add(core)

    const target = TIER_COLORS[tier]
    const base = new THREE.Color('#9fe8ff')
    const tmp = new THREE.Color()
    const clock = new THREE.Clock()
    let raf = 0
    let finished = false

    const onResize = () => {
      camera.aspect = el.clientWidth / el.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(el.clientWidth, el.clientHeight)
    }
    window.addEventListener('resize', onResize)

    const loop = () => {
      const dt = Math.min(clock.getDelta(), 0.05)
      const t = clock.elapsedTime
      const p = Math.min(t / duration, 1)
      const speed = 60 + Math.pow(p, 2.2) * 1400
      const colorMix = THREE.MathUtils.smoothstep(p, 0.55, 0.85)
      const stretch = 2 + Math.pow(p, 2) * 90

      for (let i = 0; i < N; i++) {
        const d = data[i]
        d.z += speed * dt
        if (d.z > 5) d.z = -1200
        const j = i * 6
        pos[j] = d.x
        pos[j + 1] = d.y
        pos[j + 2] = d.z
        pos[j + 3] = d.x
        pos[j + 4] = d.y
        pos[j + 5] = d.z - stretch
        tmp.copy(base).offsetHSL(d.hue * 0.15 - 0.07, 0, 0).lerp(target, colorMix)
        const fade = THREE.MathUtils.clamp((d.z + 1200) / 900, 0, 1)
        col[j] = tmp.r * fade
        col[j + 1] = tmp.g * fade
        col[j + 2] = tmp.b * fade
        col[j + 3] = 0
        col[j + 4] = 0
        col[j + 5] = 0
      }
      geo.attributes.position.needsUpdate = true
      geo.attributes.color.needsUpdate = true

      rings.forEach((r, i) => {
        r.position.z += speed * dt * 0.6
        if (r.position.z > 5) r.position.z -= 14 * 80
        r.rotation.z += dt * (0.4 + i * 0.03) * (i % 2 ? 1 : -1)
        const m = r.material as THREE.MeshBasicMaterial
        m.color.copy(new THREE.Color(0x7cffd4)).lerp(target, colorMix)
        m.opacity = 0.15 + colorMix * 0.4
      })

      const bloom = THREE.MathUtils.smoothstep(p, 0.7, 1)
      core.scale.setScalar(20 + bloom * (tier === 2 ? 900 : 600) + Math.sin(t * 20) * 2)
      core.material.color.copy(base).lerp(target, colorMix)

      camera.rotation.z += dt * (0.2 + p * 1.6)
      const shake = tier === 2 ? Math.pow(p, 4) * 0.8 : Math.pow(p, 4) * 0.3
      camera.position.x = (Math.random() - 0.5) * shake
      camera.position.y = (Math.random() - 0.5) * shake
      camera.fov = 75 + Math.pow(p, 3) * 40
      camera.updateProjectionMatrix()

      renderer.render(scene, camera)
      if (p >= 1 && !finished) {
        finished = true
        doneRef.current()
      }
      raf = requestAnimationFrame(loop)
    }
    loop()

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      renderer.dispose()
      geo.dispose()
      mat.dispose()
      el.removeChild(renderer.domElement)
    }
  }, [tier, duration])

  return <div ref={mount} className="three-layer" />
}
