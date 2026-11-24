# Signal Search — gacha simulator

React + Vite + Three.js, bez backendu. Stan (waluta, pity, kolekcja, historia) w `localStorage`.

```bash
npm install
npm run dev
```

## Mechanika
- S-rank: 0.6% bazowo, soft pity od 74 (+6%/pull), hard pity 90
- A-rank: 9.4%, gwarantowany co 10 pulli
- Banery limitowane: 50/50 na featured S (przegrana → gwarancja), 50/50 na featured A
- Pity współdzielone między banerami limitowanymi, osobne dla standardowego

## Własne postacie
Edytuj `src/data/roster.ts` (postacie + banery). Obrazki wrzuć do `public/agents/`
jako `<id>.png` / `.webp` / `.jpg` (np. `public/agents/vex.png`) — podpinają się same.
Możesz też ustawić `image: '/agents/plik.png'` ręcznie. Bez obrazka generuje się proceduralny portret.
