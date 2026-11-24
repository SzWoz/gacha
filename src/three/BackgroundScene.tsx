import { useEffect, useRef } from 'react'
import * as THREE from 'three'

/** Ambient lobby background: neon grid floor + drifting dust, tinted by banner accent. */
export function BackgroundScene({ accent }: { accent: string }) {
  const mount = useRef<HTMLDivElement>(null)
  const accentRef = useRef(new THREE.Color(accent))

  useEffect(() => {
    accentRef.current.set(accent)
  }, [accent])

  useEffect(() => {
    const el = mount.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(el.clientWidth, el.clientHeight)
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.fog = new THREE.Fog(0x07060d, 20, 140)
    const camera = new THREE.PerspectiveCamera(60, el.clientWidth / el.clientHeight, 0.1, 400)
    camera.position.set(0, 6, 30)

    // grid floor via shader
    const gridMat = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(accent) } },
      vertexShader: `varying vec2 vUv; varying float vDepth; void main(){ vUv = uv; vec4 mv = modelViewMatrix*vec4(position,1.); vDepth = -mv.z; gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `
        uniform float uTime; uniform vec3 uColor; varying vec2 vUv; varying float vDepth;
        void main(){
          vec2 g = vUv*vec2(60.,60.); g.y += uTime*1.5;
          vec2 a = abs(fract(g-0.5)-0.5)/fwidth(g);
          float line = 1.0 - min(min(a.x,a.y),1.0);
          float fade = smoothstep(140.,10.,vDepth);
          float pulse = 0.5+0.5*sin(vUv.y*40.-uTime*3.);
          gl_FragColor = vec4(uColor*(0.6+pulse*0.6), line*fade*0.55);
        }`,
    })
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), gridMat)
    grid.rotation.x = -Math.PI / 2
    grid.position.y = -4
    scene.add(grid)

    // dust
    const N = 900
    const p = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) {
      p[i * 3] = (Math.random() - 0.5) * 160
      p[i * 3 + 1] = Math.random() * 60 - 4
      p[i * 3 + 2] = (Math.random() - 0.5) * 160
    }
    const dustGeo = new THREE.BufferGeometry()
    dustGeo.setAttribute('position', new THREE.BufferAttribute(p, 3))
    const dustMat = new THREE.PointsMaterial({ size: 0.25, color: 0xffffff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false })
    const dust = new THREE.Points(dustGeo, dustMat)
    scene.add(dust)

    // floating wireframe shapes
    const shapes: THREE.Mesh[] = []
    const geos = [new THREE.IcosahedronGeometry(2.4, 0), new THREE.OctahedronGeometry(2, 0), new THREE.TorusKnotGeometry(1.4, 0.35, 64, 8)]
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(geos[i % 3], new THREE.MeshBasicMaterial({ color: accent, wireframe: true, transparent: true, opacity: 0.18 }))
      m.position.set((Math.random() - 0.5) * 70, Math.random() * 20 + 2, -Math.random() * 60 - 10)
      shapes.push(m)
      scene.add(m)
    }

    let mx = 0
    let my = 0
    const onMove = (e: PointerEvent) => {
      mx = (e.clientX / window.innerWidth - 0.5) * 2
      my = (e.clientY / window.innerHeight - 0.5) * 2
    }
    const onResize = () => {
      camera.aspect = el.clientWidth / el.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(el.clientWidth, el.clientHeight)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('resize', onResize)

    const clock = new THREE.Clock()
    const cur = new THREE.Color(accent)
    let raf = 0
    const loop = () => {
      const t = clock.getElapsedTime()
      cur.lerp(accentRef.current, 0.04)
      gridMat.uniforms.uTime.value = t
      gridMat.uniforms.uColor.value.copy(cur)
      dust.rotation.y = t * 0.02
      dust.position.y = Math.sin(t * 0.3) * 0.5
      shapes.forEach((s, i) => {
        s.rotation.x = t * 0.2 + i
        s.rotation.y = t * 0.3 + i
        s.position.y += Math.sin(t + i) * 0.005
        ;(s.material as THREE.MeshBasicMaterial).color.copy(cur)
      })
      camera.position.x += (mx * 4 - camera.position.x) * 0.03
      camera.position.y += (6 - my * 2 - camera.position.y) * 0.03
      camera.lookAt(0, 4, 0)
      renderer.render(scene, camera)
      raf = requestAnimationFrame(loop)
    }
    loop()

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('resize', onResize)
      renderer.dispose()
      el.removeChild(renderer.domElement)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={mount} className="three-layer bg-layer" />
}
