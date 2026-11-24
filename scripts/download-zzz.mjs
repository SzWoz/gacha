#!/usr/bin/env node
// Pobiera obrazki z Zenless Zone Zero fandom wiki, wszystkie rangi:
//   zzz-cards/agents/{S,A}-rank/      — portrety agentów
//   zzz-cards/w-engines/{S,A,B}-rank/ — W-Engines
//   zzz-cards/bangboo/{S,A}-rank/     — bojowe Bangboo
// Użycie: node scripts/download-zzz.mjs [katalog_docelowy] [typ...]
//   np.   node scripts/download-zzz.mjs zzz-cards w-engines bangboo
// Już pobrane pliki są pomijane, więc można odpalać ponownie po nowych patchach.

import { mkdir, writeFile, access } from 'node:fs/promises'
import path from 'node:path'

const API = 'https://zenless-zone-zero.fandom.com/api.php'
const UA = 'signal-gacha-downloader/1.0'
const RANKS = ['S', 'A', 'B']

/**
 * Typy zasobów.
 * category(rank) — kategoria wiki z listą stron danej rangi
 * file(title)    — nazwa pliku z obrazkiem; null = główny obrazek strony (pageimages)
 */
const TYPES = {
  agents: {
    category: (r) => `Category:${r}-Rank Agents`,
    file: (t) => `File:Agent ${t} Portrait.png`,
  },
  'w-engines': {
    category: (r) => `Category:${r}-Rank W-Engines`,
    file: null,
  },
  bangboo: {
    category: (r) => `Category:${r}-Rank Combat Bangboo`,
    file: null,
  },
}

const [outArg, ...typeArgs] = process.argv.slice(2)
const OUT = path.resolve(outArg ?? 'zzz-cards')
const selected = typeArgs.length ? typeArgs : Object.keys(TYPES)
for (const t of selected) if (!TYPES[t]) throw new Error(`Nieznany typ "${t}". Dostępne: ${Object.keys(TYPES).join(', ')}`)

async function api(params) {
  const url = `${API}?${new URLSearchParams({ format: 'json', ...params })}`
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`API ${res.status}: ${url}`)
  return res.json()
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n))
const exists = (p) => access(p).then(() => true, () => false)
const safe = (s) => s.replace(/[\\/:*?"<>|]/g, '_')

async function categoryMembers(cmtitle) {
  const out = []
  let cont = {}
  while (cont) {
    const d = await api({ action: 'query', list: 'categorymembers', cmtitle, cmlimit: '500', cmnamespace: '0', ...cont })
    out.push(...(d.query?.categorymembers ?? []).map((m) => m.title))
    cont = d.continue ?? null
  }
  return out
}

/** Zwraca { tytułStrony: urlObrazka } */
async function imageUrls(titles, file) {
  const urls = {}
  for (const group of chunk(titles, 50)) {
    if (file) {
      const d = await api({ action: 'query', titles: group.map(file).join('|'), prop: 'imageinfo', iiprop: 'url' })
      const back = Object.fromEntries(group.map((t) => [file(t), t]))
      const norm = Object.fromEntries((d.query.normalized ?? []).map((n) => [n.to, n.from]))
      for (const p of Object.values(d.query.pages)) {
        const url = p.imageinfo?.[0]?.url
        if (url) urls[back[norm[p.title] ?? p.title]] = url
      }
    } else {
      const d = await api({ action: 'query', titles: group.join('|'), prop: 'pageimages', piprop: 'original' })
      const norm = Object.fromEntries((d.query.normalized ?? []).map((n) => [n.to, n.from]))
      for (const p of Object.values(d.query.pages)) {
        const url = p.original?.source
        if (url) urls[norm[p.title] ?? p.title] = url
      }
    }
  }
  return urls
}

const total = { ok: 0, skipped: 0, missing: [] }

for (const type of selected) {
  const cfg = TYPES[type]
  console.log(`\n── ${type} ──`)
  for (const rank of RANKS) {
    const titles = await categoryMembers(cfg.category(rank))
    if (!titles.length) continue
    const urls = await imageUrls(titles, cfg.file)
    const dir = path.join(OUT, type, `${rank}-rank`)
    let ok = 0
    for (const title of titles) {
      const url = urls[title]
      if (!url) { total.missing.push(`${type}/${rank}: ${title}`); continue }
      const ext = (new URL(url).pathname.match(/\.(png|jpe?g|webp|gif)(?=\/|$)/i)?.[1] ?? 'png').toLowerCase()
      const file = path.join(dir, `${safe(title)}.${ext}`)
      if (await exists(file)) { total.skipped++; continue }
      await mkdir(dir, { recursive: true })
      const res = await fetch(url, { headers: { 'User-Agent': UA } })
      if (!res.ok) { total.missing.push(`${type}/${rank}: ${title} (HTTP ${res.status})`); continue }
      await writeFile(file, Buffer.from(await res.arrayBuffer()))
      ok++
      total.ok++
    }
    console.log(`${rank}-rank: ${titles.length} na wiki, pobrano ${ok}`)
  }
}

console.log(`\nPobrano: ${total.ok}, pominięto (już były): ${total.skipped}, brak obrazka: ${total.missing.length}`)
if (total.missing.length) console.log('  ' + total.missing.join('\n  '))
console.log(`Folder: ${OUT}`)
