// Rasterize original, code-native TurtleClient artwork for the existing asset slots.
// Source vectors are editable in public/; no upstream artwork is used as input.
import { readdir, readFile, writeFile, rename, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'

const icon = await readFile('public/turtleclient-icon.svg')
const background = await readFile('public/turtleclient-background.svg')
async function save(path, data) {
  const temporary = path + '.turtleclient-tmp'
  await writeFile(temporary, data)
  await rename(temporary, path)
}
async function files(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await files(path))
    else out.push(path)
  }
  return out
}
for (const dir of ['public/bg', 'public/capes', 'public/app-icons']) {
  for (const path of await files(dir)) {
    if (!/\.(png|jpe?g|webp)$/i.test(path)) continue
    const { width, height } = await sharp(await readFile(path)).metadata()
    const art = dir.endsWith('/bg') ? background : icon
    let image = sharp(art).resize(width, height, { fit: 'contain', background: '#101f18' })
    image = /\.webp$/i.test(path) ? image.webp() : /\.jpe?g$/i.test(path) ? image.jpeg() : image.png()
    await save(path, await image.toBuffer())
  }
}
for (const path of await files('src-tauri/icons/alt')) {
  if (path.endsWith('.ico')) await copyFile('src-tauri/icons/icon.ico', path)
  else if (path.endsWith('.icns')) await copyFile('src-tauri/icons/icon.icns', path)
  else if (path.endsWith('.png')) {
    const { width, height } = await sharp(await readFile(path)).metadata()
    await save(path, await sharp(icon).resize(width, height).png().toBuffer())
  }
}
await save('public/hero-11.png', await sharp(background).png().toBuffer())
console.log('Replaced launch icons, wallpaper, cape and hero artwork with TurtleClient vectors.')
