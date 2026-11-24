import react from '@vitejs/plugin-react'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'

const PUBLIC_DIR = path.resolve(__dirname, 'public')
const PORTRAIT_DIRS = ['agents', 'w-engines', 'bangboo'] as const
const IMAGE_RE = /\.(png|webp|jpe?g)$/i
const VIRTUAL_ID = 'virtual:portraits'
const RESOLVED_ID = '\0' + VIRTUAL_ID

/** Scans public/<type>/<rank>-rank/ → { [type]: { [rank]: fileName[] } } */
function scanPortraits() {
  const out: Record<string, Record<string, string[]>> = {}
  for (const type of PORTRAIT_DIRS) {
    out[type] = {}
    let rankDirs: string[] = []
    try {
      rankDirs = readdirSync(path.join(PUBLIC_DIR, type))
    } catch {
      continue
    }
    for (const dir of rankDirs) {
      const m = /^([SAB])-rank$/.exec(dir)
      if (!m) continue
      out[type][m[1]] = readdirSync(path.join(PUBLIC_DIR, type, dir))
        .filter((f) => IMAGE_RE.test(f))
        .sort((a, b) => a.localeCompare(b))
    }
  }
  return out
}

/** Exposes the files in public/ as `virtual:portraits`, reloading on changes in dev. */
function portraits(): Plugin {
  return {
    name: 'public-portraits',
    resolveId: (id) => (id === VIRTUAL_ID ? RESOLVED_ID : undefined),
    load: (id) => (id === RESOLVED_ID ? `export default ${JSON.stringify(scanPortraits())}` : undefined),
    configureServer(server) {
      const onChange = (file: string) => {
        if (!file.startsWith(PUBLIC_DIR) || !PORTRAIT_DIRS.some((d) => file.startsWith(path.join(PUBLIC_DIR, d)))) return
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID)
        if (mod) server.moduleGraph.invalidateModule(mod)
        server.ws.send({ type: 'full-reload' })
      }
      server.watcher.add(PUBLIC_DIR)
      server.watcher.on('add', onChange)
      server.watcher.on('unlink', onChange)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), portraits()],
})
