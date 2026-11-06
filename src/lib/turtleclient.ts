import { tauri } from '../ipc/tauri'
export interface TurtleSettings { executable: string; resources: string; game_dir: string }
export interface TurtleStatus { settings: TurtleSettings; running: boolean }
export interface Friend { uuid: string; name: string; online: boolean }
export interface FriendList { friends: Friend[]; incoming: Friend[]; outgoing: Friend[] }
export interface Cosmetic { id: string; name: string; slot: string; owner: string; hash: string; type?:string; access?:'free'|'paid'; price_minor?:number; currency?:string }
export interface WardrobeCategory { id: string; label: Record<string, string>; slots: string[] }
export interface Categories { categories: WardrobeCategory[]; assignments: Record<string, string>; items?:Record<string,{type?:string;access?:'free'|'paid';price_minor?:number;currency?:string}> }
export interface Catalog { models: Cosmetic[]; capes: Cosmetic[]; free: boolean; categories?: Categories }
export interface WardrobeSnapshot { player: { uuid: string; name: string }; equipped: Record<string, string>; cape: boolean; cape_revision?: string | null; categories: Categories; owned?:string[] }
export const TURTLE_API = 'https://45.133.9.162/turtleclient'
export function turtle<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const bridge = tauri()
  return bridge ? bridge.core.invoke<T>(command, args) : Promise.reject(new Error('turtle_native_required'))
}
export const emptyFriends = (): FriendList => ({ friends: [], incoming: [], outgoing: [] })
export function serviceError(error: unknown): string {
  const code = String(error)
  if (code.includes('404')) return 'Turtle: player not found. They must connect to Friends first.'
  if (code.includes('401') || code.includes('connect_required')) return 'Turtle: connect to Friends again.'
  if (code.includes('429')) return 'Turtle: too many requests. Please wait.'
  if (code.includes('login_required')) return 'Turtle: sign in with a Microsoft Minecraft account.'
  if (code.includes('executable')) return 'Turtle: select the TurtleClient executable.'
  if (code.includes('resources')) return 'Turtle: select the prepared Minecraft 26.3 resources.'
  if (code.includes('game_dir')) return 'Turtle: select an absolute game folder.'
  if (code.includes('already_running')) return 'Turtle: the client is already running.'
  if (code.includes('native_required')) return 'Turtle: open the desktop launcher to use this feature.'
  return 'Turtle: the operation failed. Check your connection and configuration.'
}
