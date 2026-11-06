import { create } from 'zustand'
import { turtle } from '../lib/turtleclient'
import type { Catalog, Cosmetic, WardrobeSnapshot } from '../lib/turtleclient'
import type { TurtleModel } from '../lib/turtleModelTypes'
import { normalizeTurtleCatalog } from '../lib/turtleWardrobeRules'
export { normalizeTurtleCatalog, categoryOf } from '../lib/turtleWardrobeRules'

interface WardrobeState { accountId: string | null; snapshot: WardrobeSnapshot | null; catalog: Catalog | null; models: Record<string, TurtleModel>; busy: string | null; error: string }
export const useTurtleWardrobe = create<WardrobeState>(() => ({ accountId: null, snapshot: null, catalog: null, models: {}, busy: null, error: '' }))
const cache = new Map<string, Promise<TurtleModel>>()
export function turtleModel(item: Cosmetic): Promise<TurtleModel> {
  const key = item.id + ':' + item.hash
  let pending = cache.get(key)
  if (!pending) {
    pending = turtle<TurtleModel>('turtle_model', { id: item.id, hash: item.hash }).catch(error => {cache.delete(key); throw error})
    cache.set(key, pending)
    while (cache.size > 64) cache.delete(cache.keys().next().value!)
  }
  return pending
}
let generation = 0
let timer: ReturnType<typeof setInterval> | undefined
let pending: Promise<void> | null = null
let revision = ''
export function syncWardrobeAccount(accountId: string | null, connected: boolean) {
  if (useTurtleWardrobe.getState().accountId !== accountId) {
    generation++; clearInterval(timer); timer = undefined; pending = null; revision = ''
    useTurtleWardrobe.setState({ accountId, snapshot: null, models: {}, busy: null, error: '' })
  }
  if (accountId && connected && !timer) {
    void refreshTurtleWardrobe()
    timer = setInterval(() => void refreshTurtleWardrobe(), 15000)
  }
}
export async function loadWardrobeCatalog() {
  try {useTurtleWardrobe.setState({ catalog: normalizeTurtleCatalog(await turtle<Catalog>('turtle_catalog')) })}
  catch (error) {useTurtleWardrobe.setState({error: String(error)})}
}
export function refreshTurtleWardrobe(): Promise<void> {
  if (pending) return pending
  const accountId = useTurtleWardrobe.getState().accountId
  if (!accountId) return loadWardrobeCatalog()
  const current = generation
  pending = Promise.resolve().then(async () => {
    try {
      const [snapshot, raw] = await Promise.all([turtle<WardrobeSnapshot>('turtle_wardrobe', {accountId}), turtle<Catalog>('turtle_catalog')])
      const catalog=normalizeTurtleCatalog(raw)
      const worn = catalog.models.filter(item => Object.values(snapshot.equipped).includes(item.id))
      const entries = await Promise.all(worn.map(async item => [item.id, await turtleModel(item)] as const))
      if (current !== generation) return
      const next = JSON.stringify({snapshot, catalog})
      if (next !== revision) { revision = next; useTurtleWardrobe.setState({ snapshot, catalog, models: Object.fromEntries(entries), error: '' }) }
      else if (useTurtleWardrobe.getState().error) useTurtleWardrobe.setState({error:''})
    } catch (error) {if (current === generation) useTurtleWardrobe.setState({error: String(error)})}
    finally {if (current === generation) pending = null}
  })
  return pending
}
export async function wearTurtle(slot: string, item: string | null) {
  const state = useTurtleWardrobe.getState()
  if (!state.accountId || state.busy) return
  const current = generation
  useTurtleWardrobe.setState({busy: slot, error:''})
  try {
    await turtle('turtle_wardrobe', {accountId:state.accountId, slot, item})
    if (current !== generation) return
    await pending
    await refreshTurtleWardrobe()
  } catch (error) {if (current === generation) useTurtleWardrobe.setState({error: String(error)})}
  finally {if (current === generation) useTurtleWardrobe.setState({busy:null})}
}
