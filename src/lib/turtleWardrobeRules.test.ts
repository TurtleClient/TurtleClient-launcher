import { expect,test } from 'bun:test'
import { normalizeTurtleCatalog,categoryOf,isTurtleUnlocked } from './turtleWardrobeRules'
import { turtlePrice } from './turtlePrice'
import type { Catalog,Cosmetic } from './turtleclient'
const hat:Cosmetic={id:'hat',name:'Hat',slot:'head',owner:'fixture',hash:'a'.repeat(64)}
test('server classification changes category/type without changing the physical slot or identity',()=>{
  const raw:Catalog={models:[hat],capes:[],free:true,categories:{categories:[{id:'special',label:{en:'Special'},slots:[]}],assignments:{hat:'special'},items:{hat:{type:'EARS',access:'paid',price_minor:999,currency:'EUR'}}}}
  const catalog=normalizeTurtleCatalog(raw),item=catalog.models[0]
  expect(categoryOf(item,catalog.categories!)).toBe('special')
  expect(item.slot).toBe('head');expect(item.type).toBe('EARS');expect(item.id).toBe('hat')
  expect(isTurtleUnlocked(item)).toBe(false);expect(isTurtleUnlocked(item,['hat'])).toBe(true)
  expect(turtlePrice(item,'en-US')).toBe('€9.99')
})
test('existing free items remain usable and a paid upstream item never becomes free by default',()=>{
  const catalog=normalizeTurtleCatalog({models:[hat,{...hat,id:'paid_hat',access:'paid'}],capes:[],free:false})
  expect(isTurtleUnlocked(catalog.models[0])).toBe(true)
  expect(isTurtleUnlocked(catalog.models[1])).toBe(false)
  expect(catalog.models[0].type).toBe('HAT')
})
