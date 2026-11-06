import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { SkinViewEngine } from '../vendor/mine3d'
import { useAccounts } from '../state/accounts'
import { useTurtleWardrobe } from '../state/turtleWardrobe'
import { buildTurtleCosmetic } from './turtleGeometry'
import { turtle } from './turtleclient'
import { loadImg } from './skinArms'

export function useTurtleCharacter(viewer:RefObject<SkinViewEngine | null>,ready:number,onDressed?:()=>void) {
  const notify=useRef(onDressed);notify.current=onDressed
  const wardrobe=useTurtleWardrobe()
  const active=useAccounts(s=>s.active)
  useEffect(()=>{
    const engine=viewer.current
    if(!engine || !ready)return
    engine.clearCosmetics()
    if(!wardrobe.snapshot || wardrobe.accountId!==active)return
    let alive=true
    const built:Awaited<ReturnType<typeof buildTurtleCosmetic>>[]=[]
    void Promise.all(Object.values(wardrobe.models).filter(model=>model.slot!=='name_tag').map(model=>
      buildTurtleCosmetic(model).then(result=>{
        if(!alive){result.dispose();return}
        built.push(result)
        for(const piece of result.pieces)engine.attachCosmetic(piece.anchor,piece.object)
      }).catch(()=>{})
    )).then(()=>{if(alive)notify.current?.()})
    return ()=>{alive=false;engine.clearCosmetics();built.forEach(model=>model.dispose())}
  },[ready,active,wardrobe.models,wardrobe.accountId,viewer])
  useEffect(()=>{
    const engine=viewer.current
    if(!engine || !ready)return
    if(!wardrobe.snapshot || wardrobe.accountId!==active){engine.clearCape();return}
    let alive=true
    if(wardrobe.snapshot.cape)void turtle<string|null>('turtle_cape',{uuid:wardrobe.snapshot.player.uuid}).then(src=>src?loadImg(src):null).then(image=>{if(alive)return engine.setCape(image)}).then(()=>{if(alive)notify.current?.()}).catch(()=>{})
    else if(alive)engine.clearCape()
    return()=>{alive=false}
  },[ready,active,wardrobe.accountId,wardrobe.snapshot?.cape,wardrobe.snapshot?.cape_revision,viewer])
}
