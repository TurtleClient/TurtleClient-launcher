import type { TagAnimation } from './turtleModelTypes'
function rgb(hex:string):number[] {return /^#[0-9a-f]{6}$/i.test(hex)?[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)):[255,255,255]}
function mix(a:string,b:string,t:number):string {const x=rgb(a),y=rgb(b);return `rgb(${x.map((n,i)=>Math.round(n+(y[i]-n)*t)).join(',')})`}
export function turtleTagColor(animation:TagAnimation | undefined,line:string,ms:number,index=0,length=1):string {
  if(!animation || animation.colors.length<2)return line
  const colors=animation.colors,phase=ms/(Math.max(20,animation.period)*50)
  if(animation.mode==='pulse')return mix(colors[0],colors[1],.5-.5*Math.cos(phase*2*Math.PI))
  if(animation.mode==='shine')return mix(colors[0],colors[1],Math.max(0,(Math.cos((phase-index/Math.max(1,length)*(animation.spread ?? 1))*2*Math.PI)-.6)/.4))
  const p=phase+(animation.mode==='wave'?index/Math.max(1,length)*(animation.spread ?? 1):0)
  const at=((p%1+1)%1)*colors.length,a=Math.floor(at)
  return mix(colors[a],colors[(a+1)%colors.length],at-a)
}
