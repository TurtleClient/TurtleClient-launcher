export type Vec3 = [number, number, number]
export type Face = 'up' | 'down' | 'north' | 'south' | 'east' | 'west'
export interface TurtleCube { origin: Vec3; size: Vec3; uv?: [number, number]; inflate?: number; mirror?: boolean; face_uv?: Partial<Record<Face, [number, number][]>> }
export interface TurtlePart { name: string; bone?: string; pivot?: Vec3; rotation?: Vec3; cubes?: TurtleCube[]; children?: TurtlePart[] }
export interface TagAnimation { mode: 'cycle' | 'wave' | 'pulse' | 'shine'; colors: string[]; period: number; spread?: number }
export interface TurtleModel { format: number; id: string; slot: string; bone?: string; attach?: { offset?: Vec3; rotation?: Vec3; scale?: number }; texture: { png: string }; parts: TurtlePart[]; animations?: { part: string; motion: 'swing' | 'spin' | 'bob'; axis: 'x' | 'y' | 'z'; amplitude?: number; period: number; phase?: number }[]; tag?: { line: string; animation?: TagAnimation } }
