import { mcTextures } from '../ipc/commands'
import type { Account } from '../state/accounts'
import { MinecraftSkinCache } from './minecraftSkinCache'

export const minecraftSkins=new MinecraftSkinCache(async query=>{
  try{return await mcTextures(query)}
  catch {await new Promise(resolve=>setTimeout(resolve,750));return mcTextures(query)}
})
export const loadMinecraftSkin=(account:Pick<Account,'uuid'|'nick'>)=>minecraftSkins.load(account.uuid || account.nick)
