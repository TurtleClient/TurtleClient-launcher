import { expect, test } from 'bun:test'

const preferences = new Map([
  ['m-mus-auto', '1'], ['m-mus-play', '1'], ['m-mus-muted', '0'],
  ['m-sound-mode', 'all'], ['m-sound-vol', '100'],
])
let devicesOpened = 0
class ForbiddenAudio {
  constructor() { devicesOpened++ }
}
Object.defineProperty(globalThis, '__HAS_BUNDLED_MUSIC__', { value: true, configurable: true })
Object.defineProperty(globalThis, 'Audio', { value: ForbiddenAudio, configurable: true })
Object.defineProperty(globalThis, 'window', {
  value: { AudioContext: ForbiddenAudio, addEventListener() {}, removeEventListener() {} }, configurable: true,
})
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => preferences.get(key) ?? null,
    setItem: (key: string, value: string) => preferences.set(key, value),
    removeItem: (key: string) => preferences.delete(key),
  }, configurable: true,
})

const music = await import('./music')
const sound = await import('../lib/sound')
const { sharedAudio } = await import('../lib/audioHub')

test('old autoplay preferences cannot start music or initialize audio on login', () => {
  music.initMusic()
  music.startMusicAfterLogin()
  expect(music.useMusic.getState().playing).toBe(false)
  expect(devicesOpened).toBe(0)
})

test('legacy player actions and notification sounds cannot open an output device', () => {
  music.useMusic.setState({ tracks: [{ src: '/legacy.mp3', title: 'legacy' }] })
  music.useMusic.getState().togglePlay()
  sound.initSounds()
  sound.playSound('notify')
  sound.playSample('success')
  expect(sharedAudio.context()).toBeNull()
  expect(devicesOpened).toBe(0)
})
