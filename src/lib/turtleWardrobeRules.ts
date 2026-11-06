import type { Catalog, Categories, Cosmetic } from './turtleclient'
const types:Record<string,string>={head:'HAT',torso:'TOP',shoulder:'SHOULDER',back:'BACK',cape:'CAPE',name_tag:'NAME_TAG'}
export function normalizeTurtleCatalog(catalog:Catalog):Catalog {
  const item=(entry:Cosmetic):Cosmetic=>{
    const meta=catalog.categories?.items?.[entry.id],access=meta?.access ?? entry.access
    return {...entry,type:meta?.type || entry.type || types[entry.slot] || entry.slot.toUpperCase(),access:access===undefined || access==='free'?'free':'paid',price_minor:meta?.price_minor ?? entry.price_minor,currency:meta?.currency ?? entry.currency}
  }
  return {...catalog,models:catalog.models.map(item),capes:catalog.capes.map(item)}
}
export function categoryOf(item:Cosmetic,config?:Categories):string | undefined {
  return config?.assignments?.[item.id] || config?.categories.find(category=>category.slots.includes(item.slot))?.id
}
export const isTurtleUnlocked=(item:Cosmetic,owned:readonly string[]=[])=>item.access!=='paid' || owned.includes(item.id)
