import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { ELEMENT_COLORS, RANK_COLOR, type Item } from '../data/roster'
import type { Avatar } from '../game/avatar'
import { createChoreo, FINAL, type RevealCtx } from './reveal/styles'
import { mulberry32, nameSeed, revealStyleFor } from './reveal/weapons'

interface Props {
  item: Item
  avatar: Avatar
  /** wywoływane w kulminacji wejścia — wtedy pokazujemy tekst */
  onPeak?: () => void
}

/**
 * Pełnoekranowa scena 3D wejścia postaci po wylosowaniu.
 * Choreografia zależy od broni (reveal/weapons.ts), kolory od żywiołu,
 * a kierunek kamery od seeda z nazwy — każda postać wchodzi inaczej.
 */
export function HeroReveal({ item, avatar, onPeak }: Props) {
  const mount = useRef<HTMLDivElement>(null)
  const flashEl = useRef<HTMLDivElement>(null)
  const peakRef = useRef(onPeak)
  peakRef.current = onPeak

  useEffect(() => {
    const el = mount.current!
    const [c1, c2] = item.element ? ELEMENT_COLORS[item.element] : [RANK_COLOR[item.rank], '#ffffff']
    const color = new THREE.Color(c1)
    const color2 = new THREE.Color(c2)
    const rankColor = new THREE.Color(RANK_COLOR[item.rank])
    const rankS = item.rank === 'S'
    const rng = mulberry32(nameSeed(item.name))
    const side: 1 | -1 = rng() < 0.5 ? 1 : -1

    // ── renderer + bloom ───────────────────────────────────
    // antialias na canvasie nic nie daje przy composerze — MSAA robimy w jego render targecie
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
    const pixelRatio = Math.min(window.devicePixelRatio, 1.5)
    renderer.setPixelRatio(pixelRatio)
    renderer.setSize(el.clientWidth, el.clientHeight)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.localClippingEnabled = true
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x05040a)
    scene.fog = new THREE.Fog(0x05040a, 9, 30)
    const camera = new THREE.PerspectiveCamera(40, el.clientWidth / el.clientHeight, 0.05, 120)

    const composer = new EffectComposer(
      renderer,
      new THREE.WebGLRenderTarget(el.clientWidth * pixelRatio, el.clientHeight * pixelRatio, { type: THREE.HalfFloatType, samples: 4 }),
    )
    composer.addPass(new RenderPass(scene, camera))
    const bloom = new UnrealBloomPass(new THREE.Vector2(el.clientWidth, el.clientHeight), rankS ? 0.95 : 0.7, 0.55, 0.82)
    composer.addPass(bloom)
    // klatki uderzeń (czarno-białe), aberracja chromatyczna, linie prędkości, winieta
    const fxPass = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uAberr: { value: 0 }, uImpact: { value: 0 }, uSpeed: { value: 0 }, uTime: { value: 0 }, uTint: { value: color } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform float uAberr; uniform float uImpact; uniform float uSpeed; uniform float uTime; uniform vec3 uTint; varying vec2 vUv;
        void main(){
          vec2 d = vUv - .5;
          float a = (.004 + uAberr * .03) * length(d);
          vec3 col = vec3(texture2D(tDiffuse, vUv + d*a*4.).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - d*a*4.).b);
          // linie prędkości
          float ang = atan(d.y, d.x);
          float n = fract(sin(floor(ang * 90.) * 43758.5453 + floor(uTime * 24.)) * 12.9898);
          float line = step(.82, n) * smoothstep(.18, .55, length(d)) * uSpeed;
          col += mix(vec3(1.), uTint, .4) * line * .7;
          // klatka uderzenia: twardy czarno-biały negatyw
          float lum = dot(col, vec3(.299,.587,.114));
          vec3 imp = mix(vec3(1.), vec3(0.), step(.3, lum));
          imp = mix(imp, uTint * 1.5, step(.3, lum) * step(lum, .55) * .6);
          col = mix(col, imp, uImpact);
          col *= 1. - dot(d,d) * .9;
          gl_FragColor = vec4(col, 1.);
        }`,
    })
    composer.addPass(fxPass)
    composer.addPass(new OutputPass())

    // ── światło ────────────────────────────────────────────
    scene.add(new THREE.HemisphereLight(0xcfc6ff, 0x140c1c, 1.1))
    const key = new THREE.DirectionalLight(0xffffff, 2.0)
    key.position.set(2, 4, 5)
    scene.add(key)
    const boom = new THREE.PointLight(color, 0, 14)
    boom.position.set(0, 1, 0)
    scene.add(boom)
    const rimL = new THREE.PointLight(color, 30, 9)
    rimL.position.set(-2.2, 2.2, -1.8)
    const rimR = new THREE.PointLight(color2, 22, 9)
    rimR.position.set(2.2, 1.6, -1.8)
    scene.add(rimL, rimR)

    // ── podłoga: heksy + poświata ──────────────────────────
    const floorMat = new THREE.ShaderMaterial({
      uniforms: { uC: { value: color }, uR: { value: rankColor }, uT: { value: 0 }, uPulse: { value: 0 } },
      vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `
        uniform vec3 uC; uniform vec3 uR; uniform float uT; uniform float uPulse; varying vec2 vP;
        float hex(vec2 p){ p = abs(p); return max(dot(p, normalize(vec2(1.,1.732))), p.x); }
        void main(){
          vec2 p = vP * 1.6;
          vec2 r = vec2(1., 1.732); vec2 h = r*.5;
          vec2 a = mod(p, r) - h; vec2 b = mod(p - h, r) - h;
          vec2 g = dot(a,a) < dot(b,b) ? a : b;
          float edge = smoothstep(.47, .5, hex(g));
          float d = length(vP);
          float glow = exp(-d*d*.35);
          float wave = smoothstep(.4, 0., abs(d - uT*3.)) * exp(-uT*.6);
          vec3 col = vec3(.03,.025,.05) + uC*edge*(.08 + glow*.5 + wave*.8) + uC*glow*.18 + uR*uPulse*glow*.4;
          col *= 1. - smoothstep(4., 14., d);
          gl_FragColor = vec4(col, 1.);
        }`,
    })
    const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 96), floorMat)
    floor.rotation.x = -Math.PI / 2
    scene.add(floor)
    // kontaktowy cień pod stopami
    const blobTex = radialTexture('rgba(0,0,0,0.85)', 'rgba(0,0,0,0)')
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }))
    blob.rotation.x = -Math.PI / 2
    blob.position.y = 0.01
    scene.add(blob)

    // ── tło: promienie wokół postaci ───────────────────────
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uC: { value: color }, uR: { value: rankColor }, uT: { value: 0 }, uS: { value: rankS ? 1 : 0.55 } },
      vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `
        uniform vec3 uC; uniform vec3 uR; uniform float uT; uniform float uS; varying vec3 vD;
        void main(){
          float ang = atan(vD.x, vD.z);
          float rays = pow(abs(sin(ang*9. + uT*.25)), 14.) + .6*pow(abs(sin(ang*5. - uT*.18 + 1.)), 22.);
          float band = exp(-pow((vD.y - .12)*3.2, 2.));
          vec3 col = mix(vec3(.02,.015,.04), uC*.22, band) + (uC*.7 + uR*.5)*rays*band*.35*uS;
          gl_FragColor = vec4(col, 1.);
        }`,
    })
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(40, 48, 24), skyMat))

    // ── unoszące się iskry w tle ───────────────────────────
    const EN = rankS ? 260 : 140
    const emb = new Float32Array(EN * 3)
    const embSpd = new Float32Array(EN)
    for (let i = 0; i < EN; i++) {
      const a = rng() * Math.PI * 2
      const r = 1.5 + rng() * 7
      emb.set([Math.cos(a) * r, rng() * 6, Math.sin(a) * r], i * 3)
      embSpd[i] = 0.2 + rng() * 0.8
    }
    const embGeo = new THREE.BufferGeometry()
    embGeo.setAttribute('position', new THREE.BufferAttribute(emb, 3))
    const embers = new THREE.Points(embGeo, new THREE.PointsMaterial({ color: color2, size: 0.04, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }))
    scene.add(embers)

    // ── postać + przekrój (clipping) ───────────────────────
    // holder (pozycja) → spin (obrót wokół środka ciała) → offset → postać
    const holder = new THREE.Group()
    const spin = new THREE.Group()
    spin.position.y = 0.9
    const offset = new THREE.Group()
    offset.position.y = -0.9
    scene.add(holder)
    holder.add(spin)
    spin.add(offset)
    offset.add(avatar.root)
    const clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 10)
    avatar.root.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        mat.clippingPlanes = [clip]
        mat.needsUpdate = true
      }
    })
    // świecący pierścień na linii przekroju
    const scanMat = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    const scan = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.62, 64), scanMat)
    scan.rotation.x = -Math.PI / 2
    scene.add(scan)
    let revealH = 10
    let revealMode: 'up' | 'down' = 'up'

    // ── efekty / stan ──────────────────────────────────────
    const fxList: { obj: THREE.Object3D; life: number; max: number; update?: (k: number, dt: number) => void }[] = []
    let shake = 0
    let flash = 0
    let impactT = 0
    let aberr = 0
    let speedT = 0
    let slowT = 0
    let slowScale = 1
    const action = { kind: 'none' as 'none' | 'light' | 'heavy', t: 0, dur: 1, combo: 0 }

    const ctx: RevealCtx = {
      scene,
      camera,
      holder,
      spin,
      color,
      color2,
      rankS,
      side,
      rng,
      cam: { pos: new THREE.Vector3(0, 1.2, 4), look: new THREE.Vector3(0, 1, 0), fov: 40 },
      reveal(h, mode = 'up') {
        revealH = h
        revealMode = mode
      },
      fx(obj, life, update) {
        scene.add(obj)
        fxList.push({ obj, life, max: life, update })
      },
      shake(a) {
        shake = Math.max(shake, a)
      },
      flash(a, c) {
        flash = Math.max(flash, a)
        if (flashEl.current) flashEl.current.style.background = `radial-gradient(circle at 60% 50%, #fff 0%, ${new THREE.Color(c ?? color2).getStyle()} 40%, transparent 80%)`
      },
      act(kind, dur, combo = 0) {
        action.kind = kind
        action.t = 0
        action.dur = dur
        action.combo = combo
      },
      slowmo(dur, scale) {
        slowT = dur
        slowScale = scale
      },
      impact(strength = 1) {
        impactT = 0.07 * strength
        aberr = Math.max(aberr, strength)
      },
      speedlines(dur) {
        speedT = Math.max(speedT, dur)
      },
      light(pos, c, intensity) {
        boom.position.copy(pos)
        boom.color.copy(c)
        boom.intensity = Math.max(boom.intensity, intensity)
      },
    }

    const choreo = createChoreo(revealStyleFor(item), ctx)
    let peaked = false

    // kadrowanie: na szerokim ekranie postać po prawej (tekst po lewej), na pionowym wyżej (tekst pod spodem)
    const frame = new THREE.Vector3()
    let pullBack = 1 // na pionowym ekranie kamera odsuwa się, żeby cała postać weszła w wąski kadr
    const updateFrame = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      const portrait = h > w * 1.1
      frame.set(portrait ? 0 : -1.05, portrait ? -0.35 : 0, 0)
      pullBack = portrait ? 1.3 : 1
    }
    updateFrame()

    const clock = new THREE.Clock()
    let raf = 0
    let time = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const realDt = Math.min(clock.getDelta(), 1 / 12)
      // slow-mo: czas sceny zwalnia, efekty ekranowe lecą w czasie rzeczywistym
      let dt = realDt
      if (slowT > 0) {
        slowT -= realDt
        dt *= slowScale
      }
      time += dt

      // choreografia, potem spokojna pętla idle
      if (time <= choreo.duration) choreo.update(time, dt)
      else {
        const F = FINAL(side)
        const a = F.a + Math.sin((time - choreo.duration) * 0.35) * 0.18
        ctx.cam.pos.set(Math.sin(a) * F.r, F.h + Math.sin(time * 0.5) * 0.05, Math.cos(a) * F.r)
        ctx.cam.look.set(0, F.ly, 0)
        ctx.cam.fov = F.fov
        revealH = 10
      }
      if (!peaked && time >= choreo.peak) {
        peaked = true
        floorMat.uniforms.uPulse.value = 1
        peakRef.current?.()
      }

      // przekrój
      clip.normal.set(0, revealMode === 'up' ? -1 : 1, 0)
      clip.constant = revealMode === 'up' ? revealH : -revealH
      const scanOn = revealH > 0.02 && revealH < 1.93
      scan.visible = scanOn
      scan.position.y = revealH
      scanMat.opacity = scanOn ? 0.9 : 0
      scan.scale.setScalar(1 + Math.sin(time * 30) * 0.04)

      // postać
      if (action.kind !== 'none') {
        action.t += dt
        if (action.t >= action.dur) action.kind = 'none'
      }
      avatar.update(dt, { speed: 0, action: action.kind, actionT: Math.min(1, action.t / action.dur), combo: action.combo })
      blob.position.x = holder.position.x
      blob.visible = holder.position.y < 3
      ;(blob.material as THREE.MeshBasicMaterial).opacity = 1 - Math.min(1, Math.max(0, holder.position.y) / 3)

      // efekty
      for (let i = fxList.length - 1; i >= 0; i--) {
        const f = fxList[i]
        f.life -= dt
        f.update?.(Math.min(1, 1 - f.life / f.max), dt)
        if (f.life <= 0) {
          scene.remove(f.obj)
          disposeTree(f.obj)
          fxList.splice(i, 1)
        }
      }

      // iskry w tle
      const at = embGeo.getAttribute('position') as THREE.BufferAttribute
      for (let i = 0; i < EN; i++) {
        let y = at.getY(i) + embSpd[i] * dt
        if (y > 6) y = 0
        at.setY(i, y)
      }
      at.needsUpdate = true

      // efekty ekranowe
      impactT = Math.max(0, impactT - realDt)
      aberr = Math.max(0, aberr - realDt * 2.5)
      speedT = Math.max(0, speedT - realDt)
      fxPass.uniforms.uImpact.value = impactT > 0 ? 1 : 0
      fxPass.uniforms.uAberr.value = aberr + (slowT > 0 ? 0.35 : 0)
      fxPass.uniforms.uSpeed.value = Math.min(1, speedT * 3)
      fxPass.uniforms.uTime.value = time
      boom.intensity *= Math.max(0, 1 - realDt * 5)

      floorMat.uniforms.uT.value = Math.max(0, time - choreo.peak)
      floorMat.uniforms.uPulse.value *= 1 - dt * 1.5
      skyMat.uniforms.uT.value = time
      rimL.intensity = 30 + Math.sin(time * 2) * 6
      bloom.strength = (rankS ? 0.95 : 0.7) + flash * 0.8

      // kamera: pozycja z choreografii + kadrowanie + shake
      // przesunięcie kadru wzdłuż osi „w prawo” kamery, żeby działało z każdego kąta orbity
      const fwd = ctx.cam.look.clone().sub(ctx.cam.pos).setY(0).normalize()
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x)
      // przy zbliżeniach przesunięcie maleje, żeby postać nie uciekła z kadru
      const near = Math.min(1, ctx.cam.pos.distanceTo(ctx.cam.look) / 3.9) ** 2
      const off = right.multiplyScalar(frame.x * near).setY(frame.y * near)
      camera.position.copy(ctx.cam.pos).sub(ctx.cam.look).multiplyScalar(pullBack).add(ctx.cam.look).add(off)
      const look = ctx.cam.look.clone().add(off)
      if (shake > 0) {
        shake = Math.max(0, shake - realDt * 2.2)
        const s = shake * shake * 0.25
        camera.position.x += (Math.random() - 0.5) * s
        camera.position.y += (Math.random() - 0.5) * s
        look.x += (Math.random() - 0.5) * s * 0.5
      }
      camera.lookAt(look)
      if (Math.abs(camera.fov - ctx.cam.fov) > 0.01) {
        camera.fov = ctx.cam.fov
        camera.updateProjectionMatrix()
      }

      if (flashEl.current) flashEl.current.style.opacity = String(Math.min(1, flash))
      flash = Math.max(0, flash - realDt * 3.2)

      composer.render()
    }

    // Rozgrzewka shaderów: każdy typ efektu kompiluje program przy pierwszym użyciu, co w trakcie
    // choreografii dawało przycięcia. Kompilujemy wszystko z góry, dopiero potem startuje zegar.
    const warm = warmupObjects(color)
    scene.add(warm)
    let cancelled = false
    const compiled = renderer.compileAsync ? renderer.compileAsync(scene, camera) : Promise.resolve(renderer.compile(scene, camera))
    void compiled
      .catch(() => undefined)
      .then(() => {
        scene.remove(warm)
        disposeTree(warm)
        if (cancelled) return
        clock.getDelta() // nie licz czasu kompilacji jako klatki
        tick()
      })

    const onResize = () => {
      renderer.setSize(el.clientWidth, el.clientHeight)
      composer.setSize(el.clientWidth, el.clientHeight)
      camera.aspect = el.clientWidth / el.clientHeight
      camera.updateProjectionMatrix()
      updateFrame()
    }
    onResize()
    window.addEventListener('resize', onResize)

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      // postać należy do preloadera — tylko ją odpinamy i zdejmujemy przekrój
      offset.remove(avatar.root)
      avatar.root.traverse((o) => {
        const m = o as THREE.Mesh
        if (!m.isMesh) return
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.clippingPlanes = null
      })
      avatar.root.position.set(0, 0, 0)
      avatar.root.rotation.set(0, 0, 0)
      disposeTree(scene)
      blobTex.dispose()
      composer.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
    }
  }, [item, avatar])

  return (
    <div className="hero-layer" ref={mount}>
      <div className="hero-flash" ref={flashEl} />
    </div>
  )
}

/** Po jednym obiekcie z każdego wariantu materiału używanego przez efekty (reveal/styles.ts). */
function warmupObjects(color: THREE.Color) {
  const g = new THREE.Group()
  const addMat = () => new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  const box = new THREE.BoxGeometry(0.1, 0.1, 0.1)
  g.add(new THREE.Mesh(box, addMat()))
  g.add(new THREE.InstancedMesh(box, addMat(), 1))
  g.add(new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0x1b1726, emissive: color, transparent: true }), 1))
  const pts = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3))
  g.add(new THREE.Points(pts, new THREE.PointsMaterial({ color, size: 0.05, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })))
  const line = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0.1, 0)])
  g.add(new THREE.Line(line, new THREE.LineBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending })))
  g.add(new THREE.LineSegments(line, new THREE.LineBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending })))
  g.position.set(0, 1, 0)
  return g
}

function radialTexture(inner: string, outer: string) {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grd.addColorStop(0, inner)
  grd.addColorStop(1, outer)
  g.fillStyle = grd
  g.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}

function disposeTree(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh
    m.geometry?.dispose()
    const mat = m.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
    else mat?.dispose()
  })
}
