import type { Cosmetic } from './turtleclient'
export function turtlePrice(item:Cosmetic,locale:string):string | null {
  if(item.price_minor===undefined || !Number.isSafeInteger(item.price_minor) || item.price_minor<0 || !/^[A-Z]{3}$/.test(item.currency || ''))return null
  const format=new Intl.NumberFormat(locale,{style:'currency',currency:item.currency})
  return format.format(item.price_minor/10**(format.resolvedOptions().maximumFractionDigits ?? 2))
}
