import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { addWind, grassBladeTex } from './city'
import { CELL, CITY_HALF, GH, GW, MAP, cx, cz, wall } from './grid'
import { Ground, type Biome, type Decor, type DecorCtx } from './world'

// ─────────────────────────────────────────────────────────────
//  Biomy naturalne:
//   • forest  — lewitujące skały, wodospady, woda, świecące rośliny
//   • arctic  — lodowe klify, śnieg, zorza, ośnieżone świerki
//   • volcano — bazaltowe kolumny, lawa, żar, popiół
// ─────────────────────────────────────────────────────────────

const NOISE = `
  float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
  float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
  float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*n(p); p*=2.03; a*=.5; } return s; }
  vec2 vor(vec2 p){ vec2 i=floor(p), f=fract(p); float d1=8., d2=8.;
    for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ vec2 g=vec2(x,y); vec2 o=vec2(h(i+g), h(i+g+17.)); float d=length(g+o-f);
      if(d<d1){ d2=d1; d1=d; } else if(d<d2) d2=d; }
    return vec2(d1, d2); }
`

/** ShaderMaterial z obsługą mgły sceny (vW = pozycja świata xz). */
function fogShader(uniforms: Record<string, THREE.IUniform>, frag: string, opts: Partial<THREE.ShaderMaterialParameters> = {}) {
  const m = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...uniforms },
    vertexShader: `#include <fog_pars_vertex>
      varying vec2 vW; varying vec2 vUv; varying vec3 vP;
      void main(){ vUv = uv; vec4 w = modelMatrix*vec4(position,1.); vW = w.xz; vP = w.xyz;
        vec4 mvPosition = viewMatrix*w; gl_Position = projectionMatrix*mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `#include <fog_pars_fragment>
      varying vec2 vW; varying vec2 vUv; varying vec3 vP;
      ${NOISE}
      ${frag}`,
    fog: true,
    ...opts,
  })
  return m
}

const SKY: Record<'forest' | 'arctic' | 'volcano', string> = {
  forest: `
    vec3 top = vec3(.28,.62,.86), hor = vec3(.78,.95,.92);
    vec3 col = mix(hor, top, pow(max(y,0.), .6));
    float sd = max(dot(vD, normalize(vec3(.4,.5,-.75))), 0.);
    col += vec3(1.,.95,.75) * (pow(sd, 700.)*3. + pow(sd, 10.)*.3);
    if (y > 0.) { vec2 uv = vD.xz/(y+.12)*1.2 + vec2(uTime*.01, 0.); float c = smoothstep(.45,.8,fbm(uv));
      col = mix(col, vec3(1.,.98,.95), c*.75*smoothstep(0.,.3,y)); }
    // mgiełka przy horyzoncie
    col = mix(col, vec3(.75,.93,.9), smoothstep(.18, 0., abs(y)) * .6);`,
  arctic: `
    vec3 top = vec3(.08,.16,.36), hor = vec3(.62,.74,.86);
    vec3 col = mix(hor, top, pow(max(y,0.), .5));
    float sd = max(dot(vD, normalize(vec3(.6,.18,-.7))), 0.);
    col += vec3(1.,.8,.6) * (pow(sd, 500.)*2.5 + pow(sd, 6.)*.35);
    // zorza polarna
    if (y > .05) { vec2 uv = vD.xz/(y+.2);
      float band = sin(uv.x*1.3 + fbm(uv*.7 + uTime*.05)*4. + uTime*.2);
      float a = smoothstep(.6, 1., band) * smoothstep(.05, .35, y) * smoothstep(.9, .4, y);
      col += mix(vec3(.1,1.,.5), vec3(.6,.3,1.), fbm(uv*.5 + 3.)) * a * .55; }`,
  volcano: `
    vec3 top = vec3(.07,.03,.03), hor = vec3(.55,.18,.07);
    vec3 col = mix(hor, top, pow(max(y,0.), .5));
    if (y > -.05) { vec2 uv = vD.xz/(y+.15)*1.1 + vec2(uTime*.02, uTime*.006); float c = fbm(uv);
      col = mix(col, mix(vec3(.08,.05,.05), vec3(.55,.2,.08), smoothstep(.2,0.,y)*.8), smoothstep(.35,.75,c)*.9); }
    col += vec3(1.,.4,.1) * smoothstep(.12, 0., abs(y)) * .35;`,
}

const GROUND: Record<'forest' | 'arctic' | 'volcano', string> = {
  forest: `
    float tone = fbm(vW*.25);
    vec3 col = mix(vec3(.16,.34,.16), vec3(.32,.52,.22), tone);
    col = mix(col, vec3(.3,.25,.16), smoothstep(.6,.8,fbm(vW*.12+7.))*.6);
    // świecące punkciki (bioluminescencja)
    vec2 v = vor(vW*1.3);
    float dot1 = smoothstep(.12, .0, v.x) * step(.82, h(floor(vW*1.3)));
    col += mix(vec3(.2,.9,1.), vec3(.8,.3,1.), h(floor(vW*1.3)+3.)) * dot1 * (.6 + .4*sin(uTime*2. + h(floor(vW*1.3))*20.));`,
  arctic: `
    float tone = fbm(vW*.2);
    vec3 col = mix(vec3(.66,.74,.84), vec3(.86,.9,.96), tone);
    vec2 v = vor(vW*.3);
    col = mix(col, vec3(.62,.76,.9), (1.-smoothstep(0., .05, v.y - v.x))*.4);
    col += vec3(1.) * step(.995, h(floor(vW*9.))) * .5;`,
  volcano: `
    float tone = fbm(vW*.3);
    vec3 col = mix(vec3(.09,.07,.07), vec3(.2,.16,.14), tone);
    vec2 v = vor(vW*.35);
    float crack = 1. - smoothstep(0., .07, v.y - v.x);
    float pulse = .6 + .4*sin(uTime*1.7 + fbm(vW*.2)*8.);
    col += vec3(1.,.35,.05) * crack * pulse * smoothstep(.35,.6,fbm(vW*.15+2.)) * 1.4;`,
}

const PALETTE = {
  forest: { rockTop: 0x4f8a34, rockSide: 0x5f5548, rockSide2: 0x7a7060, h: [8, 22] as [number, number] },
  arctic: { rockTop: 0xf6faff, rockSide: 0x8fb8dc, rockSide2: 0xc6def2, h: [6, 16] as [number, number] },
  volcano: { rockTop: 0x2a2220, rockSide: 0x1b1514, rockSide2: 0x3a2e2a, h: [5, 14] as [number, number] },
}

/** Zniekształca bryłę szumem (organiczne skały); zwraca nieindeksowaną geometrię z kolorami. */
function rockGeo(base: THREE.BufferGeometry, rng: () => number, top: THREE.Color, side: THREE.Color, side2: THREE.Color, wob: number) {
  const g = base.index ? base.toNonIndexed() : base
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  const cache = new Map<string, number>()
  for (let k = 0; k < pos.count; k++) {
    const key = `${pos.getX(k).toFixed(3)},${pos.getY(k).toFixed(3)},${pos.getZ(k).toFixed(3)}`
    let d = cache.get(key)
    if (d === undefined) {
      d = 1 + (rng() - 0.5) * wob
      cache.set(key, d)
    }
    pos.setXYZ(k, pos.getX(k) * d, pos.getY(k), pos.getZ(k) * d)
  }
  g.computeVertexNormals()
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute
  const cols = new Float32Array(pos.count * 3)
  const c = new THREE.Color()
  g.computeBoundingBox()
  const bb = g.boundingBox!
  for (let k = 0; k < pos.count; k += 3) {
    // kolor per ściana (flat)
    const ny = (nrm.getY(k) + nrm.getY(k + 1) + nrm.getY(k + 2)) / 3
    const yy = (pos.getY(k) - bb.min.y) / Math.max(0.01, bb.max.y - bb.min.y)
    if (ny > 0.55 && yy > 0.5) c.copy(top)
    else c.copy(side).lerp(side2, rng() * 0.6).multiplyScalar(0.8 + yy * 0.35)
    for (let v = 0; v < 3; v++) cols.set([c.r, c.g, c.b], (k + v) * 3)
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3))
  if (g.getAttribute('uv')) g.deleteAttribute('uv')
  return g
}

export function decorateNature(ctx: DecorCtx): Decor {
  const biome = ctx.biome as Exclude<Biome, 'city' | 'neon'>
  const { group, T, rng, uTime, walk, floorY, ground, decks, pads } = ctx
  const P = PALETTE[biome]
  const updaters: ((time: number, dt: number, player: THREE.Vector3, camera: THREE.Vector3) => void)[] = []
  const add = <O extends THREE.Object3D>(o: O) => (group.add(o), o)
  const nearAt = (i: number, j: number, r: number) => {
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) if (!wall(i + di, j + dj)) return true
    return false
  }

  // ── niebo ────────────────────────────────────────────────
  const skyMat = T(
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uTime },
      vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `uniform float uTime; varying vec3 vD; ${NOISE}
        void main(){ float y = clamp(vD.y, -0.1, 1.); ${SKY[biome]} gl_FragColor = vec4(col, 1.); }`,
    }),
  )
  const sky = add(new THREE.Mesh(T(new THREE.SphereGeometry(190, 32, 16)), skyMat))
  updaters.push((_t, _d, _p, cam) => sky.position.set(cam.x, 0, cam.z))

  // ── ziemia ───────────────────────────────────────────────
  const groundMat = T(fogShader({ uTime }, `uniform float uTime; void main(){ ${GROUND[biome]} gl_FragColor = vec4(col, 1.);
    #include <fog_fragment>
    }`))
  const groundMesh = add(new THREE.Mesh(T(new THREE.PlaneGeometry(CITY_HALF * 4, CITY_HALF * 4)), groundMat))
  groundMesh.rotation.x = -Math.PI / 2
  const shadowGround = add(new THREE.Mesh(T(new THREE.PlaneGeometry(CITY_HALF * 2.4, CITY_HALF * 2.4)), T(new THREE.ShadowMaterial({ opacity: 0.35 }))))
  shadowGround.rotation.x = -Math.PI / 2
  shadowGround.position.y = 0.01
  shadowGround.receiveShadow = true

  // ── ściany: skały / lód / bazalt ─────────────────────────
  const topC = new THREE.Color(P.rockTop)
  const sideC = new THREE.Color(P.rockSide)
  const side2C = new THREE.Color(P.rockSide2)
  const rockTops: { x: number; z: number; y: number; i: number; j: number }[] = []
  {
    const geos: THREE.BufferGeometry[] = []
    for (let j = 0; j < GH; j++)
      for (let i = 0; i < GW; i++) {
        if (!wall(i, j)) continue
        const near1 = nearAt(i, j, 1)
        if (!near1 && !nearAt(i, j, 2)) continue
        const x = cx(i)
        const z = cz(j)
        const H = (P.h[0] + rng() * (P.h[1] - P.h[0])) * (near1 ? 1 : 1.4)
        if (biome === 'volcano') {
          // pęk bazaltowych kolumn
          const n = near1 ? 5 : 2
          for (let k = 0; k < n; k++) {
            const r = near1 ? 1 + rng() * 0.9 : 2.6
            const hh = H * (0.5 + rng() * 0.6)
            const g = new THREE.CylinderGeometry(r, r * 1.05, hh, 6, 1)
            g.translate(x + (rng() - 0.5) * (CELL - r * 1.6), hh / 2, z + (rng() - 0.5) * (CELL - r * 1.6))
            geos.push(rockGeo(g, rng, topC, sideC, side2C, 0.05))
            g.dispose()
          }
          // jedna centralna, która domyka komórkę
          const g = new THREE.CylinderGeometry(CELL * 0.55, CELL * 0.6, H * 0.45, 6)
          g.translate(x, H * 0.225, z)
          geos.push(rockGeo(g, rng, topC, sideC, side2C, 0.08))
          g.dispose()
          rockTops.push({ x, z, y: H * 0.45, i, j })
        } else {
          const g = new THREE.IcosahedronGeometry(1, biome === 'arctic' ? 0 : 1)
          g.scale(CELL * 0.62, H / 2, CELL * 0.62)
          g.rotateY(rng() * Math.PI)
          g.translate(x, H / 2 - 0.5, z)
          geos.push(rockGeo(g, rng, topC, sideC, side2C, biome === 'arctic' ? 0.25 : 0.35))
          g.dispose()
          if (near1 && rng() < 0.6) {
            const b = new THREE.IcosahedronGeometry(1, 0)
            const s = 1 + rng() * 1.4
            b.scale(s * 1.2, s, s * 1.2)
            b.translate(x + (rng() - 0.5) * 3, H * (0.3 + rng() * 0.5), z + (rng() - 0.5) * 3)
            geos.push(rockGeo(b, rng, topC, sideC, side2C, 0.4))
            b.dispose()
          }
          rockTops.push({ x, z, y: H - 1.2, i, j })
        }
      }
    const merged = T(mergeGeometries(geos)!)
    geos.forEach((g) => g.dispose())
    const rocks = add(new THREE.Mesh(merged, T(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: biome === 'arctic' ? 0.35 : 0.95, metalness: biome === 'arctic' ? 0.1 : 0, flatShading: true }))))
    rocks.castShadow = true
    rocks.receiveShadow = true
  }

  // ── trawa / śnieg / popiół ───────────────────────────────
  if (biome !== 'volcano') {
    const grassTex = T(grassBladeTex())
    const grassMat = T(new THREE.MeshStandardMaterial({ map: grassTex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1, color: biome === 'arctic' ? 0xd8e4ea : 0xbff0b0 }))
    addWind(grassMat, uTime, 0.25, 1.4)
    const tuft = new THREE.PlaneGeometry(0.9, 0.75)
    tuft.translate(0, 0.37, 0)
    const grassGeo = T(mergeGeometries([tuft, tuft.clone().rotateY(Math.PI / 2)])!)
    tuft.dispose()
    const COUNT = biome === 'forest' ? 4200 : 1400
    const grass = new THREE.InstancedMesh(grassGeo, grassMat, COUNT)
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    let gi = 0
    for (let t = 0; t < COUNT * 3 && gi < COUNT; t++) {
      const [i, j] = walk[Math.floor(rng() * walk.length)]
      if (ground(i, j) !== Ground.Normal) continue
      const s = 0.6 + rng() * (biome === 'forest' ? 1.4 : 0.6)
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI)
      m4.compose(new THREE.Vector3(cx(i) + (rng() - 0.5) * CELL, floorY(i, j), cz(j) + (rng() - 0.5) * CELL), q, new THREE.Vector3(s, s, s))
      grass.setMatrixAt(gi++, m4)
    }
    grass.count = gi
    add(grass)
  }

  // ── woda / lawa (płaskie tafle na komórkach) ─────────────
  const liquid = biome === 'forest' ? Ground.Water : biome === 'volcano' ? Ground.Lava : -1
  const liquidCells = walk.filter(([i, j]) => ground(i, j) === liquid)
  if (liquidCells.length) {
    const geos = liquidCells.map(([i, j]) => {
      const g = new THREE.PlaneGeometry(CELL, CELL)
      g.rotateX(-Math.PI / 2)
      g.translate(cx(i), floorY(i, j) + (liquid === Ground.Water ? 0.07 : 0.05), cz(j))
      return g
    })
    const merged = T(mergeGeometries(geos)!)
    geos.forEach((g) => g.dispose())
    const mat =
      liquid === Ground.Water
        ? T(
            fogShader(
              { uTime },
              `uniform float uTime; void main(){
                float r = fbm(vW*.5 + vec2(uTime*.12, uTime*.07)) + fbm(vW*1.3 - vec2(uTime*.2, 0.))*.5;
                vec3 col = mix(vec3(.04,.3,.36), vec3(.2,.7,.72), r*.7);
                col += vec3(1.) * smoothstep(1.05, 1.25, r) * .5;
                gl_FragColor = vec4(col, .82);
                #include <fog_fragment>
              }`,
              { transparent: true, depthWrite: false },
            ),
          )
        : T(
            fogShader(
              { uTime },
              `uniform float uTime; void main(){
                vec2 p = vW*.35 + vec2(uTime*.05, uTime*.03);
                float f = fbm(p + fbm(p*1.7 - uTime*.08));
                vec3 col = mix(vec3(.55,.06,0.), vec3(1.,.55,.05), smoothstep(.35,.75,f));
                col = mix(col, vec3(1.,.95,.5), smoothstep(.78,.95,f));
                col *= .85 + .25*sin(uTime*2. + f*6.);
                gl_FragColor = vec4(col, 1.);
                #include <fog_fragment>
              }`,
            ),
          )
    const sheet = add(new THREE.Mesh(merged, mat))
    sheet.renderOrder = 1
    if (liquid === Ground.Lava) {
      // kilka świateł nad lawą
      const step = Math.max(1, Math.floor(liquidCells.length / 6))
      for (let k = 0; k < liquidCells.length && k / step < 6; k += step) {
        const [i, j] = liquidCells[k]
        const l = add(new THREE.PointLight(0xff6a1a, 14, 14, 1.4))
        l.position.set(cx(i), 1.4, cz(j))
        const ph = rng() * 10
        updaters.push((t) => (l.intensity = 12 + Math.sin(t * 3 + ph) * 3))
      }
    }
  }

  // ── spadająca woda / lawa ────────────────────────────────
  const fallMat = (lava: boolean) =>
    T(
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: lava ? THREE.AdditiveBlending : THREE.NormalBlending,
        uniforms: { uTime, uLen: { value: 10 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
        fragmentShader: `uniform float uTime; uniform float uLen; varying vec2 vUv; ${NOISE}
          void main(){
            float y = vUv.y * uLen;
            float s = n(vec2(vUv.x*10., y*.35 + uTime*${lava ? '1.2' : '3.2'}));
            float streak = smoothstep(.45,.95, n(vec2(vUv.x*26., y*.08 + uTime*${lava ? '.6' : '2.'})));
            float edge = smoothstep(0.,.12,vUv.x)*smoothstep(1.,.88,vUv.x);
            float a = (.45 + .55*s) * edge * smoothstep(0., .04, vUv.y);
            vec3 col = ${lava ? 'mix(vec3(1.,.3,.02), vec3(1.,.85,.3), streak + s*.3)' : 'mix(vec3(.55,.85,.95), vec3(1.), streak*.8 + s*.25)'};
            gl_FragColor = vec4(col, a * ${lava ? '.9' : '.8'});
          }`,
      }),
    )
  const waterFall = biome === 'forest' ? fallMat(false) : null
  const lavaFall = biome === 'volcano' ? fallMat(true) : null
  const mistTex = T(
    new THREE.CanvasTexture(
      (() => {
        const c = document.createElement('canvas')
        c.width = c.height = 64
        const g = c.getContext('2d')!
        const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32)
        grd.addColorStop(0, 'rgba(255,255,255,0.8)')
        grd.addColorStop(1, 'rgba(255,255,255,0)')
        g.fillStyle = grd
        g.fillRect(0, 0, 64, 64)
        return c
      })(),
    ),
  )
  const mists: { s: THREE.Sprite; base: THREE.Vector3; ph: number }[] = []
  /** pionowa kurtyna spadającej cieczy od (x,yTop,z) w dół do yBot, zwrócona normalną n */
  const addFall = (mat: THREE.ShaderMaterial, x: number, z: number, yTop: number, yBot: number, w: number, nx: number, nz: number) => {
    const len = yTop - yBot
    const m = mat.clone()
    m.uniforms = { uTime, uLen: { value: len } }
    T(m)
    const g = T(new THREE.PlaneGeometry(w, len))
    const f = add(new THREE.Mesh(g, m))
    f.position.set(x, yBot + len / 2, z)
    f.rotation.y = Math.atan2(nx, nz)
    f.renderOrder = 2
    // druga, szersza i bledsza warstwa — objętość
    const f2 = add(new THREE.Mesh(g, m))
    f2.position.copy(f.position).add(new THREE.Vector3(nx * 0.25, 0, nz * 0.25))
    f2.rotation.y = f.rotation.y
    f2.scale.set(1.35, 1, 1)
    if (mat === waterFall) {
      for (let k = 0; k < 3; k++) {
        const s = add(new THREE.Sprite(T(new THREE.SpriteMaterial({ map: mistTex, transparent: true, opacity: 0.35, depthWrite: false }))))
        const base = new THREE.Vector3(x + nx * 0.8 + (rng() - 0.5) * w, yBot + 0.6, z + nz * 0.8 + (rng() - 0.5) * w)
        s.position.copy(base)
        s.scale.setScalar(2.5 + rng() * 1.5)
        mists.push({ s, base, ph: rng() * 10 })
      }
    }
  }
  updaters.push((t) => {
      for (const m of mists) {
        const k = (t * 0.5 + m.ph) % 1
        m.s.position.set(m.base.x, m.base.y + k * 1.5, m.base.z)
        ;(m.s.material as THREE.SpriteMaterial).opacity = Math.sin(k * Math.PI) * 0.4
        m.s.scale.setScalar(2 + k * 2.5)
      }
    })

  // wodospady / lawospady z klifów do sąsiedniej cieczy (i czasem na zwykłą ścieżkę)
  if (waterFall || lavaFall) {
    const mat = (waterFall ?? lavaFall)!
    let falls = 0
    const maxFalls = biome === 'forest' ? 16 : 8
    for (const r of rockTops.sort(() => rng() - 0.5)) {
      if (falls >= maxFalls) break
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const ni = r.i + dx
        const nj = r.j + dz
        if (wall(ni, nj)) continue
        const intoLiquid = ground(ni, nj) === liquid
        if (!intoLiquid && rng() > (biome === 'forest' ? 0.12 : 0.04)) continue
        addFall(mat, r.x + dx * (CELL / 2 + 0.35), r.z + dz * (CELL / 2 + 0.35), r.y, floorY(ni, nj), 1.6 + rng() * 1.6, dx, dz)
        falls++
        break
      }
    }
  }

  // ── lewitujące wyspy (platformy) + dekoracyjne góry w chmurach ─
  const islands: { g: THREE.Object3D; base: number; ph: number; amp: number }[] = []
  const islandMesh = (rx: number, rz: number, depth: number) => {
    const top = new THREE.CylinderGeometry(1, 0.92, 0.6, 12, 1)
    top.translate(0, -0.3, 0)
    const under = new THREE.ConeGeometry(0.92, depth, 10, 3)
    under.rotateX(Math.PI)
    under.translate(0, -0.6 - depth / 2, 0)
    const g1 = rockGeo(top, rng, new THREE.Color(0x5aa83a), new THREE.Color(0x6a5a44), new THREE.Color(0x4a6a32), 0.08)
    const g2 = rockGeo(under, rng, new THREE.Color(0x5a5248), new THREE.Color(0x5a5248), new THREE.Color(0x7a6e5e), 0.35)
    const g = mergeGeometries([g1, g2])!
    g1.dispose()
    g2.dispose()
    g.scale(rx, 1, rz)
    return T(g)
  }
  const islandMat = T(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }))
  if (biome === 'forest') {
    // platformy, na które da się wskoczyć (kolizja = komórki decku)
    for (const d of decks) {
      const along = d.cells[0][0] !== d.cells[1][0] // domino wzdłuż X?
      const g = new THREE.Group()
      const m = new THREE.Mesh(islandMesh(along ? CELL * 1.05 : CELL * 0.62, along ? CELL * 0.62 : CELL * 1.05, 4 + rng() * 3), islandMat)
      m.castShadow = true
      m.receiveShadow = true
      g.add(m)
      g.position.copy(d.center)
      add(g)
      // mały wodospad z krawędzi
      const nx = along ? 0 : 1
      const nz = along ? 1 : 0
      const sgn = rng() < 0.5 ? -1 : 1
      addFall(waterFall!, d.center.x + nx * sgn * (CELL * 0.6), d.center.z + nz * sgn * (CELL * 0.6), d.y - 0.4, 0, 1.4, nx * sgn, nz * sgn)
      // pnącza zwisające spod wyspy
      const vineMat = T(new THREE.MeshStandardMaterial({ color: 0x3f7a30, side: THREE.DoubleSide }))
      for (let k = 0; k < 8; k++) {
        const len = 1.5 + rng() * 3
        const v = new THREE.Mesh(T(new THREE.PlaneGeometry(0.12, len)), vineMat)
        const a = rng() * Math.PI * 2
        v.position.set(Math.cos(a) * 2.2, -0.8 - len / 2, Math.sin(a) * 2.2)
        v.rotation.y = rng() * 3
        g.add(v)
      }
    }
    // dekoracyjne góry w chmurach z wodospadami (Avatar)
    for (let k = 0; k < 11; k++) {
      const a = (k / 11) * Math.PI * 2 + rng() * 0.4
      const r = CITY_HALF * (0.45 + rng() * 0.75)
      const x = Math.cos(a) * r
      const z = Math.sin(a) * r
      const y = 20 + rng() * 26
      const s = 4 + rng() * 9
      const g = new THREE.Group()
      const m = new THREE.Mesh(islandMesh(s, s * (0.7 + rng() * 0.5), s * (1.6 + rng())), islandMat)
      g.add(m)
      // drzewka na wierzchu
      for (let t = 0; t < 3 + s / 3; t++) {
        const tr = new THREE.Mesh(T(new THREE.ConeGeometry(0.6 + rng() * 0.6, 2 + rng() * 2.5, 6)), T(new THREE.MeshStandardMaterial({ color: 0x2f7a3a, flatShading: true })))
        const ta = rng() * Math.PI * 2
        const tr2 = rng() * s * 0.7
        tr.position.set(Math.cos(ta) * tr2, 1.2, Math.sin(ta) * tr2)
        g.add(tr)
      }
      g.position.set(x, y, z)
      add(g)
      islands.push({ g, base: y, ph: rng() * 10, amp: 0.4 + rng() * 0.6 })
      // 1–2 długie wodospady znikające w mgle
      for (let w = 0; w < 1 + Math.floor(rng() * 2); w++) {
        const wa = rng() * Math.PI * 2
        addFall(waterFall!, x + Math.cos(wa) * s * 0.85, z + Math.sin(wa) * s * 0.85, y - 0.5, y - 18 - rng() * 14, 1.5 + rng() * 2.5, Math.cos(wa), Math.sin(wa))
      }
    }
    updaters.push((t) => {
      for (const isl of islands) isl.g.position.y = isl.base + Math.sin(t * 0.25 + isl.ph) * isl.amp
    })

    // grzyby-trampoliny (wyrzutnie)
    const capMat = T(new THREE.MeshStandardMaterial({ color: 0xa05cff, emissive: 0x7a2cff, emissiveIntensity: 0.6, roughness: 0.5 }))
    const stemMat = T(new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.8 }))
    for (const p of pads) {
      const stem = add(new THREE.Mesh(T(new THREE.CylinderGeometry(0.25, 0.35, 0.5, 8)), stemMat))
      stem.position.copy(p.pos).setY(p.pos.y + 0.25)
      const cap = add(new THREE.Mesh(T(new THREE.SphereGeometry(0.95, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)), capMat))
      cap.position.copy(p.pos).setY(p.pos.y + 0.45)
      cap.scale.y = 0.55
      const ph = rng() * 6
      updaters.push((t) => {
        const k = 1 + Math.sin(t * 3 + ph) * 0.06
        cap.scale.set(k, 0.55 / k, k)
      })
    }
  }

  // ── arktyka / wulkan: kry lodowe i obsydianowe półki + gejzery / wyloty magmy ─
  if (biome === 'arctic' || biome === 'volcano') {
    const ice = biome === 'arctic'
    const slabMat = T(
      ice
        ? new THREE.MeshStandardMaterial({ color: 0xd8eefc, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.92, flatShading: true })
        : new THREE.MeshStandardMaterial({ color: 0x1c1416, roughness: 0.35, metalness: 0.3, flatShading: true }),
    )
    const glowMat = T(new THREE.MeshBasicMaterial({ color: ice ? 0x9fe8ff : 0xff5a10 }))
    for (const d of decks) {
      const along = d.cells[0][0] !== d.cells[1][0]
      const sx = along ? CELL * 2 : CELL
      const sz = along ? CELL : CELL * 2
      const g = new THREE.Group()
      const slab = new THREE.Mesh(T(new THREE.BoxGeometry(sx + 0.3, 0.7, sz + 0.3)), slabMat)
      slab.position.y = -0.35
      slab.castShadow = true
      slab.receiveShadow = true
      g.add(slab)
      // świecąca krawędź
      const rim = new THREE.Mesh(T(new THREE.BoxGeometry(sx + 0.42, 0.08, sz + 0.42)), glowMat)
      rim.position.y = -0.04
      g.add(rim)
      // sople / stalaktyty żaru pod spodem
      const coneMat = ice ? slabMat : T(new THREE.MeshStandardMaterial({ color: 0x2a1a16, emissive: 0x5a1400, emissiveIntensity: 0.8, flatShading: true }))
      for (let k = 0; k < 14; k++) {
        const len = 0.8 + rng() * 2.4
        const c = new THREE.Mesh(T(new THREE.ConeGeometry(0.18 + rng() * 0.25, len, 5)), coneMat)
        c.rotation.x = Math.PI
        c.position.set((rng() - 0.5) * sx, -0.7 - len / 2, (rng() - 0.5) * sz)
        g.add(c)
      }
      // filary podtrzymujące
      for (const [px, pz] of [[-1, -1], [1, 1]]) {
        const h = d.y - 0.7
        const col = new THREE.Mesh(T(new THREE.CylinderGeometry(0.35, 0.5, h, 6)), ice ? slabMat : coneMat)
        col.position.set(px * (sx / 2 - 0.6), -0.7 - h / 2, pz * (sz / 2 - 0.6))
        g.add(col)
      }
      g.position.copy(d.center)
      add(g)
    }
    // wyrzutnie: gejzer pary / wylot magmy z pulsującą kolumną
    const ventMat = T(new THREE.MeshStandardMaterial({ color: ice ? 0x9fb8cc : 0x2a1c18, roughness: 0.9, flatShading: true }))
    const plumeMat = T(new THREE.MeshBasicMaterial({ color: ice ? 0xeaf8ff : 0xff7a20, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
    for (const p of pads) {
      const ring = add(new THREE.Mesh(T(new THREE.TorusGeometry(0.9, 0.3, 6, 10)), ventMat))
      ring.rotation.x = Math.PI / 2
      ring.position.copy(p.pos).setY(p.pos.y + 0.15)
      const core = add(new THREE.Mesh(T(new THREE.CircleGeometry(0.75, 12)), glowMat))
      core.rotation.x = -Math.PI / 2
      core.position.copy(p.pos).setY(p.pos.y + 0.12)
      const plume = add(new THREE.Mesh(T(new THREE.CylinderGeometry(0.4, 0.8, 3, 12, 1, true)), plumeMat))
      plume.position.copy(p.pos).setY(p.pos.y + 1.6)
      const ph = rng() * 6
      updaters.push((t) => {
        const k = 0.6 + Math.abs(Math.sin(t * 1.6 + ph)) * 0.6
        plume.scale.set(1, k, 1)
        plume.position.y = p.pos.y + 0.2 + 1.5 * k
      })
    }
  }

  // ── rośliny / drzewa / kryształy na placach ──────────────
  const underDeck = (i: number, j: number) => decks.some((d) => d.cells.some(([a, b]) => a === i && b === j))
  const plaza = walk.filter(([i, j]) => (MAP[j][i] === 'P' || MAP[j][i] === '.') && ground(i, j) === Ground.Normal && !underDeck(i, j) && !pads.some((p) => p.i === i && p.j === j))
  const propBoxes = (x: number, z: number, r: number, top?: number) => ctx.boxes.push({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, top })
  if (biome === 'forest') {
    // wielkie drzewa ze świecącymi liśćmi
    const trunkMat = T(new THREE.MeshStandardMaterial({ color: 0x5a4636, roughness: 1 }))
    const leafMats = [0x2f8a4a, 0x3aa070, 0x2a7a6a].map((c) => T(new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.8, emissive: 0x0a3a30, emissiveIntensity: 0.4 })))
    const trunkGeo = T(new THREE.CylinderGeometry(0.35, 0.7, 1, 8))
    trunkGeo.translate(0, 0.5, 0)
    const crownGeo = T(new THREE.IcosahedronGeometry(1, 1))
    let trees = 0
    for (const [i, j] of plaza) {
      if (MAP[j][i] !== 'P' || rng() > 0.28 || trees > 26) continue
      const x = cx(i) + (rng() - 0.5) * (CELL - 2.5)
      const z = cz(j) + (rng() - 0.5) * (CELL - 2.5)
      const H = 5 + rng() * 6
      const t = new THREE.Group()
      const trunk = new THREE.Mesh(trunkGeo, trunkMat)
      trunk.scale.set(1, H, 1)
      trunk.castShadow = true
      t.add(trunk)
      for (let k = 0; k < 5; k++) {
        const c = new THREE.Mesh(crownGeo, leafMats[k % 3])
        c.position.set((rng() - 0.5) * 3, H + rng() * 1.5, (rng() - 0.5) * 3)
        c.scale.setScalar(1.4 + rng() * 1.2)
        c.castShadow = true
        t.add(c)
      }
      t.position.set(x, floorY(i, j), z)
      add(t)
      propBoxes(x, z, 0.55)
      trees++
    }
    // świecące rośliny (bioluminescencja)
    const glowGeo = T(new THREE.ConeGeometry(0.12, 0.9, 5))
    glowGeo.translate(0, 0.45, 0)
    const glowCols = [0x3ee8ff, 0xb04dff, 0x5dff8a, 0xff6ad5]
    const glowMats = glowCols.map((c) => T(new THREE.MeshBasicMaterial({ color: c })))
    for (const mat of glowMats) {
      const COUNT = 90
      const inst = new THREE.InstancedMesh(glowGeo, mat, COUNT)
      const m4 = new THREE.Matrix4()
      for (let k = 0; k < COUNT; k++) {
        const [i, j] = walk[Math.floor(rng() * walk.length)]
        const s = 0.6 + rng() * 1.2
        m4.compose(
          new THREE.Vector3(cx(i) + (rng() - 0.5) * CELL, floorY(i, j), cz(j) + (rng() - 0.5) * CELL),
          new THREE.Quaternion().setFromEuler(new THREE.Euler((rng() - 0.5) * 0.5, 0, (rng() - 0.5) * 0.5)),
          new THREE.Vector3(s, s, s),
        )
        inst.setMatrixAt(k, m4)
      }
      add(inst)
    }
    // paprocie (krzyżowe płaty)
    const fernMat = T(new THREE.MeshStandardMaterial({ color: 0x3f9a48, side: THREE.DoubleSide, roughness: 0.9 }))
    addWind(fernMat, uTime, 0.12, 1)
    const fernGeo = T(new THREE.PlaneGeometry(1.6, 1.1))
    fernGeo.translate(0, 0.55, 0)
    const ferns = new THREE.InstancedMesh(fernGeo, fernMat, 160)
    const m4 = new THREE.Matrix4()
    for (let k = 0; k < 160; k++) {
      const [i, j] = walk[Math.floor(rng() * walk.length)]
      const e = CELL / 2 - 0.5
      const side = Math.floor(rng() * 4)
      const off = (rng() - 0.5) * CELL
      const x = cx(i) + (side === 0 ? e : side === 1 ? -e : off)
      const z = cz(j) + (side === 2 ? e : side === 3 ? -e : off)
      m4.compose(new THREE.Vector3(x, floorY(i, j), z), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.3, rng() * 6, 0)), new THREE.Vector3(1, 1 + rng(), 1))
      ferns.setMatrixAt(k, m4)
    }
    add(ferns)
  } else if (biome === 'arctic') {
    // ośnieżone świerki
    const pineMat = T(new THREE.MeshStandardMaterial({ color: 0x2c5a48, flatShading: true }))
    const snowMat = T(new THREE.MeshStandardMaterial({ color: 0xf6faff, flatShading: true, roughness: 0.6 }))
    let trees = 0
    for (const [i, j] of plaza) {
      if (rng() > 0.22 || trees > 30) continue
      const x = cx(i) + (rng() - 0.5) * (CELL - 2)
      const z = cz(j) + (rng() - 0.5) * (CELL - 2)
      const t = new THREE.Group()
      const H = 4 + rng() * 4
      for (let k = 0; k < 3; k++) {
        const r = (1.6 - k * 0.4) * (H / 6)
        const cone = new THREE.Mesh(T(new THREE.ConeGeometry(r, H * 0.42, 7)), pineMat)
        cone.position.y = H * 0.25 + k * H * 0.24
        cone.castShadow = true
        t.add(cone)
        const cap = new THREE.Mesh(T(new THREE.ConeGeometry(r * 0.75, H * 0.18, 7)), snowMat)
        cap.position.y = cone.position.y + H * 0.13
        t.add(cap)
      }
      t.position.set(x, floorY(i, j), z)
      add(t)
      propBoxes(x, z, 0.5)
      trees++
    }
    // kryształy lodu
    const crystalMat = T(new THREE.MeshStandardMaterial({ color: 0xbfeaff, emissive: 0x3aa0ff, emissiveIntensity: 0.35, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.85, flatShading: true }))
    for (let k = 0; k < 40; k++) {
      const [i, j] = plaza[Math.floor(rng() * plaza.length)] ?? walk[0]
      const g = new THREE.Group()
      for (let c = 0; c < 3 + rng() * 3; c++) {
        const h = 0.8 + rng() * 2.2
        const m = new THREE.Mesh(T(new THREE.ConeGeometry(0.22 + rng() * 0.2, h, 5)), crystalMat)
        m.position.set((rng() - 0.5) * 0.8, h / 2, (rng() - 0.5) * 0.8)
        m.rotation.set((rng() - 0.5) * 0.8, rng() * 3, (rng() - 0.5) * 0.8)
        g.add(m)
      }
      const e = CELL / 2 - 0.7
      const side = Math.floor(rng() * 4)
      const off = (rng() - 0.5) * CELL
      g.position.set(cx(i) + (side === 0 ? e : side === 1 ? -e : off), floorY(i, j), cz(j) + (side === 2 ? e : side === 3 ? -e : off))
      add(g)
    }
    // zaspy śnieżne
    const driftGeo = T(new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2))
    const drifts = new THREE.InstancedMesh(driftGeo, snowMat, 120)
    const m4 = new THREE.Matrix4()
    for (let k = 0; k < 120; k++) {
      const [i, j] = walk[Math.floor(rng() * walk.length)]
      const side = Math.floor(rng() * 4)
      const off = (rng() - 0.5) * CELL
      const e = CELL / 2 - 0.4
      const s = 0.6 + rng() * 1.4
      m4.compose(new THREE.Vector3(cx(i) + (side === 0 ? e : side === 1 ? -e : off), floorY(i, j) - 0.1, cz(j) + (side === 2 ? e : side === 3 ? -e : off)), new THREE.Quaternion(), new THREE.Vector3(s * 1.6, s * 0.5, s))
      drifts.setMatrixAt(k, m4)
    }
    drifts.receiveShadow = true
    add(drifts)
  } else {
    // zwęglone drzewa + dymiące szczeliny
    const charMat = T(new THREE.MeshStandardMaterial({ color: 0x1a1412, roughness: 1, flatShading: true }))
    let trees = 0
    for (const [i, j] of plaza) {
      if (rng() > 0.16 || trees > 20) continue
      const x = cx(i) + (rng() - 0.5) * (CELL - 2)
      const z = cz(j) + (rng() - 0.5) * (CELL - 2)
      const t = new THREE.Group()
      const H = 3 + rng() * 3
      const trunk = new THREE.Mesh(T(new THREE.CylinderGeometry(0.12, 0.3, H, 5)), charMat)
      trunk.position.y = H / 2
      t.add(trunk)
      for (let b = 0; b < 3; b++) {
        const br = new THREE.Mesh(T(new THREE.CylinderGeometry(0.04, 0.1, 1.6, 4)), charMat)
        br.position.y = H * (0.55 + b * 0.15)
        br.rotation.set(0, b * 2.1, 0.9)
        br.translateY(0.7)
        t.add(br)
      }
      t.position.set(x, floorY(i, j), z)
      add(t)
      propBoxes(x, z, 0.3)
      trees++
    }
    // świecące głazy obsydianu
    const obsMat = T(new THREE.MeshStandardMaterial({ color: 0x120c10, roughness: 0.2, metalness: 0.3, emissive: 0x3a0d03, emissiveIntensity: 0.5, flatShading: true }))
    for (let k = 0; k < 45; k++) {
      const [i, j] = walk[Math.floor(rng() * walk.length)]
      if (ground(i, j) !== Ground.Normal) continue
      const s = 0.4 + rng() * 0.9
      const m = add(new THREE.Mesh(T(new THREE.DodecahedronGeometry(s, 0)), obsMat))
      const side = Math.floor(rng() * 4)
      const off = (rng() - 0.5) * CELL
      const e = CELL / 2 - 0.5
      m.position.set(cx(i) + (side === 0 ? e : side === 1 ? -e : off), floorY(i, j) + s * 0.3, cz(j) + (side === 2 ? e : side === 3 ? -e : off))
      m.rotation.set(rng() * 3, rng() * 3, rng() * 3)
      m.castShadow = true
    }
    // wulkan na horyzoncie
    const volc = add(new THREE.Mesh(T(new THREE.ConeGeometry(55, 70, 14, 1, true)), T(new THREE.MeshStandardMaterial({ color: 0x1c1210, flatShading: true }))))
    const va = rng() * Math.PI * 2
    volc.position.set(Math.cos(va) * (CITY_HALF + 70), 30, Math.sin(va) * (CITY_HALF + 70))
    const crater = add(new THREE.Mesh(T(new THREE.SphereGeometry(9, 12, 8)), T(new THREE.MeshBasicMaterial({ color: 0xff6a1a, fog: false }))))
    crater.position.copy(volc.position).setY(64)
    crater.scale.y = 0.35
    updaters.push((t) => crater.scale.set(1 + Math.sin(t * 2) * 0.05, 0.35, 1 + Math.sin(t * 2) * 0.05))
  }

  // ── cząstki wokół gracza: zarodniki / śnieg / żar ────────
  const PCOUNT = biome === 'arctic' ? 900 : 360
  const parr = new Float32Array(PCOUNT * 3)
  for (let k = 0; k < PCOUNT; k++) parr.set([(rng() - 0.5) * 40, rng() * 16, (rng() - 0.5) * 40], k * 3)
  const pgeo = T(new THREE.BufferGeometry())
  pgeo.setAttribute('position', new THREE.BufferAttribute(parr, 3))
  const pmat = T(
    new THREE.PointsMaterial({
      color: biome === 'forest' ? 0x9ff4ff : biome === 'arctic' ? 0xffffff : 0xff8a3a,
      size: biome === 'arctic' ? 0.09 : 0.07,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: biome === 'arctic' ? THREE.NormalBlending : THREE.AdditiveBlending,
    }),
  )
  const parts = add(new THREE.Points(pgeo, pmat))
  const fall = biome === 'arctic' ? -1.6 : biome === 'volcano' ? 1.1 : 0.15
  updaters.push((t, dt, player) => {
    parts.position.set(player.x, 0, player.z)
    const a = pgeo.getAttribute('position') as THREE.BufferAttribute
    for (let k = 0; k < PCOUNT; k++) {
      let y = a.getY(k) + (fall + Math.sin(t + k) * 0.2) * dt
      if (y < 0) y = 16
      if (y > 16) y = 0
      a.setXYZ(k, a.getX(k) + Math.sin(t * 0.4 + k) * dt * (biome === 'arctic' ? 0.8 : 0.3), y, a.getZ(k) + Math.cos(t * 0.3 + k) * dt * 0.3)
    }
    a.needsUpdate = true
    if (biome === 'forest') pmat.opacity = 0.55 + Math.sin(t * 2) * 0.25
  })

  return {
    update(time, dt, player, camera) {
      for (const u of updaters) u(time, dt, player, camera)
    },
  }
}
