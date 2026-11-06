import { expect, test } from 'bun:test'
import { readyManifest, releaseVersion } from './turtle-release.mjs'
test('release versions increase and fit Windows installer fields', () => {
  expect(releaseVersion('2.3.0', '42')).toBe('2.3.42')
  expect(() => releaseVersion('2.3.0', '65536')).toThrow()
})
test('publication refuses incomplete, foreign or mismatched update manifests', () => {
  const manifest = { version: '2.3.1', platforms: { 'windows-x86_64': { url: 'https://github.com/TurtleClient/turtleclient-launcher/releases/download/v2.3.1/launcher.exe', signature: Buffer.from('untrusted comment: fixture\nkey\ntrusted comment: fixture\nsig').toString('base64') } } }
  expect(readyManifest(manifest, '2.3.1').critical).toBe(true)
  expect(() => readyManifest(manifest, '2.3.2')).toThrow()
  expect(() => readyManifest({ ...manifest, platforms: {} }, '2.3.1')).toThrow()
  expect(() => readyManifest({ ...manifest, platforms: { 'windows-x86_64': { ...manifest.platforms['windows-x86_64'], url: 'https://example.org/launcher.exe' } } }, '2.3.1')).toThrow()
})
