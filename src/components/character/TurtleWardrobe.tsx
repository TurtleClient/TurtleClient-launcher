import { useEffect } from 'react'
import { useT, getLocale } from '../../i18n'
import { useTurtleWardrobe, loadWardrobeCatalog, wearTurtle, categoryOf } from '../../state/turtleWardrobe'
import { TURTLE_API, serviceError } from '../../lib/turtleclient'
import { ModelArt } from '../shop/TurtleCatalog'
import { ItemGrid, ItemTile } from './ItemTile'
import { setScreen } from '../../state/ui'
import { turtlePrice } from '../../lib/turtlePrice'
import { isTurtleUnlocked } from '../../lib/turtleWardrobeRules'

export function TurtleWardrobe({ category,slots,ownedOnly=false }: {category:string;slots?:string[];ownedOnly?:boolean}) {
  const t=useT(),state=useTurtleWardrobe(),catalog=state.catalog
  useEffect(()=>{if(!catalog)void loadWardrobeCatalog()},[])
  const config=state.snapshot?.categories || catalog?.categories
  const owned=(item:import('../../lib/turtleclient').Cosmetic)=>isTurtleUnlocked(item,state.snapshot?.owned)
  const items=[...(catalog?.models || []),...(catalog?.capes || [])].filter(item=>(category==='all' || (config && categoryOf(item,config)===category)) && (!slots || slots.includes(item.type || '')) && (!ownedOnly || owned(item)))
  return <>
    {state.error && <p className="faint-note" role="alert">{t(serviceError(state.error))}</p>}
    {!state.accountId && <p className="faint-note">{t('Turtle: sign in with a Microsoft Minecraft account.')}</p>}
    <ItemGrid>{items.map(item=>{
      const equipped=item.slot==='cape' ? !!state.snapshot?.cape && item.hash===state.snapshot.cape_revision : state.snapshot?.equipped[item.slot]===item.id
      const available=owned(item)
      const price=turtlePrice(item,getLocale()) || t('Turtle: shop item')
      const status=equipped?t('Turtle: equipped — click to unequip'):available?t('Turtle: click to equip'):price
      return <ItemTile key={item.id} name={item.name} itemId={item.id} art={item.slot==='cape'?<img src={`${TURTLE_API}/api/cape/${encodeURIComponent(item.owner)}`} width={128} height={128} alt="" style={{objectFit:'contain',imageRendering:'pixelated'}} />:<ModelArt item={item} />}
        on={equipped} status={<span className="ch-tile-note" title={status}>{status}</span>} loading={state.busy===item.slot} locked={!equipped && !available}
        onClick={()=>{if(!equipped && !available){setScreen('rubies');return}if(state.accountId && !state.busy)void wearTurtle(item.slot,equipped?null:item.id)}} />
    })}</ItemGrid>
    {catalog && !items.length && <p className="faint-note">{t('Turtle: no items yet.')}</p>}
  </>
}
export function useTurtleSections() {
  const t=useT(),state=useTurtleWardrobe()
  const config=state.snapshot?.categories || state.catalog?.categories
  return [{key:'tc:all',name:t('Turtle: all cosmetics'),icon:'ws-looks'},...(config?.categories || []).map(category=>({key:'tc:'+category.id,name:category.label[getLocale()] || category.label.en || category.id,icon:category.slots.includes('cape')?'ws-cape':'ws-head'}))]
}
