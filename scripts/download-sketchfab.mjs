#!/usr/bin/env node
// Pobiera modele 3D agentów ZZZ z kolekcji Sketchfab do public/models/agents/<Nazwa z rosteru>/
// i (prze)pisuje public/models/manifest.json na podstawie tego, co leży na dysku.
// Użycie: SKETCHFAB_API_TOKEN=xxx node scripts/download-sketchfab.mjs [--dry-run]
//   Token: zaloguj się na sketchfab.com → https://sketchfab.com/settings/password → "API token".
//   Bez tokenu skrypt tylko wypisuje dopasowania (kolekcja ↔ roster) i kończy działanie.
// Już pobrane foldery są pomijane, więc można odpalać ponownie.
// Wymaga Node 20+ (globalny fetch) i systemowego `unzip`.

import { mkdir, writeFile, readFile, readdir, rm, rename, stat, mkdtemp, cp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const COLLECTION = '2b539bf05197473e86d4ca96c73eb6a2'
const API = 'https://api.sketchfab.com/v3'
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const ROSTER_DIRS = ['S', 'A'].map((r) => path.join(ROOT, 'public/agents', `${r}-rank`))
const MODELS_DIR = path.join(ROOT, 'public/models')
const AGENTS_DIR = path.join(MODELS_DIR, 'agents')
const TOKEN = process.env.SKETCHFAB_API_TOKEN
const DRY = process.argv.includes('--dry-run')

// Ręczne aliasy: znormalizowana fraza z nazwy modelu → nazwa z rosteru
const ALIASES = {
  'soldier cero': 'Soldier 0 - Anby',
  'solder 0': 'Soldier 0 - Anby',
  'soldier 0': 'Soldier 0 - Anby',
  'qing yi': 'Qingyi',
  'yi xuan': 'Yixuan',
  'hoshimi': 'Hoshimi Miyabi',
  'miyabi': 'Hoshimi Miyabi',
  'nekomiya': 'Nekomiya Mana',
  'lucy': 'Luciana de Montefio',
}

// Modele spoza kolekcji (wyszukane ręcznie na Sketchfabie) — nazwa z rosteru → UID.
// Używane tylko dla agentów, których kolekcja nie pokrywa.
// Nadpisania: modele z kolekcji, które są wadliwe — te UID-y wygrywają z dopasowaniem z kolekcji.
//  Alice Thymefield — „Alice 2 zzz” nie ma szkieletu (statyczna T-poza)
//  Soldier 11 — „Soldier 11 ZZZ” to w środku model Soldier 0 - Anby
const OVERRIDE_MODELS = {
  'Alice Thymefield': '9384c55c95ef4e37a5afb705e3db9d54',
  'Soldier 11': '51f013bf3b694bd8b2cf3dc838ecdbd8',
}

const EXTRA_MODELS = {
  Aria: '131bff1cd85644bfbd6591f41efbc070',
  Banyue: 'c18b842685f643b59a41dc5eedd79a5e',
  Cissia: '11da8d5638e94c16a6af9993bcd1ac5a',
  Promeia: '736dde71fd4f4dd08d3869ad9d1daca6',
  'Remielle Dan': '98eca8b8a6224a9f811cc72f430d7f7d',
  'Roxy Ifrita Pryce': '94c8b86d4ed94a27975be77a920491cc',
  'Starlight - Billy Kid': 'b12c349d4b344b4c857e63e05fa3c69b',
  Sunbringer: 'a8c41ff635a44c53acfd77c7db3433a1',
  Sunna: '77a2fc96d3d14f46b229278f07cda4c2',
  'Ukinami Yuzuha': '0420e6f4731e4cf8a18042ea5ca50dcb',
  Zhao: '022ef98d0fca4f87b41a9200ddb875f4',
}

// Słowa w nazwie modelu, które obniżają priorytet (skórki, bety, stare wersje…)
const PENALTY = /\b(beta|old|outfit|skin|swim|unused|oc|cofe|imagetostl|fbx|prisma3d|blender|release)\b/

// Normalizacja: małe litery, bez diakrytyków, bez "zzz"/"zenless zone zero"/"by autor"
function norm(s) {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/zenless zone zero/g, ' ')
    .replace(/\bby\s+\S+/g, ' ')
    .replace(/\bzzz\b/g, ' ')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function getJson(url, headers = {}, tries = 3) {
  const res = await fetch(url, { headers })
  // API Sketchfab czasem zwraca 5xx — ponawiamy
  if (res.status >= 500 && tries > 1) {
    await new Promise((r) => setTimeout(r, 1500))
    return getJson(url, headers, tries - 1)
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} dla ${url}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

async function listCollection() {
  const out = []
  let url = `${API}/collections/${COLLECTION}/models`
  while (url) {
    const j = await getJson(url)
    out.push(...j.results)
    url = j.next
  }
  return out
}

async function listRoster() {
  const names = []
  for (const dir of ROSTER_DIRS) {
    if (!existsSync(dir)) continue
    for (const f of await readdir(dir)) if (f.toLowerCase().endsWith('.png')) names.push(f.replace(/\.png$/i, ''))
  }
  return names
}

/** Zwraca nazwę z rosteru pasującą do nazwy modelu albo null. */
function makeMatcher(roster) {
  const full = roster.map((r) => ({ r, n: norm(r) }))
  // tokeny unikalne dla jednej postaci (np. "miyabi", "lycaon"), bez wspólnych typu "lowell", "anby"
  const tokenOwners = new Map()
  for (const { r, n } of full)
    for (const t of n.split(' ')) if (t.length >= 4) tokenOwners.set(t, tokenOwners.has(t) && tokenOwners.get(t) !== r ? null : r)
  return (modelName) => {
    const m = norm(modelName)
    const padded = ` ${m} `
    for (const [a, r] of Object.entries(ALIASES)) if (padded.includes(` ${a} `) && roster.includes(r)) return r
    // najdłuższe pełne dopasowanie nazwy (żeby "Starlight - Billy Kid" nie przegrało z "Billy Kid")
    const hits = full.filter(({ n }) => padded.includes(` ${n} `)).sort((a, b) => b.n.length - a.n.length)
    if (hits.length) return hits[0].r
    const owners = new Set(m.split(' ').map((t) => tokenOwners.get(t)).filter(Boolean))
    return owners.size === 1 ? [...owners][0] : null
  }
}

/** Ocena kandydata — im wyżej, tym lepszy model dla danej postaci. */
function score(m) {
  let s = 0
  if (m.isDownloadable) s += 100
  if (m.license?.label === 'CC Attribution') s += 20
  if (m.user?.username === 'ansaldotoys2') s += 10 // spójny styl całej serii
  if (/\(new\)/i.test(m.name)) s += 5
  if (PENALTY.test(norm(m.name)) || /\(old\)|\(beta\)/i.test(m.name)) s -= 30
  return s
}

async function dirSize(dir) {
  let total = 0
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    total += e.isDirectory() ? await dirSize(p) : (await stat(p)).size
  }
  return total
}

/** Szuka pliku .gltf/.glb w katalogu (rekurencyjnie). */
async function findModelFile(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      const f = await findModelFile(p)
      if (f) return f
    } else if (/\.(gltf|glb)$/i.test(e.name)) return p
  }
  return null
}

const KEEP = ['*.gltf', '*.glb', '*.bin', '*.png', '*.jpg', '*.jpeg', '*.webp', '*.ktx2']

async function download(name, m) {
  const dest = path.join(AGENTS_DIR, name)
  if (existsSync(dest)) {
    // .uid = z którego modelu Sketchfab pochodzi folder; inny wybór (np. nadpisanie) → pobieramy od nowa
    const marker = path.join(dest, '.uid')
    const have = existsSync(marker) ? (await readFile(marker, 'utf8')).trim() : OVERRIDE_MODELS[name] ? 'stary' : m.uid
    if (have === m.uid) return console.log(`  ⏭  ${name} — już jest`)
    console.log(`  ↻ ${name} — zmiana modelu, pobieram ponownie`)
    await rm(dest, { recursive: true, force: true })
  }
  const info = await getJson(`${API}/models/${m.uid}/download`, { Authorization: `Token ${TOKEN}` })
  const url = info.gltf?.url
  if (!url) return console.log(`  ✗ ${name} — brak wersji glTF do pobrania`)
  // świeży katalog tymczasowy na każde archiwum; niczego z niego nie uruchamiamy
  const tmp = await mkdtemp(path.join(process.env.SKETCHFAB_TMP ?? os.tmpdir(), 'sketchfab-'))
  try {
    const zip = path.join(tmp, 'model.zip')
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status} przy pobieraniu archiwum`)
    await writeFile(zip, Buffer.from(await res.arrayBuffer()))
    const out = path.join(tmp, 'out')
    await mkdir(out)
    // rozpakowujemy tylko geometrię i tekstury
    // kod 11 = część wzorców (np. *.glb, *.jpg) nie pasuje do niczego w archiwum — to nie błąd
    try {
      execFileSync('unzip', ['-qq', '-o', zip, ...KEEP, '-d', out], { stdio: ['ignore', 'inherit', 'ignore'] })
    } catch (e) {
      if (e.status !== 11) throw e
    }
    const file = await findModelFile(out)
    if (!file) throw new Error('w archiwum nie ma .gltf/.glb')
    await mkdir(AGENTS_DIR, { recursive: true })
    const src = path.dirname(file)
    try {
      await rename(src, dest)
    } catch {
      await cp(src, dest, { recursive: true })
    }
    await writeFile(path.join(dest, '.uid'), m.uid + '\n')
    console.log(`  ✓ ${name} (${(await dirSize(dest) / 1e6).toFixed(1)} MB)`)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

/** Manifest budowany wyłącznie z tego, co faktycznie leży na dysku. */
async function writeManifest(chosen) {
  const manifest = {}
  if (existsSync(AGENTS_DIR)) {
    for (const e of await readdir(AGENTS_DIR, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const dir = path.join(AGENTS_DIR, e.name)
      const file = await findModelFile(dir)
      if (!file) continue
      const rel = path.relative(MODELS_DIR, file).split(path.sep).map(encodeURIComponent).join('/')
      const m = chosen.get(e.name)
      manifest[e.name] = {
        url: `/models/${rel}`,
        source: m?.viewerUrl ?? null,
        author: m?.user?.username ?? null,
        license: m?.license?.label ?? null,
      }
    }
  }
  await mkdir(MODELS_DIR, { recursive: true })
  await writeFile(path.join(MODELS_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log(`manifest.json: ${Object.keys(manifest).length} modeli`)
}

const [models, roster] = await Promise.all([listCollection(), listRoster()])
const match = makeMatcher(roster)
const candidates = new Map()
for (const m of models) {
  const r = match(m.name)
  if (!r) continue
  if (!candidates.has(r)) candidates.set(r, [])
  candidates.get(r).push(m)
}
const chosen = new Map()
for (const [r, list] of candidates) chosen.set(r, list.sort((a, b) => score(b) - score(a))[0])
for (const [r, uid] of [...Object.entries(OVERRIDE_MODELS), ...Object.entries(EXTRA_MODELS)]) {
  if (!roster.includes(r) || (chosen.has(r) && !(r in OVERRIDE_MODELS)) || chosen.get(r)?.uid === uid) continue
  try {
    chosen.set(r, await getJson(`${API}/models/${uid}`))
  } catch (e) {
    console.log(`  ✗ ${r} — nie udało się pobrać info o modelu ${uid}: ${e.message}`)
  }
}

console.log(`Kolekcja: ${models.length} modeli, roster: ${roster.length} agentów, dopasowane: ${chosen.size}`)
for (const r of [...chosen.keys()].sort()) {
  const m = chosen.get(r)
  console.log(`  ${r} ← "${m.name}" [${m.uid}] ${m.isDownloadable ? 'do pobrania' : 'NIE do pobrania'}, ${m.license?.label ?? '?'}, @${m.user?.username}`)
}
const missing = roster.filter((r) => !chosen.has(r))
console.log(`Bez modelu (${missing.length}): ${missing.join(', ')}`)

if (!TOKEN || DRY) {
  if (!TOKEN)
    console.log(
      '\nBrak SKETCHFAB_API_TOKEN — nic nie pobieram.\n' +
        'Token weźmiesz po zalogowaniu z https://sketchfab.com/settings/password (sekcja "API token"), potem:\n' +
        '  SKETCHFAB_API_TOKEN=twój_token node scripts/download-sketchfab.mjs',
    )
  await writeManifest(chosen)
  process.exit(TOKEN ? 0 : 1)
}

for (const [r, m] of [...chosen].sort()) {
  if (!m.isDownloadable) continue
  try {
    await download(r, m)
  } catch (e) {
    console.log(`  ✗ ${r} — ${e.message}`)
  }
}
await writeManifest(chosen)
