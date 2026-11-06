import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export function releaseVersion(base, run) {
  if (!/^\d+\.\d+\.0$/.test(base) || !/^[1-9]\d*$/.test(String(run)) || Number(run) > 65535) throw Error('Invalid release version')
  return base.replace(/\.0$/, '.' + run)
}
export function readyManifest(manifest, version) {
  if (manifest.version !== version) throw Error('Manifest version differs from the built release')
  const platform = manifest.platforms?.['windows-x86_64']
  const prefix = `https://github.com/TurtleClient/turtleclient-launcher/releases/download/v${version}/`
  if (!platform || !platform.url?.startsWith(prefix) || !platform.url.endsWith('.exe') || !platform.signature?.trim()) throw Error('Missing signed TurtleClient Windows installer')
  const signature = Buffer.from(platform.signature, 'base64').toString('utf8')
  if (!signature.startsWith('untrusted comment:') || !signature.includes('trusted comment:')) throw Error('Invalid updater signature format')
  return { ...manifest, critical: true }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === 'prepare') {
    const file = 'src-tauri/tauri.conf.json'
    const config = JSON.parse(readFileSync(file, 'utf8'))
    const version = releaseVersion(config.version, process.env.GITHUB_RUN_NUMBER)
    config.version = version
    writeFileSync(file, JSON.stringify(config, null, 2) + '\n')
    appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`)
  } else if (process.argv[2] === 'manifest') {
    const file = process.argv[3]
    writeFileSync(file, JSON.stringify(readyManifest(JSON.parse(readFileSync(file, 'utf8')), process.env.RELEASE_VERSION), null, 2) + '\n')
  } else throw Error('Expected prepare or manifest')
}
