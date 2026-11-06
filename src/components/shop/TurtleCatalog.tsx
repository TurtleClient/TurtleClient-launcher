import { useEffect, useRef, useState } from 'react'
import { useT, getLocale } from '../../i18n'
import { TURTLE_API, serviceError, turtle } from '../../lib/turtleclient'
import type { Catalog, Cosmetic } from '../../lib/turtleclient'
import { ItemGrid, ItemTile } from '../character/ItemTile'
import { Icon } from '../Icon'
import '../../styles/pixel/shop2.css'
import '../../styles/pixel/character.css'
import { normalizeTurtleCatalog } from '../../state/turtleWardrobe'
import { turtlePrice } from '../../lib/turtlePrice'
import { setScreen } from '../../state/ui'

type Cube = { origin: number[]; size: number[]; uv?: number[] }
type Model = { texture: { png: string }; parts: { cubes?: Cube[] }[]; tag?: { line?: string; animation?: { colors?: string[] } } }
export function ModelArt({ item }: { item: Cosmetic }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    let dispose = () => {}
    void turtle<Model>('turtle_model', { id: item.id, hash: item.hash }).then(async model => {
      if (!live || !canvas.current) return
      if (item.slot === 'name_tag') {
        const ctx = canvas.current.getContext('2d')
        if (!ctx) throw new Error('canvas unavailable')
        const colors = (model.tag?.animation?.colors || [model.tag?.line || '#ffffff']).filter(color => /^#[0-9a-f]{6}$/i.test(color)).slice(0, 16)
        const gradient = ctx.createLinearGradient(10, 0, 150, 0)
        colors.forEach((color, i) => gradient.addColorStop(colors.length > 1 ? i/(colors.length-1) : 0, color))
        ctx.clearRect(0, 0, 160, 140); ctx.font = 'bold 18px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.lineWidth = 4; ctx.strokeStyle = '#121212'; ctx.strokeText('TurtleClient', 80, 70)
        ctx.fillStyle = colors.length ? gradient : '#ffffff'; ctx.fillText('TurtleClient', 80, 70)
        return
      }
      const T = await import('three')
      if (!live || !canvas.current) return
      const renderer = new T.WebGLRenderer({ canvas: canvas.current, alpha: true, antialias: true })
      const geometry: import('three').BoxGeometry[] = []
      let material: import('three').MeshStandardMaterial | undefined
      let texture: import('three').Texture | undefined
      dispose = () => {renderer.dispose(); geometry.forEach(g => g.dispose()); material?.dispose(); texture?.dispose()}
      renderer.setSize(160, 140); renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
      const scene = new T.Scene()
      const group = new T.Group(); scene.add(group)
      scene.add(new T.AmbientLight(0xffffff, 2))
      const light = new T.DirectionalLight(0xffffff, 3); light.position.set(10, 20, 25); scene.add(light)
      texture = await new T.TextureLoader().loadAsync('data:image/png;base64,' + model.texture.png)
      if (!live) {dispose(); return}
      texture.magFilter = T.NearestFilter; texture.minFilter = T.NearestFilter; texture.colorSpace = T.SRGBColorSpace
      material = new T.MeshStandardMaterial({ map: texture, roughness: 1, transparent: true, alphaTest: .1 })
      const image = texture.image as HTMLImageElement
      for (const cube of model.parts.slice(0, 64).flatMap(p => p.cubes || []).slice(0, 256)) {
        if (![...cube.origin, ...cube.size].every(Number.isFinite) || cube.origin.length !== 3 || cube.size.length !== 3) continue
        const [w, h, d] = cube.size
        if (w <= 0 || h <= 0 || d <= 0 || Math.max(w, h, d) > 128) continue
        const g = new T.BoxGeometry(w, h, d); geometry.push(g)
        const [u, v] = cube.uv || [0, 0]
        // Box UV layout shared by the Turtle model format and Minecraft cubes.
        const faces = [[u+d+w, v+d, d, h], [u, v+d, d, h], [u+d, v, w, d], [u+d+w, v, w, d], [u+d, v+d, w, h], [u+2*d+w, v+d, w, h]]
        const uv = g.getAttribute('uv')
        faces.forEach(([x,y,width,height], face) => {
          for (let i=0; i<4; i++) uv.setXY(face*4+i, (x+(i%2)*width)/image.width, 1-(y+(i>=2?height:0))/image.height)
        })
        const mesh = new T.Mesh(g, material)
        mesh.position.set(cube.origin[0]+w/2, -(cube.origin[1]+h/2), cube.origin[2]+d/2)
        group.add(mesh)
      }
      const box = new T.Box3().setFromObject(group)
      if (box.isEmpty()) throw new Error('empty model')
      const center = box.getCenter(new T.Vector3()); const size = box.getSize(new T.Vector3())
      const radius = Math.max(size.length()/2, 1)
      const camera = new T.PerspectiveCamera(35, 160/140, .1, radius*20)
      camera.position.copy(center).add(new T.Vector3(1, .5, 1.8).normalize().multiplyScalar(radius*3.7)); camera.lookAt(center)
      renderer.render(scene, camera)
    }).catch(() => {dispose(); if (live) setFailed(true)})
    return () => {live = false; dispose()}
  }, [item.id, item.hash, item.slot])
  return failed ? <Icon id="i-star" /> : <canvas ref={canvas} width={160} height={140} aria-hidden="true" />
}

/** Catalog data changes; the existing shop blocks, item grid and tiles stay. */
export function TurtleCatalog() {
  const t = useT()
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  async function load() {
    setLoading(true); setError('')
    try {setCatalog(normalizeTurtleCatalog(await turtle<Catalog>('turtle_catalog')))}
    catch (e) {setError(serviceError(e))}
    finally {setLoading(false)}
  }
  useEffect(() => {void load()}, [])
  const details = () => setScreen('skins')
  const status = (item:Cosmetic) => item.access==='paid' ? turtlePrice(item,getLocale()) || t('Turtle: shop item') : t('Turtle: free')
  return <div className="sh-feed">
    <div className="card sh-block"><div className="sh-head"><h2>{t('Turtle: community collection')}</h2><button className="btn sm secondary" disabled={loading} onClick={() => void load()}>{t('Turtle: refresh')}</button></div><p className="faint-note">{t('Turtle: browse the server collection. Equip unlocked items in your wardrobe.')}</p>{error && <p role="alert" className="faint-note">{t(error)}</p>}</div>
    {loading && !catalog && <p className="faint-note" role="status">{t('Turtle: loading catalog…')}</p>}
    <div className="card sh-block"><div className="sh-head"><h2>{t('Turtle: cosmetics')}</h2></div><ItemGrid>{catalog?.models.map(item => <ItemTile key={item.id} itemId={item.id} name={item.name} art={<ModelArt item={item} />} status={status(item)} onClick={details} />)}</ItemGrid>{catalog && !catalog.models.length && <p className="faint-note">{t('Turtle: no items yet.')}</p>}</div>
    <div className="card sh-block"><div className="sh-head"><h2>{t('Turtle: capes')}</h2></div><ItemGrid>{catalog?.capes.map(item => <ItemTile key={item.id} itemId={item.id} name={item.name} art={<img src={`${TURTLE_API}/api/cape/${encodeURIComponent(item.owner)}`} alt="" loading="lazy" width={128} height={128} style={{ objectFit: 'contain', imageRendering: 'pixelated' }} />} status={status(item)} onClick={details} />)}</ItemGrid>{catalog && !catalog.capes.length && <p className="faint-note">{t('Turtle: no items yet.')}</p>}</div>
  </div>
}
