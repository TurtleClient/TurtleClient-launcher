import { expect, test } from 'bun:test'
import { turtleCubeGeometry } from './turtleGeometry'
test('Turtle per-face UVs retain corner order and omit unspecified faces',()=>{
  const geometry=turtleCubeGeometry({origin:[0,0,0],size:[2,3,4],face_uv:{north:[[4,5],[8,5],[8,13],[4,13]]}},16,16)
  expect(geometry.getAttribute('position').count).toBe(6)
  expect(Array.from(geometry.getAttribute('position').array).slice(0,9)).toEqual([2,0,0,0,0,0,0,3,0])
  expect(Array.from(geometry.getAttribute('uv').array).slice(0,6)).toEqual([.25,.6875,.5,.6875,.5,.1875])
  expect(Array.from(geometry.getAttribute('normal').array).slice(0,3)).toEqual([0,0,-1])
  geometry.dispose()
})
test('inflation changes geometry bounds while preserving the original texture scale',()=>{
  const geometry=turtleCubeGeometry({origin:[0,0,0],size:[2,3,4],uv:[0,0],inflate:1},16,16)
  geometry.computeBoundingBox()
  expect(geometry.boundingBox!.min.toArray()).toEqual([-1,-1,-1])
  expect(geometry.boundingBox!.max.toArray()).toEqual([3,4,5])
  expect(Array.from(geometry.getAttribute('uv').array).slice(0,2)).toEqual([.625,.75])
  expect(Array.from(geometry.getAttribute('uv').array).slice(36,38)).toEqual([.5,.75])
  geometry.dispose()
})
