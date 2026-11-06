import { expect, test } from 'bun:test'
import { MinecraftSkinCache } from './minecraftSkinCache'
const profile={skin:'https://textures.minecraft.net/texture/fixture',cape:null,slim:true}

test('UUID variants share one profile request and preserve the supplied model',async()=>{
  let reads=0
  const cache=new MinecraftSkinCache(async()=>{reads++;return profile})
  const [a,b]=await Promise.all([cache.load('00000000-0000-0000-0000-000000000001'),cache.load('00000000000000000000000000000001')])
  expect(reads).toBe(1);expect(a).toEqual(profile);expect(b).toEqual(profile)
})
test('temporary profile errors never poison the next read with a default skin',async()=>{
  let reads=0
  const cache=new MinecraftSkinCache(async()=>{if(++reads===1)throw Error('offline');return profile})
  await expect(cache.load('player')).rejects.toThrow('offline')
  expect(await cache.load('player')).toEqual(profile)
  expect(reads).toBe(2)
})
test('refresh errors retain the last successful skin and retry on the next request',async()=>{
  let now=0,fail=false,reads=0
  const cache=new MinecraftSkinCache(async()=>{reads++;if(fail)throw Error('offline');return profile},()=>now)
  await cache.load('first');now=300001;fail=true
  expect(await cache.load('first')).toEqual(profile)
  fail=false
  expect(await cache.load('first')).toEqual(profile);expect(reads).toBe(3)
  fail=true
  await expect(cache.load('other-account')).rejects.toThrow('offline')
})
test('an invalidated pending response cannot replace a newer skin in the cache',async()=>{
  let release!:(value:typeof profile)=>void,reads=0
  const cache=new MinecraftSkinCache(async()=>++reads===1?new Promise(resolve=>{release=resolve}):{...profile,skin:'new'})
  const old=cache.load('player');await Promise.resolve()
  cache.invalidate('player');expect((await cache.load('player')).skin).toBe('new')
  release(profile);await old
  expect((await cache.load('player')).skin).toBe('new')
})
