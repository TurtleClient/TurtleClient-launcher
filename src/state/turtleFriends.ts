import { create } from 'zustand'
import { FriendsConnection } from '../lib/friendsConnection'
import { turtle } from '../lib/turtleclient'
import type { FriendList } from '../lib/turtleclient'
import type { ConnectionState } from '../lib/friendsConnection'
import { useAccounts } from './accounts'

export const useTurtleFriends = create<ConnectionState>(() => ({ accountId: null, connected: false, connecting: false, error: '', data: { friends: [], incoming: [], outgoing: [] } }))
export const turtleFriendsConnection = new FriendsConnection({
  connect: accountId => turtle('turtle_friends_connect', { accountId }),
  list: accountId => turtle<FriendList>('turtle_friends', { accountId, action: 'list' }),
}, state => {
  useTurtleFriends.setState(state)
  void import('./turtleWardrobe').then(module => {
    const current = useTurtleFriends.getState()
    module.syncWardrobeAccount(current.accountId, current.connected)
  })
})

export function watchTurtleFriends() {
  const select = () => {
    const { list, active } = useAccounts.getState()
    const account = list.find(a => a.id === active) || list[0]
    turtleFriendsConnection.select(account?.kind === 'microsoft' ? account.id : null)
  }
  const unsubscribe = useAccounts.subscribe(select)
  select()
  return () => { unsubscribe(); turtleFriendsConnection.select(null) }
}
