import { afterEach, expect, it, vi } from 'vitest'
import { autoLang, effectiveLang } from './default-lang.js'
afterEach(() => vi.unstubAllEnvs())
it('FitPilot defaults new profiles to Chinese, preserving explicit language choices', () => {
  vi.stubEnv('VITE_DEFAULT_LANG', 'zh')
  expect(autoLang({ langAuto: true }, {}, ['en-US'])).toBe('zh')
  expect(effectiveLang({ lang: 'de', langAuto: false }, {})).toBe('de')
  expect(autoLang({ langAuto: true }, { default_lang: 'fr' }, ['en-US'])).toBe('fr')
})
it('FitPilot serves its own placeholder instead of third-party media', async () => {
  vi.stubEnv('VITE_CATALOGUE_MEDIA', 'off')
  const { imgSrc, gifSrc } = await import('./exercises.js')
  const ex = { img: '0025.webp', gif: '0025.mp4', fv: '9025' }
  expect(imgSrc(ex, 'female')).toBe('fitpilot-exercise.svg')
  expect(gifSrc(ex, 'male')).toBe('fitpilot-exercise.svg')
})
