import { expect, test } from 'bun:test'
import { turtleTagColor } from './turtleTag'
test('name tag cycle and pulse follow the configured period',()=>{
  const base={colors:['#ff0000','#0000ff'],period:20}
  expect(turtleTagColor({...base,mode:'cycle'},'#ffffff',0)).toBe('rgb(255,0,0)')
  expect(turtleTagColor({...base,mode:'cycle'},'#ffffff',500)).toBe('rgb(0,0,255)')
  expect(turtleTagColor({...base,mode:'pulse'},'#ffffff',500)).toBe('rgb(0,0,255)')
  expect(turtleTagColor({...base,mode:'pulse'},'#ffffff',1000)).toBe('rgb(255,0,0)')
})
test('wave colors vary across the name while unequipped tags remain unchanged',()=>{
  const animation={mode:'wave' as const,colors:['#ff0000','#0000ff'],period:20,spread:1}
  expect(turtleTagColor(animation,'#ffffff',0,1,2)).toBe('rgb(0,0,255)')
  expect(turtleTagColor(undefined,'#abcdef',100,1,2)).toBe('#abcdef')
})
