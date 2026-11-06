export interface MinecraftSkin { skin: string; slim: boolean; cape: string | null }
export interface MinecraftTextures { skin: string | null; cape: string | null; slim?: boolean }
export const DEFAULT_MINECRAFT_SKIN = 'https://textures.minecraft.net/texture/31f477eb1a7beee631c2ca64d06f8f68fa93a3386d04452ab27f43acdf1b60cb'

/** Keep successful profile answers; a temporary failure must never cache Steve. */
export class MinecraftSkinCache {
  private readonly saved = new Map<string, {at:number; skin:MinecraftSkin}>()
  private readonly pending = new Map<string, Promise<MinecraftSkin>>()
  constructor(private readonly resolve:(query:string)=>Promise<MinecraftTextures>,private readonly now=Date.now) {}
  invalidate(query:string) {this.saved.delete(this.key(query));this.pending.delete(this.key(query))}
  private key(query:string) {return query.replace(/-/g,'').toLowerCase()}
  load(query:string):Promise<MinecraftSkin> {
    const key=this.key(query),hit=this.saved.get(key)
    if(hit && this.now()-hit.at<300000)return Promise.resolve(hit.skin)
    const running=this.pending.get(key);if(running)return running
    const task=Promise.resolve().then(()=>this.resolve(query)).then(profile=>{
      const skin={skin:profile.skin || DEFAULT_MINECRAFT_SKIN,slim:!!profile.slim,cape:profile.cape || null}
      if(this.pending.get(key)===task)this.saved.set(key,{at:this.now(),skin})
      return skin
    }).catch(error=>{if(hit)return hit.skin;throw error}).finally(()=>{if(this.pending.get(key)===task)this.pending.delete(key)})
    this.pending.set(key,task)
    return task
  }
}
