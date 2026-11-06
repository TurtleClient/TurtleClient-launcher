// Turtle format-2 renderer; box-face/UV conventions adapted from Horizon's
// MIT-licensed horizon-cosmetics/src/item.rs. Copyright (c) 2026 Ludovic Marie
// and the Horizon contributors. Full notice: licenses/horizon-cosmetics-MIT.txt.
import { BufferGeometry, Float32BufferAttribute, DoubleSide, Group, Mesh, MeshLambertMaterial, NearestFilter, SRGBColorSpace, TextureLoader } from 'three'
import { anchorShift } from './cosmeticPlacement'
import type { CosmeticAnchor } from './cosmeticPlacement'
import type { Face, TurtleCube, TurtleModel, TurtlePart, Vec3 } from './turtleModelTypes'

const anchors: Record<string, CosmeticAnchor> = {head:'head',body:'body',left_arm:'leftArm',right_arm:'rightArm',left_leg:'leftLeg',right_leg:'rightLeg'}
const radians = (n:number) => n*Math.PI/180
export function turtleCubeGeometry(cube:TurtleCube,width:number,height:number): BufferGeometry {
  const [x,y,z]=cube.origin,[w,h,d]=cube.size,inflate=cube.inflate || 0
  const a=x-inflate,b=y-inflate,c=z-inflate,e=x+w+inflate,f=y+h+inflate,g=z+d+inflate
  const vertices:Record<Face,Vec3[]>={east:[[e,b,g],[e,b,c],[e,f,c],[e,f,g]],west:[[a,b,c],[a,b,g],[a,f,g],[a,f,c]],up:[[e,b,g],[a,b,g],[a,b,c],[e,b,c]],down:[[e,f,c],[a,f,c],[a,f,g],[e,f,g]],north:[[e,b,c],[a,b,c],[a,f,c],[e,f,c]],south:[[a,b,g],[e,b,g],[e,f,g],[a,f,g]]}
  const [u,v]=cube.uv || [0,0]
  const boxes:Record<Face,number[]>={east:[u+d+w,v+d,d,h],west:[u,v+d,d,h],up:[u+d,v,w,d],down:[u+d+w,v+d,w,-d],north:[u+d,v+d,w,h],south:[u+2*d+w,v+d,w,h]}
  const positions:number[]=[],uvs:number[]=[]
  for (const face of Object.keys(vertices) as Face[]) {
    if(cube.face_uv && !cube.face_uv[face])continue
    const [left,top,across,down]=boxes[face]
    const uv=cube.face_uv?.[face] || [[left+across,top],[left,top],[left,top+down],[left+across,top+down]]
    for(const index of (cube.mirror?[3,2,1,3,1,0]:[0,1,2,0,2,3])) {
      const point=vertices[face][index]
      positions.push(cube.mirror?x+w-(point[0]-x):point[0],point[1],point[2])
      uvs.push(uv[index][0]/width,1-uv[index][1]/height)
    }
  }
  const geometry=new BufferGeometry()
  geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new Float32BufferAttribute(uvs,2));geometry.computeVertexNormals()
  return geometry
}
export async function buildTurtleCosmetic(model:TurtleModel) {
  const texture=await new TextureLoader().loadAsync('data:image/png;base64,'+model.texture.png)
  texture.magFilter=NearestFilter;texture.minFilter=NearestFilter;texture.colorSpace=SRGBColorSpace
  const image=texture.image as HTMLImageElement
  const material=new MeshLambertMaterial({map:texture,transparent:true,alphaTest:.05,side:DoubleSide})
  const pieces:{anchor:CosmeticAnchor;object:Group}[]=[],joints=new Map<string,{group:Group,pivot:Vec3,rotation:Vec3}>()
  const geometries:BufferGeometry[]=[]
  let vertices=0,parts=0
  function branch(part:TurtlePart):Group {
    if(++parts>64)throw Error('Too many Turtle model parts')
    const group=new Group(),pivot=part.pivot || [0,0,0],rotation=part.rotation || [0,0,0]
    group.position.fromArray(pivot);group.rotation.set(...rotation.map(radians) as Vec3,'ZYX')
    joints.set(part.name,{group,pivot,rotation})
    for(const cube of part.cubes || []) {
      const geometry=turtleCubeGeometry(cube,image.width,image.height);geometries.push(geometry)
      vertices+=geometry.getAttribute('position').count
      if(vertices>6144)throw Error('Turtle model vertex budget exceeded')
      group.add(new Mesh(geometry,material))
    }
    for(const child of part.children || [])group.add(branch(child))
    return group
  }
  try {
    for(const part of model.parts || []) {
      const anchor=anchors[part.bone || model.bone || 'head'] || 'head'
      const object=new Group();object.position.y=anchorShift(anchor);object.scale.set(1,-1,-1)
      const attach=new Group();attach.position.fromArray(model.attach?.offset || [0,0,0]);attach.rotation.set(...(model.attach?.rotation || [0,0,0]).map(radians) as Vec3,'ZYX');attach.scale.setScalar(model.attach?.scale || 1)
      attach.add(branch(part));object.add(attach);pieces.push({anchor,object})
    }
    const animate=()=>{
      const ticks=Date.now()/50
      for(const {group,pivot,rotation} of joints.values()) {group.position.fromArray(pivot);group.rotation.set(...rotation.map(radians) as Vec3,'ZYX')}
      for(const animation of model.animations || []) {
        const joint=joints.get(animation.part)?.group;if(!joint)continue
        const phase=ticks/Math.max(4,animation.period)+(animation.phase || 0),sine=Math.sin(phase*2*Math.PI)
        if(animation.motion==='bob')joint.position[animation.axis]+=(animation.amplitude || 0)*sine
        else joint.rotation[animation.axis]+=animation.motion==='spin'?phase*2*Math.PI:radians(animation.amplitude || 0)*sine
      }
    }
    let ticker=false
    for(const piece of pieces)piece.object.traverse(node=>{if(!ticker && (node as Mesh).isMesh){(node as Mesh).onBeforeRender=animate;ticker=true}})
    return {pieces,dispose:()=>{geometries.forEach(g=>g.dispose());material.dispose();texture.dispose()}}
  }catch(error){geometries.forEach(g=>g.dispose());material.dispose();texture.dispose();throw error}
}
