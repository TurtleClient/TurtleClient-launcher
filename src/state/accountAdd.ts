import { create } from 'zustand'
import { openModal } from './ui'

export type AccountAddKind = 'microsoft' | 'offline' | 'millida'

export const useAccountAdd = create<{ kind: AccountAddKind | null }>(() => ({ kind: null }))

// Legacy account requests always open the Microsoft Minecraft sign-in.
export function openAccountAdd(_kind?: AccountAddKind) {
  useAccountAdd.setState({ kind: 'microsoft' })
  openModal('accModal')
}
