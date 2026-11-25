/** Pełny ekran + blokada orientacji poziomej (Android Chrome). Musi być wywołane z gestu użytkownika. */
export async function enterLandscape() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })
    await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape')
  } catch {
    /* brak wsparcia (np. iOS Safari) — zostaje plansza „obróć telefon” */
  }
}

export const portraitQuery = () => window.matchMedia('(orientation: portrait)')

export const isTouch = () => typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window)
