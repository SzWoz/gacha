import * as THREE from 'three'
import { CELL, CITY_HALF, GH, GW, MAP, canvasTex, cx, cz, ci, cj, mergeGeos, wall } from './grid'
import type { DecorCtx, Decor } from './world'

// ─────────────────────────────────────────────────────────────
//  Biom miejski: post-apo ruiny za dnia albo neonowa noc.
//  Zrujnowane, zarośnięte budynki, wraki aut, ogień, kable.
// ─────────────────────────────────────────────────────────────

function facadeTex(rng: () => number, base: string) {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = base
    g.fillRect(0, 0, 256, 256)
    // szum betonu
    for (let i = 0; i < 1800; i++) {
      g.fillStyle = `rgba(${rng() < 0.5 ? '0,0,0' : '255,255,255'},${rng() * 0.06})`
      g.fillRect(rng() * 256, rng() * 256, 2 + rng() * 5, 2 + rng() * 5)
    }
    // okna (1 piętro = 128px wysokości tekstury → 3 m)
    for (let y = 0; y < 2; y++)
      for (let x = 0; x < 3; x++) {
        const wx = x * 85 + 16
        const wy = y * 128 + 30
        const r = rng()
        g.fillStyle = r < 0.15 ? '#3a3d42' : '#0d0f12' // zabite deską albo czarna dziura
        g.fillRect(wx, wy, 52, 62)
        if (r > 0.15 && rng() < 0.5) {
          // resztki szyby
          g.fillStyle = 'rgba(160,190,200,0.35)'
          g.beginPath()
          g.moveTo(wx, wy)
          g.lineTo(wx + 20 + rng() * 30, wy)
          g.lineTo(wx, wy + 20 + rng() * 30)
          g.fill()
        }
        if (r < 0.15) {
          g.fillStyle = '#5a4a36'
          for (let k = 0; k < 3; k++) g.fillRect(wx - 4, wy + 8 + k * 20, 60, 8)
        }
        g.strokeStyle = 'rgba(0,0,0,0.5)'
        g.lineWidth = 4
        g.strokeRect(wx - 2, wy - 2, 56, 66)
      }
    // gzymsy pięter
    g.fillStyle = 'rgba(0,0,0,0.18)'
    g.fillRect(0, 124, 256, 6)
    g.fillRect(0, 252, 256, 4)
    // zacieki
    for (let i = 0; i < 9; i++) {
      const x = rng() * 256
      const grd = g.createLinearGradient(0, 0, 0, 256)
      grd.addColorStop(0, 'rgba(40,30,20,0.35)')
      grd.addColorStop(1, 'rgba(40,30,20,0)')
      g.fillStyle = grd
      g.fillRect(x, 0, 3 + rng() * 8, 80 + rng() * 170)
    }
    // pęknięcia
    g.strokeStyle = 'rgba(20,20,20,0.5)'
    g.lineWidth = 1.5
    for (let i = 0; i < 5; i++) {
      let x = rng() * 256
      let y = rng() * 256
      g.beginPath()
      g.moveTo(x, y)
      for (let k = 0; k < 6; k++) {
        x += (rng() - 0.5) * 30
        y += rng() * 25
        g.lineTo(x, y)
      }
      g.stroke()
    }
  })
}

/** Liście bluszczu z przezroczystością. */
function ivyTex(rng: () => number) {
  return canvasTex(
    128,
    256,
    (g) => {
      g.clearRect(0, 0, 128, 256)
      for (let i = 0; i < 520; i++) {
        const y = rng() ** 0.7 * 256
        const spread = 20 + (y / 256) * 50
        const x = 64 + (rng() - 0.5) * 2 * spread
        const s = 4 + rng() * 7
        const l = 22 + rng() * 22
        g.fillStyle = `hsl(${85 + rng() * 40}, ${40 + rng() * 25}%, ${l}%)`
        g.beginPath()
        g.ellipse(x, y, s, s * 0.6, rng() * Math.PI, 0, Math.PI * 2)
        g.fill()
      }
    },
    false,
  )
}

export function grassBladeTex() {
  return canvasTex(
    64,
    128,
    (g) => {
      g.clearRect(0, 0, 64, 128)
      for (let i = 0; i < 14; i++) {
        const x = 8 + Math.random() * 48
        const h = 60 + Math.random() * 66
        const lean = (Math.random() - 0.5) * 24
        const grd = g.createLinearGradient(0, 128, 0, 128 - h)
        grd.addColorStop(0, '#3d5a22')
        grd.addColorStop(1, `hsl(${70 + Math.random() * 30}, 50%, ${45 + Math.random() * 15}%)`)
        g.fillStyle = grd
        g.beginPath()
        g.moveTo(x - 3, 128)
        g.quadraticCurveTo(x + lean * 0.5, 128 - h * 0.6, x + lean, 128 - h)
        g.quadraticCurveTo(x + lean * 0.5 + 2, 128 - h * 0.6, x + 3, 128)
        g.fill()
      }
    },
    false,
  )
}

function neonTex(text: string, glow = '#ff3ea5', fill = '#ff7ac4') {
  return canvasTex(
    512,
    128,
    (g) => {
      g.fillStyle = 'rgba(20,18,24,0.9)'
      g.fillRect(0, 0, 512, 128)
      g.font = 'bold 76px Impact, sans-serif'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.shadowColor = glow
      g.shadowBlur = 20
      g.fillStyle = fill
      g.fillText(text, 256, 68)
    },
    false,
  )
}

/** Wstrzykuje kołysanie na wietrze do materiału (wierzchołki wyżej ruszają się mocniej). */
export function addWind(mat: THREE.Material, uTime: { value: number }, strength: number, heightScale: number) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec4 wp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          wp = modelMatrix * wp;
          float h = clamp(position.y * ${heightScale.toFixed(3)}, 0.0, 1.0);
          float gust = 0.6 + 0.4 * sin(uTime * 0.7 + wp.x * 0.05);
          float w = sin(uTime * 2.2 + wp.x * 0.35 + wp.z * 0.27) * 0.6 + sin(uTime * 3.7 + wp.z * 0.5) * 0.4;
          transformed.x += w * h * h * ${strength.toFixed(3)} * gust;
          transformed.z += cos(uTime * 1.9 + wp.x * 0.3) * h * h * ${(strength * 0.5).toFixed(3)} * gust;
        }`,
      )
  }
  mat.customProgramCacheKey = () => `wind-${strength}-${heightScale}`
}

// ── budowa ──────────────────────────────────────────────────

export function decorateCity(ctx: DecorCtx, variant: 'day' | 'night'): Decor {
  const { group, T, rng, uTime, walk, boxes, floorY, decks } = ctx
  const night = variant === 'night'
  // ── niebo z chmurami + słońce ────────────────────────────
  const skyMat = T(
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uTime, uNight: { value: night ? 1 : 0 } },
      vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `
        uniform float uTime; uniform float uNight; varying vec3 vD;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
          return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*n(p); p*=2.1; a*=.5; } return s; }
        void main(){
          float y = clamp(vD.y, -0.1, 1.);
          vec3 top = vec3(.36,.58,.86), hor = vec3(.84,.86,.8);
          vec3 col = mix(hor, top, pow(max(y,0.), .55));
          vec3 sunDir = normalize(vec3(.45,.55,-.7));
          float sd = max(dot(vD, sunDir), 0.);
          col += vec3(1.,.9,.7) * (pow(sd, 900.)*4. + pow(sd, 12.)*.25);
          if (y > 0.) {
            vec2 uv = vD.xz / (y + .15) * 1.4 + vec2(uTime*.012, uTime*.004);
            float c = smoothstep(.48, .78, fbm(uv));
            col = mix(col, vec3(1.) * (.85 + .15*fbm(uv*2.+3.)), c * .85 * smoothstep(0., .25, y));
          }
          if (uNight > .5) {
            // noc: fiolet przy horyzoncie (łuna neonów), gwiazdy, księżyc, ciemne chmury
            vec3 nc = mix(vec3(.32,.08,.36), vec3(.015,.012,.05), pow(max(y,0.), .45));
            vec3 sd3 = vD * 260.;
            float st = step(.9965, h(floor(sd3.xz) + floor(sd3.y))) * smoothstep(.05, .4, y);
            nc += vec3(st) * (.6 + .4 * sin(uTime * 3. + sd3.x));
            vec3 md = normalize(vec3(-.5,.42,.6));
            float m = max(dot(vD, md), 0.);
            nc += vec3(.9,.92,1.) * smoothstep(.9985, .9992, m) + vec3(.25,.25,.4) * pow(m, 60.);
            if (y > 0.) {
              vec2 uv = vD.xz / (y + .15) * 1.4 + vec2(uTime*.01, uTime*.003);
              nc = mix(nc, vec3(.06,.04,.1), smoothstep(.5, .8, fbm(uv)) * .8 * smoothstep(0., .25, y));
            }
            col = nc;
          }
          gl_FragColor = vec4(col, 1.);
        }`,
    }),
  )
  const sky = new THREE.Mesh(T(new THREE.SphereGeometry(180, 32, 16)), skyMat)
  group.add(sky)

  // ── ziemia: popękany asfalt + trawa + ziemia ─────────────
  const groundMat = T(
    new THREE.ShaderMaterial({
      uniforms: { uCell: { value: CELL }, uNight: { value: night ? 1 : 0 } },
      vertexShader: `varying vec2 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xz; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `
        uniform float uCell; uniform float uNight; varying vec2 vW;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
          return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*n(p); p*=2.03; a*=.5; } return s; }
        vec2 vor(vec2 p){ vec2 i=floor(p), f=fract(p); float d1=8., d2=8.;
          for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ vec2 g=vec2(x,y); vec2 o=vec2(h(i+g), h(i+g+17.)); float d=length(g+o-f);
            if(d<d1){ d2=d1; d1=d; } else if(d<d2) d2=d; }
          return vec2(d1, d2); }
        void main(){
          float tone = fbm(vW*.35);
          vec3 asph = mix(vec3(.42,.41,.4), vec3(.52,.5,.47), tone);
          vec2 v = vor(vW*.45);
          float crack = 1. - smoothstep(0., .06, v.y - v.x);
          float grass = smoothstep(.5, .68, fbm(vW*.18 + 4.)) + crack * .6;
          vec3 g1 = mix(vec3(.36,.5,.2), vec3(.52,.62,.28), fbm(vW*1.3));
          vec3 col = mix(asph, vec3(.12,.12,.12), crack*.8);
          col = mix(col, g1, clamp(grass, 0., 1.) * .85);
          float dirt = smoothstep(.62, .8, fbm(vW*.11 + 9.));
          col = mix(col, vec3(.38,.31,.22), dirt*.6);
          // resztki pasów
          float lane = step(abs(fract(vW.x/uCell)-.5), .012) * step(.5, fract(vW.y/3.)) * (1.-grass) * step(.45, n(vW*.2));
          col = mix(col, vec3(.8,.74,.5), lane*.5);
          if (uNight > .5) {
            // mokry asfalt: kałuże odbijające neony
            col *= .32;
            float pud = smoothstep(.52, .66, fbm(vW*.22 + 2.));
            vec3 refl = mix(vec3(1.,.2,.7), vec3(.2,.8,1.), fbm(vW*.08 + 5.)) * (.25 + .35*fbm(vW*1.5));
            col = mix(col, vec3(.03,.03,.06) + refl, pud * .75);
          }
          gl_FragColor = vec4(col, 1.);
          #include <fog_fragment>
        }`,
      fog: true,
    }),
  )
  // fog w ShaderMaterial wymaga uniformów fog
  Object.assign(groundMat.uniforms, THREE.UniformsUtils.clone(THREE.UniformsLib.fog))
  groundMat.vertexShader = `#include <fog_pars_vertex>\n` + groundMat.vertexShader.replace('gl_Position = projectionMatrix*viewMatrix*w;', 'vec4 mvPosition = viewMatrix*w; gl_Position = projectionMatrix*mvPosition;\n#include <fog_vertex>\n')
  groundMat.fragmentShader = `#include <fog_pars_fragment>\n` + groundMat.fragmentShader
  const ground = new THREE.Mesh(T(new THREE.PlaneGeometry(CITY_HALF * 4, CITY_HALF * 4)), groundMat)
  ground.rotation.x = -Math.PI / 2
  group.add(ground)
  const shadowGround = new THREE.Mesh(T(new THREE.PlaneGeometry(CITY_HALF * 2.4, CITY_HALF * 2.4)), T(new THREE.ShadowMaterial({ opacity: 0.38 })))
  shadowGround.rotation.x = -Math.PI / 2
  shadowGround.position.y = 0.01
  shadowGround.receiveShadow = true
  group.add(shadowGround)

  // ── zrujnowane budynki ───────────────────────────────────
  const bases = ['#8d8a82', '#9a8f7e', '#7f8584', '#a39b8c', '#857a6e', '#8f9488']
  const facadeMats = bases.map((b) => {
    const tex = T(facadeTex(rng, b))
    return T(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 }))
  })
  const slabMat = T(new THREE.MeshStandardMaterial({ color: 0x77736b, roughness: 1 }))
  const rebarMat = T(new THREE.MeshStandardMaterial({ color: 0x5a3b28, roughness: 0.8, metalness: 0.5 }))
  const mossMat = T(new THREE.MeshStandardMaterial({ color: 0x4d6b2a, roughness: 1 }))
  const ivyMat = T(new THREE.MeshStandardMaterial({ map: T(ivyTex(rng)), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.9 }))
  addWind(ivyMat, uTime, 0.08, 0.15)
  const rebarGeo = T(new THREE.CylinderGeometry(0.03, 0.03, 1, 4))
  rebarGeo.translate(0, 0.5, 0)

  const scaleUV = (geo: THREE.BoxGeometry, w: number, h: number, d: number) => {
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute
    const dims: [number, number][] = [
      [d, h],
      [d, h],
      [w, d],
      [w, d],
      [w, h],
      [w, h],
    ]
    for (let f = 0; f < 6; f++)
      for (let i = 0; i < 4; i++) {
        const k = f * 4 + i
        uv.setXY(k, uv.getX(k) * (dims[f][0] / 6), uv.getY(k) * (dims[f][1] / 6))
      }
  }
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, uv = true) => {
    const geo = T(new THREE.BoxGeometry(w, h, d))
    if (uv) scaleUV(geo, w, h, d)
    const m = new THREE.Mesh(geo, mat)
    m.position.set(x, y + h / 2, z)
    m.castShadow = true
    m.receiveShadow = true
    group.add(m)
    return m
  }

  /** odległość (Czebyszew, max 3) do najbliższej komórki chodnika */
  const openWithin = (i: number, j: number) => {
    for (let r = 1; r <= 2; r++)
      for (let dj = -r; dj <= r; dj++)
        for (let di = -r; di <= r; di++) if (!wall(i + di, j + dj) && i + di >= 0 && j + dj >= 0 && i + di < GW && j + dj < GH) return r
    return 3
  }
  const ivyGeo = T(new THREE.PlaneGeometry(2.2, 1))
  ivyGeo.translate(0, -0.5, 0) // zaczepione u góry, zwisa w dół
  for (let j = 0; j < GH; j++)
    for (let i = 0; i < GW; i++) {
      if (!wall(i, j)) continue
      const x = cx(i)
      const z = cz(j)
      // głębokie wnętrze kwartału: niewidoczne z ulicy — pełny budynek tylko przy ulicy,
      // drugi rząd jako prosta bryła (linia dachów), dalej nic
      const depth = openWithin(i, j)
      if (depth > 2) continue
      const mat = facadeMats[Math.floor(rng() * facadeMats.length)]
      if (depth === 2) {
        box(CELL, 14 + rng() * 14, CELL, mat, x, 0, z).castShadow = false
        continue
      }
      const border = i === 0 || j === 0 || i === GW - 1 || j === GH - 1
      const H = border ? 12 + rng() * 14 : 6 + rng() * 13
      const solid = H * (0.55 + rng() * 0.25)
      box(CELL, solid, CELL, mat, x, 0, z)
      // postrzępiona góra: 4 fragmenty o różnych wysokościach, część zawalona
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          if (rng() < 0.28) continue
          const ph = (H - solid) * (0.3 + rng() * 0.7)
          const w = CELL / 2 - rng() * 0.6
          const d = CELL / 2 - rng() * 0.6
          box(w, ph, d, mat, x + sx * CELL * 0.25, solid, z + sz * CELL * 0.25)
          // pręty zbrojeniowe sterczące z ruin
          if (rng() < 0.5)
            for (let k = 0; k < 3; k++) {
              const r = new THREE.Mesh(rebarGeo, rebarMat)
              r.position.set(x + sx * CELL * 0.25 + (rng() - 0.5) * w, solid + ph, z + sz * CELL * 0.25 + (rng() - 0.5) * d)
              r.scale.y = 0.6 + rng() * 1.4
              r.rotation.set((rng() - 0.5) * 0.7, 0, (rng() - 0.5) * 0.7)
              group.add(r)
            }
        }
      // mech na dachu
      box(CELL * 0.92, 0.08, CELL * 0.92, mossMat, x, solid, z, false).castShadow = false

      // strony od ulicy: wystające stropy, bluszcz
      const sides: [number, number][] = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]
      for (const [dx, dz] of sides) {
        if (wall(i + dx, j + dz)) continue
        const along = dx === 0
        // wystający strop na którymś piętrze (wysoko — nie blokuje ruchu)
        if (rng() < 0.45 && solid > 6) {
          const y = 3 * Math.floor(2 + rng() * Math.max(1, solid / 3 - 2))
          const len = CELL * (0.4 + rng() * 0.5)
          const slab = box(along ? len : 1.1, 0.25, along ? 1.1 : len, slabMat, x + dx * (CELL / 2 + 0.5), y, z + dz * (CELL / 2 + 0.5), false)
          slab.rotation.set(along ? (rng() - 0.5) * 0.3 : 0, 0, along ? 0 : (rng() - 0.5) * 0.3)
        }
        // bluszcz zwisający z góry ściany
        const n = 1 + Math.floor(rng() * 3)
        for (let k = 0; k < n; k++) {
          if (rng() < 0.3) continue
          const len = solid * (0.35 + rng() * 0.6)
          const ivy = new THREE.Mesh(ivyGeo, ivyMat)
          const off = (rng() - 0.5) * (CELL - 2)
          ivy.position.set(x + dx * (CELL / 2 + 0.04) + (along ? off : 0), solid - 0.1, z + dz * (CELL / 2 + 0.04) + (along ? 0 : off))
          ivy.rotation.y = Math.atan2(dx, dz)
          ivy.scale.set(0.8 + rng() * 0.8, len, 1)
          ivy.castShadow = true
          group.add(ivy)
        }
      }
    }

  // ── trawa (instancjonowana, kołysze się) ─────────────────
  const grassTex = T(grassBladeTex())
  const grassMat = T(new THREE.MeshStandardMaterial({ map: grassTex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1 }))
  addWind(grassMat, uTime, 0.25, 1.4)
  const tuft = new THREE.PlaneGeometry(0.9, 0.75)
  tuft.translate(0, 0.37, 0)
  const tuft2 = tuft.clone().rotateY(Math.PI / 2)
  const grassGeo = T(mergeGeos([tuft, tuft2]))
  tuft.dispose()
  tuft2.dispose()
  const GRASS = 5200
  const grass = new THREE.InstancedMesh(grassGeo, grassMat, GRASS)
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  let gi = 0
  const nearWall = (x: number, z: number) => wall(ci(x + 0.9), cj(z)) || wall(ci(x - 0.9), cj(z)) || wall(ci(x), cj(z + 0.9)) || wall(ci(x), cj(z - 0.9))
  for (let tries = 0; tries < GRASS * 4 && gi < GRASS; tries++) {
    const [i, j] = walk[Math.floor(rng() * walk.length)]
    const x = cx(i) + (rng() - 0.5) * CELL
    const z = cz(j) + (rng() - 0.5) * CELL
    // więcej trawy przy ścianach i na placach, mniej na środku jezdni
    const dense = nearWall(x, z) || MAP[j][i] === 'P'
    if (!dense && rng() < 0.6) continue
    const s = 0.6 + rng() * (dense ? 1.1 : 0.6)
    q.setFromAxisAngle(up, rng() * Math.PI)
    m4.compose(new THREE.Vector3(x, floorY(i, j), z), q, new THREE.Vector3(s, s * (0.8 + rng() * 0.6), s))
    grass.setMatrixAt(gi++, m4)
  }
  grass.count = gi
  grass.receiveShadow = true
  group.add(grass)

  // ── krzaki ───────────────────────────────────────────────
  const bushGeo = T(new THREE.IcosahedronGeometry(0.7, 1))
  const bushMat = T(new THREE.MeshStandardMaterial({ color: 0x4a6a28, roughness: 1, flatShading: true }))
  addWind(bushMat, uTime, 0.06, 0.8)
  const BUSH = 140
  const bushes = new THREE.InstancedMesh(bushGeo, bushMat, BUSH)
  const bushCol = new THREE.Color()
  for (let b = 0; b < BUSH; b++) {
    const [i, j] = walk[Math.floor(rng() * walk.length)]
    // przy ścianie
    const side = Math.floor(rng() * 4)
    const off = (rng() - 0.5) * (CELL - 1)
    const e = CELL / 2 - 0.6
    const x = cx(i) + (side === 0 ? e : side === 1 ? -e : off)
    const z = cz(j) + (side === 2 ? e : side === 3 ? -e : off)
    const s = 0.7 + rng() * 1.1
    m4.compose(new THREE.Vector3(x, floorY(i, j) + s * 0.35, z), q.setFromAxisAngle(up, rng() * 6), new THREE.Vector3(s, s * 0.75, s))
    bushes.setMatrixAt(b, m4)
    bushes.setColorAt(b, bushCol.setHSL(0.22 + rng() * 0.08, 0.45, 0.22 + rng() * 0.12))
  }
  bushes.castShadow = true
  bushes.receiveShadow = true
  group.add(bushes)

  // ── drzewa wyrastające z asfaltu (place) ─────────────────
  const trunkMat = T(new THREE.MeshStandardMaterial({ color: 0x4b3a2a, roughness: 1 }))
  const leafMat = T(new THREE.MeshStandardMaterial({ color: 0x55782c, roughness: 0.9, flatShading: true }))
  addWind(leafMat, uTime, 0.18, 0.12)
  const trunkGeo = T(new THREE.CylinderGeometry(0.18, 0.32, 4, 7))
  trunkGeo.translate(0, 2, 0)
  const crownGeo = T(new THREE.IcosahedronGeometry(1.6, 1))
  const treeSpots: THREE.Vector3[] = []
  const underDeck = (i: number, j: number) => decks.some((d) => d.cells.some(([a, b]) => a === i && b === j))
  const plazaCells = walk.filter(([i, j]) => MAP[j][i] === 'P' && !underDeck(i, j))
  for (const [i, j] of plazaCells) {
    if (rng() < 0.45) continue
    const x = cx(i) + (rng() - 0.5) * (CELL - 2.5)
    const z = cz(j) + (rng() - 0.5) * (CELL - 2.5)
    const t = new THREE.Group()
    const s = 0.8 + rng() * 0.6
    const trunk = new THREE.Mesh(trunkGeo, trunkMat)
    trunk.castShadow = true
    t.add(trunk)
    for (let k = 0; k < 4; k++) {
      const c = new THREE.Mesh(crownGeo, leafMat)
      c.position.set((rng() - 0.5) * 2, 4 + rng() * 1.5, (rng() - 0.5) * 2)
      c.scale.setScalar(0.7 + rng() * 0.6)
      c.castShadow = true
      t.add(c)
    }
    t.position.set(x, floorY(i, j), z)
    t.scale.setScalar(s)
    t.rotation.y = rng() * 6
    group.add(t)
    treeSpots.push(t.position.clone())
    boxes.push({ minX: x - 0.35 * s, maxX: x + 0.35 * s, minZ: z - 0.35 * s, maxZ: z + 0.35 * s })
  }

  // ── wraki aut (przeszkody) ───────────────────────────────
  const rustMats = [0x7a4a2c, 0x5e5a52, 0x6b3b2b, 0x4f5c5a].map((c) => T(new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, metalness: 0.35 })))
  const glassMat = T(new THREE.MeshStandardMaterial({ color: 0x1a2226, roughness: 0.3, metalness: 0.6 }))
  const tireMat = T(new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 1 }))
  const carBody = T(new THREE.BoxGeometry(1.8, 0.75, 4.1))
  carBody.translate(0, 0.6, 0)
  const carTop = T(new THREE.BoxGeometry(1.6, 0.6, 2))
  carTop.translate(0, 1.27, -0.15)
  const tireGeo = T(new THREE.CylinderGeometry(0.35, 0.35, 0.25, 10))
  tireGeo.rotateZ(Math.PI / 2)
  const corridorCells = walk.filter(([i, j]) => MAP[j][i] === '.')
  let cars = 0
  for (const [i, j] of corridorCells) {
    if (rng() > 0.13 || cars > 14) continue
    const horiz = !wall(i - 1, j) || !wall(i + 1, j) // ulica biegnie wzdłuż X?
    const x = cx(i) + (horiz ? (rng() - 0.5) * 2 : (rng() < 0.5 ? -1.6 : 1.6))
    const z = cz(j) + (horiz ? (rng() < 0.5 ? -1.6 : 1.6) : (rng() - 0.5) * 2)
    const car = new THREE.Group()
    const body = new THREE.Mesh(carBody, rustMats[Math.floor(rng() * rustMats.length)])
    const top = new THREE.Mesh(carTop, glassMat)
    body.castShadow = top.castShadow = body.receiveShadow = true
    car.add(body, top)
    for (const [tx, tz] of [
      [0.85, 1.3],
      [-0.85, 1.3],
      [0.85, -1.3],
      [-0.85, -1.3],
    ]) {
      if (rng() < 0.35) continue // brak koła
      const t = new THREE.Mesh(tireGeo, tireMat)
      t.position.set(tx, 0.35, tz)
      car.add(t)
    }
    const yaw = (horiz ? Math.PI / 2 : 0) + (rng() - 0.5) * 0.5
    car.rotation.set((rng() - 0.5) * 0.06, yaw, (rng() - 0.5) * 0.12)
    car.position.set(x, -0.05, z)
    group.add(car)
    const hw = horiz ? 2.1 : 1
    const hd = horiz ? 1 : 2.1
    boxes.push({ minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd })
    cars++
  }

  // ── gruz przy ścianach ───────────────────────────────────
  const rubbleGeo = T(new THREE.DodecahedronGeometry(0.35, 0))
  const rubbleMat = T(new THREE.MeshStandardMaterial({ color: 0x8a8378, roughness: 1, flatShading: true }))
  const RUB = 420
  const rubble = new THREE.InstancedMesh(rubbleGeo, rubbleMat, RUB)
  for (let r = 0; r < RUB; r++) {
    const [i, j] = walk[Math.floor(rng() * walk.length)]
    const side = Math.floor(rng() * 4)
    const off = (rng() - 0.5) * CELL
    const e = CELL / 2 - 0.3 - rng() * 0.8
    const x = cx(i) + (side === 0 ? e : side === 1 ? -e : off)
    const z = cz(j) + (side === 2 ? e : side === 3 ? -e : off)
    const s = 0.4 + rng() * 1.3
    m4.compose(new THREE.Vector3(x, floorY(i, j) + s * 0.12, z), q.setFromEuler(new THREE.Euler(rng() * 6, rng() * 6, rng() * 6)), new THREE.Vector3(s, s * 0.6, s))
    rubble.setMatrixAt(r, m4)
    rubble.setColorAt(r, bushCol.setHSL(0.08, 0.08, 0.42 + rng() * 0.15))
  }
  rubble.castShadow = true
  rubble.receiveShadow = true
  group.add(rubble)

  // ── beczki z ogniem (migoczące światło + dym) ────────────
  const barrelGeo = T(new THREE.CylinderGeometry(0.4, 0.4, 1.1, 12))
  barrelGeo.translate(0, 0.55, 0)
  const barrelMat = T(new THREE.MeshStandardMaterial({ color: 0x5c3a24, roughness: 0.7, metalness: 0.5 }))
  const flameGeo = T(new THREE.ConeGeometry(0.32, 0.9, 8, 1, true))
  flameGeo.translate(0, 0.45, 0)
  const flameMat = T(new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
  const flameMat2 = T(new THREE.MeshBasicMaterial({ color: 0xfff0a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
  const fires: { light: THREE.PointLight; f1: THREE.Mesh; f2: THREE.Mesh; pos: THREE.Vector3; phase: number }[] = []
  for (const [i, j] of plazaCells.filter(() => rng() < 0.35).slice(0, 7)) {
    const x = cx(i) + (rng() - 0.5) * 3
    const z = cz(j) + (rng() - 0.5) * 3
    const fy = floorY(i, j)
    const b = new THREE.Mesh(barrelGeo, barrelMat)
    b.position.set(x, fy, z)
    b.castShadow = true
    group.add(b)
    const f1 = new THREE.Mesh(flameGeo, flameMat)
    const f2 = new THREE.Mesh(flameGeo, flameMat2)
    f1.position.set(x, fy + 1.05, z)
    f2.position.set(x, fy + 1.05, z)
    f2.scale.setScalar(0.55)
    group.add(f1, f2)
    const light = new THREE.PointLight(0xff8a3a, 8, 9, 1.6)
    light.position.set(x, fy + 1.8, z)
    group.add(light)
    fires.push({ light, f1, f2, pos: new THREE.Vector3(x, fy + 1.5, z), phase: rng() * 10 })
    boxes.push({ minX: x - 0.45, maxX: x + 0.45, minZ: z - 0.45, maxZ: z + 0.45, top: fy + 1.1 })
  }
  // dym: wspólna pula sprite'ów
  const smokeTex = T(
    canvasTex(
      64,
      64,
      (g) => {
        const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32)
        grd.addColorStop(0, 'rgba(120,115,110,0.55)')
        grd.addColorStop(1, 'rgba(120,115,110,0)')
        g.fillStyle = grd
        g.fillRect(0, 0, 64, 64)
      },
      false,
    ),
  )
  const smoke: { s: THREE.Sprite; mat: THREE.SpriteMaterial; t: number; life: number; v: THREE.Vector3 }[] = []
  for (let k = 0; k < fires.length * 8; k++) {
    const mat = T(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0 }))
    const s = new THREE.Sprite(mat)
    group.add(s)
    smoke.push({ s, mat, t: rng() * 3, life: 3, v: new THREE.Vector3() })
  }

  // ── zwisające kable między budynkami (kołyszą się, iskrzą) ─
  const cableMat = T(new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.8 }))
  const cables: { mesh: THREE.Mesh; base: number; phase: number; spark: THREE.Vector3 | null }[] = []
  for (const [i, j] of corridorCells) {
    if (rng() > 0.22) continue
    const alongX = wall(i, j - 1) && wall(i, j + 1) // ściany po bokach w osi Z → kabel w poprzek (wzdłuż Z)
    const a = new THREE.Vector3(cx(i), 0, cz(j))
    const b = a.clone()
    const y = 4.5 + rng() * 3
    if (alongX) {
      a.z -= CELL / 2
      b.z += CELL / 2
    } else {
      a.x -= CELL / 2
      b.x += CELL / 2
    }
    a.y = y
    b.y = y + (rng() - 0.5)
    const broken = rng() < 0.35
    const pts: THREE.Vector3[] = []
    for (let k = 0; k <= 16; k++) {
      const t = k / 16
      const p = a.clone().lerp(b, broken ? t * 0.55 : t)
      p.y -= broken ? t * t * 2.6 : Math.sin(t * Math.PI) * 1.1
      pts.push(p)
    }
    const geo = T(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.025, 4))
    const mesh = new THREE.Mesh(geo, cableMat)
    const pivot = new THREE.Group()
    pivot.position.copy(a)
    mesh.position.sub(a)
    pivot.add(mesh)
    group.add(pivot)
    cables.push({ mesh: pivot as unknown as THREE.Mesh, base: 0, phase: rng() * 10, spark: broken ? pts[pts.length - 1].clone() : null })
  }

  // ── migoczący, zepsuty neon ──────────────────────────────
  const neonMats: THREE.MeshBasicMaterial[] = []
  const neonWords = ['RANDOM PLAY', 'HOTEL', 'NOODLES', 'OPEN 24', 'ARCADE', 'HOLLOW', 'BAR', 'SIXTH ST', 'KARAOKE', 'RAMEN']
  const neonCols: [string, string, number][] = [
    ['#ff3ea5', '#ff7ac4', 0xff3ea5],
    ['#3ee8ff', '#9ff4ff', 0x3ee8ff],
    ['#b04dff', '#d9a6ff', 0xb04dff],
    ['#ffd23f', '#fff0a0', 0xffc23f],
  ]
  const maxNeons = night ? 18 : 5
  let neons = 0
  let neonLights = 0
  for (const [i, j] of walk) {
    if (neons >= maxNeons || rng() > (night ? 0.25 : 0.08)) continue
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      if (!wall(i + dx, j + dz)) continue
      const [glow, fill, lc] = neonCols[night ? neons % neonCols.length : 0]
      const mat = T(new THREE.MeshBasicMaterial({ map: T(neonTex(neonWords[neons % neonWords.length], glow, fill)), transparent: true, side: THREE.DoubleSide }))
      const sign = new THREE.Mesh(T(new THREE.PlaneGeometry(3, 0.75)), mat)
      sign.position.set(cx(i) + dx * (CELL / 2 - 0.05), 3.4, cz(j) + dz * (CELL / 2 - 0.05))
      sign.rotation.y = Math.atan2(-dx, -dz)
      sign.rotation.z = (rng() - 0.5) * 0.25 // przekrzywiony
      group.add(sign)
      neonMats.push(mat)
      if (night && neonLights < 8) {
        const l = new THREE.PointLight(lc, 10, 11, 1.6)
        l.position.set(cx(i) + dx * (CELL / 2 - 1.2), 3.2, cz(j) + dz * (CELL / 2 - 1.2))
        group.add(l)
        neonLights++
      }
      neons++
      break
    }
  }

  // ── ptaki krążące nad miastem ────────────────────────────
  const birdMat = T(new THREE.MeshBasicMaterial({ color: 0x1d1d22, side: THREE.DoubleSide }))
  const wingGeo = T(new THREE.BufferGeometry())
  wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.12, 0, 0, -0.12, 0.55, 0, 0], 3))
  const flocks: { center: THREE.Vector3; r: number; speed: number; birds: { g: THREE.Group; l: THREE.Mesh; r: THREE.Mesh; off: THREE.Vector3; ph: number }[] }[] = []
  for (let f = 0; f < 3; f++) {
    const center = new THREE.Vector3((rng() - 0.5) * CITY_HALF, 24 + rng() * 10, (rng() - 0.5) * CITY_HALF)
    const birds = []
    for (let k = 0; k < 7 + Math.floor(rng() * 6); k++) {
      const g = new THREE.Group()
      const l = new THREE.Mesh(wingGeo, birdMat)
      const r = new THREE.Mesh(wingGeo, birdMat)
      r.scale.x = -1
      g.add(l, r)
      g.scale.setScalar(0.9 + rng() * 0.5)
      group.add(g)
      birds.push({ g, l, r, off: new THREE.Vector3((rng() - 0.5) * 6, (rng() - 0.5) * 2, (rng() - 0.5) * 6), ph: rng() * 6 })
    }
    flocks.push({ center, r: 14 + rng() * 14, speed: (0.12 + rng() * 0.1) * (rng() < 0.5 ? 1 : -1), birds })
  }

  // ── motyle ───────────────────────────────────────────────
  const flyGeo = T(new THREE.PlaneGeometry(0.16, 0.12))
  flyGeo.translate(0.08, 0, 0)
  const butterflies: { g: THREE.Group; l: THREE.Mesh; r: THREE.Mesh; home: THREE.Vector3; ph: number }[] = []
  const flyCols = [0xffd23f, 0xff8fd2, 0xffffff, 0x7fd6ff]
  for (let k = 0; k < 22; k++) {
    const [i, j] = walk[Math.floor(rng() * walk.length)]
    const mat = T(new THREE.MeshBasicMaterial({ color: flyCols[k % flyCols.length], side: THREE.DoubleSide }))
    const g = new THREE.Group()
    const l = new THREE.Mesh(flyGeo, mat)
    const r = new THREE.Mesh(flyGeo, mat)
    r.scale.x = -1
    g.add(l, r)
    group.add(g)
    butterflies.push({ g, l, r, home: new THREE.Vector3(cx(i), floorY(i, j) + 0.8, cz(j)), ph: rng() * 20 })
  }

  // ── pyłki / kurz w słońcu (wokół gracza) ─────────────────
  const MOTES = night ? 120 : 260
  const moteArr = new Float32Array(MOTES * 3)
  for (let k = 0; k < MOTES; k++) moteArr.set([(rng() - 0.5) * 30, rng() * 6, (rng() - 0.5) * 30], k * 3)
  const moteGeo = T(new THREE.BufferGeometry())
  moteGeo.setAttribute('position', new THREE.BufferAttribute(moteArr, 3))
  const motes = new THREE.Points(moteGeo, T(new THREE.PointsMaterial({ color: 0xfff6d0, size: 0.05, transparent: true, opacity: 0.7, depthWrite: false })))
  group.add(motes)

  // ── spadające liście (przy drzewach) ─────────────────────
  const leafGeo = T(new THREE.PlaneGeometry(0.12, 0.08))
  const leafM = T(new THREE.MeshStandardMaterial({ color: 0x9a8a30, side: THREE.DoubleSide }))
  const leaves: { m: THREE.Mesh; t: number; tree: THREE.Vector3; seed: number }[] = []
  if (treeSpots.length)
    for (let k = 0; k < 60; k++) {
      const m = new THREE.Mesh(leafGeo, leafM)
      group.add(m)
      leaves.push({ m, t: rng() * 6, tree: treeSpots[k % treeSpots.length], seed: rng() * 10 })
    }

  // ── podmuch kurzu przelatujący korytarzem ────────────────
  const GUST = 140
  const gustArr = new Float32Array(GUST * 3)
  const gustGeo = T(new THREE.BufferGeometry())
  gustGeo.setAttribute('position', new THREE.BufferAttribute(gustArr, 3))
  const gustMat = T(new THREE.PointsMaterial({ color: 0xc9b79a, size: 0.09, transparent: true, opacity: 0, depthWrite: false }))
  const gust = new THREE.Points(gustGeo, gustMat)
  group.add(gust)
  const gustState = { t: 4, dir: new THREE.Vector3(1, 0, 0), origin: new THREE.Vector3() }

  // ── iskry z kabli ────────────────────────────────────────
  const sparkGeo = T(new THREE.BufferGeometry())
  const SPK = 40
  const sparkArr = new Float32Array(SPK * 3)
  const sparkVel = Array.from({ length: SPK }, () => new THREE.Vector3())
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkArr, 3))
  const sparkMat = T(new THREE.PointsMaterial({ color: 0xbfe6ff, size: 0.08, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
  const sparks = new THREE.Points(sparkGeo, sparkMat)
  group.add(sparks)
  const sparkLight = new THREE.PointLight(0x9fd8ff, 0, 6)
  group.add(sparkLight)
  const sparkState = { t: 2, life: 0 }

  // ── platformy (rusztowania) i wyrzutnie (kratki wentylacyjne) ─
  decorateDecksCity(ctx)

  return {
    update(time, dt, player, camera) {
      sky.position.set(camera.x, 0, camera.z)

      // ogień
      for (const f of fires) {
        const fl = 0.75 + Math.sin(time * 17 + f.phase) * 0.12 + Math.sin(time * 31 + f.phase * 2) * 0.1 + Math.random() * 0.06
        f.light.intensity = 7 * fl + 2
        f.f1.scale.set(1, fl * 1.3, 1)
        f.f2.scale.set(0.55, fl * 0.9, 0.55)
        f.f1.rotation.y = time * 3
      }
      flameMat.opacity = 0.7 + Math.random() * 0.2
      for (let k = 0; k < smoke.length; k++) {
        const p = smoke[k]
        const f = fires[k % fires.length]
        p.t += dt
        if (p.t >= p.life) {
          p.t = 0
          p.s.position.copy(f.pos).add(new THREE.Vector3((Math.random() - 0.5) * 0.2, 0, (Math.random() - 0.5) * 0.2))
          p.v.set(0.25 + (Math.random() - 0.5) * 0.2, 0.9 + Math.random() * 0.4, (Math.random() - 0.5) * 0.2)
        }
        const k01 = p.t / p.life
        p.s.position.addScaledVector(p.v, dt)
        p.s.scale.setScalar(0.5 + k01 * 2.6)
        p.mat.opacity = Math.sin(k01 * Math.PI) * 0.5
      }

      // kable kołyszą się na wietrze
      for (const c of cables) c.mesh.rotation.x = Math.sin(time * 1.3 + c.phase) * 0.05
      // iskry co kilka sekund z losowego zerwanego kabla
      sparkState.t -= dt
      const broken = cables.filter((c) => c.spark)
      if (sparkState.t <= 0 && broken.length) {
        sparkState.t = 1.5 + Math.random() * 3
        sparkState.life = 0.6
        const src = broken[Math.floor(Math.random() * broken.length)].spark!
        for (let k = 0; k < SPK; k++) {
          sparkArr.set([src.x, src.y, src.z], k * 3)
          sparkVel[k].set((Math.random() - 0.5) * 4, Math.random() * 2, (Math.random() - 0.5) * 4)
        }
        sparkLight.position.copy(src)
      }
      if (sparkState.life > 0) {
        sparkState.life -= dt
        const at = sparkGeo.getAttribute('position') as THREE.BufferAttribute
        for (let k = 0; k < SPK; k++) {
          sparkVel[k].y -= 12 * dt
          at.setXYZ(k, at.getX(k) + sparkVel[k].x * dt, Math.max(0.05, at.getY(k) + sparkVel[k].y * dt), at.getZ(k) + sparkVel[k].z * dt)
        }
        at.needsUpdate = true
        sparkMat.opacity = Math.max(0, sparkState.life / 0.6)
        sparkLight.intensity = Math.random() < 0.5 ? 14 * sparkMat.opacity : 0
      } else {
        sparkMat.opacity = 0
        sparkLight.intensity = 0
      }

      // migający neon
      for (const [k, m] of neonMats.entries()) {
        const s = Math.sin(time * 7 + k * 3) + Math.sin(time * 23 + k)
        m.opacity = s > 1.3 ? 0.15 : 0.95
      }

      // ptaki
      for (const f of flocks) {
        const a = time * f.speed
        for (const b of f.birds) {
          const ang = a + b.off.x * 0.03
          const x = f.center.x + Math.cos(ang) * (f.r + b.off.z)
          const z = f.center.z + Math.sin(ang) * (f.r + b.off.z)
          b.g.position.set(x, f.center.y + b.off.y + Math.sin(time + b.ph) * 0.6, z)
          b.g.rotation.y = -ang + (f.speed > 0 ? 0 : Math.PI)
          const flap = Math.sin(time * 9 + b.ph) * 0.7
          b.l.rotation.z = flap
          b.r.rotation.z = -flap
        }
      }

      // motyle krążą wokół swoich miejsc
      for (const b of butterflies) {
        const t = time * 0.6 + b.ph
        b.g.position.set(b.home.x + Math.sin(t) * 1.5 + Math.sin(t * 2.3) * 0.4, 0.6 + Math.abs(Math.sin(t * 1.7)) * 0.9, b.home.z + Math.cos(t * 0.8) * 1.5)
        b.g.rotation.y = t * 1.3
        const flap = Math.sin(time * 22 + b.ph) * 1.1
        b.l.rotation.y = flap
        b.r.rotation.y = -flap
      }

      // pyłki dryfują wokół gracza
      motes.position.set(player.x, 0, player.z)
      const ma = moteGeo.getAttribute('position') as THREE.BufferAttribute
      for (let k = 0; k < MOTES; k++) {
        let y = ma.getY(k) + Math.sin(time + k) * dt * 0.15 + dt * 0.05
        if (y > 6) y = 0
        ma.setXYZ(k, ma.getX(k) + Math.sin(time * 0.3 + k) * dt * 0.2, y, ma.getZ(k) + Math.cos(time * 0.2 + k) * dt * 0.2)
      }
      ma.needsUpdate = true

      // liście spadają z drzew
      for (const l of leaves) {
        l.t += dt
        const life = 6
        if (l.t > life) l.t = 0
        const k = l.t / life
        l.m.position.set(l.tree.x + Math.sin(l.t * 1.5 + l.seed) * 1.2 + k * 2, 5.5 - k * 5.4, l.tree.z + Math.cos(l.t * 1.2 + l.seed) * 1.2)
        l.m.rotation.set(l.t * 3 + l.seed, l.t * 2, l.t * 4)
      }

      // podmuch kurzu
      gustState.t -= dt
      if (gustState.t <= 0) {
        gustState.t = 7 + Math.random() * 6
        const a = Math.random() * Math.PI * 2
        gustState.dir.set(Math.cos(a), 0, Math.sin(a))
        gustState.origin.copy(player).addScaledVector(gustState.dir, -10)
        for (let k = 0; k < GUST; k++) gustArr.set([gustState.origin.x + (Math.random() - 0.5) * 4, Math.random() * 1.5, gustState.origin.z + (Math.random() - 0.5) * 4], k * 3)
      }
      const gl = 7 + 6 - gustState.t // czas od startu podmuchu (przybliżony)
      const active = gustState.t > 3
      gustMat.opacity = active ? Math.min(0.5, (gustState.t - 3) * 0.3) : 0
      if (active) {
        const ga = gustGeo.getAttribute('position') as THREE.BufferAttribute
        for (let k = 0; k < GUST; k++)
          ga.setXYZ(k, ga.getX(k) + gustState.dir.x * dt * (6 + (k % 5)), ga.getY(k) + Math.sin(gl * 3 + k) * dt * 0.6, ga.getZ(k) + gustState.dir.z * dt * (6 + (k % 5)))
        ga.needsUpdate = true
      }
        },
  }
}

/** Rusztowania z blachy + kratki z podmuchem. */
function decorateDecksCity(ctx: DecorCtx) {
  const { group, T, decks, pads } = ctx
  const plateMat = T(new THREE.MeshStandardMaterial({ color: 0x6d6a63, roughness: 0.6, metalness: 0.6 }))
  const railMat = T(new THREE.MeshStandardMaterial({ color: 0xc2552c, roughness: 0.7, metalness: 0.4 }))
  const legGeo = T(new THREE.CylinderGeometry(0.07, 0.07, 1, 6))
  legGeo.translate(0, 0.5, 0)
  for (const d of decks) {
    for (const [i, j] of d.cells) {
      const plate = new THREE.Mesh(T(new THREE.BoxGeometry(CELL, 0.25, CELL)), plateMat)
      plate.position.set(cx(i), d.y - 0.125, cz(j))
      plate.castShadow = true
      plate.receiveShadow = true
      group.add(plate)
      for (const [sx, sz] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]) {
        const leg = new THREE.Mesh(legGeo, railMat)
        leg.position.set(cx(i) + sx * (CELL / 2 - 0.2), ctx.floorY(i, j), cz(j) + sz * (CELL / 2 - 0.2))
        leg.scale.y = d.y - ctx.floorY(i, j)
        group.add(leg)
      }
      // poręcz wzdłuż krawędzi bez sąsiedniej płyty
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        if (d.cells.some(([a, b]) => a === i + dx && b === j + dz)) continue
        const along = dx === 0
        const rail = new THREE.Mesh(T(new THREE.BoxGeometry(along ? CELL : 0.08, 0.08, along ? 0.08 : CELL)), railMat)
        rail.position.set(cx(i) + dx * (CELL / 2 - 0.05), d.y + 0.9, cz(j) + dz * (CELL / 2 - 0.05))
        group.add(rail)
      }
    }
  }
  const grateMat = T(new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5, metalness: 0.8, emissive: 0x3ee8ff, emissiveIntensity: 0.25 }))
  for (const p of pads) {
    const g = new THREE.Mesh(T(new THREE.CylinderGeometry(0.85, 0.95, 0.12, 16)), grateMat)
    g.position.copy(p.pos).setY(p.pos.y + 0.06)
    group.add(g)
    const glow = new THREE.Mesh(T(new THREE.CylinderGeometry(0.7, 0.85, 3.2, 16, 1, true)), T(new THREE.MeshBasicMaterial({ color: 0x9ff4ff, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })))
    glow.position.copy(p.pos).setY(p.pos.y + 1.6)
    group.add(glow)
  }
}
