import { create } from 'zustand'
import { writePref } from '../lib/prefs'

// Legacy layout requests and preferences always resolve to the current lobby.
export type Layout = 'lobby' | 'classic'

const initial = (): Layout => 'lobby'

const apply = (l: Layout) => document.documentElement.classList.toggle('lay-classic', l === 'classic')

export const useLayout = create<{ layout: Layout; set: (l: Layout) => void }>((set) => ({
  layout: initial(),
  set: (_requested) => {
    const layout: Layout = 'lobby'
    writePref('m-layout', layout)
    apply(layout)
    set({ layout })
  },
}))

apply(useLayout.getState().layout)

