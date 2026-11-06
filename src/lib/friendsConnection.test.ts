import { describe, expect, test } from 'bun:test'
import { FriendsConnection } from './friendsConnection'
import type { FriendList } from './turtleclient'

const data = (name: string): FriendList => ({ friends: [{ uuid: name, name, online: true }], incoming: [], outgoing: [] })
function clock() {
  let callback: (() => void) | null = null
  return {
    repeat(fn: () => void, ms: number) { expect(ms).toBe(20000); callback = fn; return fn },
    clear() { callback = null },
    tick() { callback?.() },
    active() { return !!callback },
  }
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => {resolve = r}); return { promise, resolve } }

describe('launcher friends connection', () => {
  test('connects immediately and heartbeats without reopening the friends screen', async () => {
    const timer = clock(); let heartbeat = 0; let connections = 0
    const connection = new FriendsConnection({ connect: async () => { connections++ }, list: async () => data('Heartbeat' + ++heartbeat) }, () => {}, timer)
    connection.select('alice')
    await connection.refresh()
    expect(connection.state.connected).toBe(true)
    expect(connection.state.data.friends[0].name).toBe('Heartbeat1')
    connection.select('alice') // Navigation or another account-store update.
    expect(connections).toBe(1)
    timer.tick(); await connection.refresh()
    expect(connection.state.data.friends[0].name).toBe('Heartbeat2')
    connection.select(null)
    expect(timer.active()).toBe(false)
    timer.tick(); await connection.refresh()
    expect(heartbeat).toBe(2)
  })
  test('coalesces overlapping polls instead of starting simultaneous logins', async () => {
    const ready = deferred<void>(); let connections = 0
    const connection = new FriendsConnection({ connect: () => { connections++; return ready.promise }, list: async () => data('Friend') }, () => {}, clock())
    connection.select('alice')
    const first = connection.refresh(); const second = connection.refresh()
    expect(first).toBe(second)
    ready.resolve(); await first
    expect(connections).toBe(1)
    expect(connection.state.connected).toBe(true)
  })
  test('recovers from an expired server session automatically', async () => {
    let connections = 0; let polls = 0
    const connection = new FriendsConnection({ connect: async () => {connections++}, list: async () => {if (++polls === 1) throw 'turtle_http_401'; return data('Recovered')} }, () => {}, clock())
    connection.select('alice'); await connection.refresh()
    expect(connection.state.connected).toBe(true)
    expect(connection.state.data.friends[0].name).toBe('Recovered')
    expect(connections).toBe(2)
  })
  test('retries network failures in the background, including synchronous failures', async () => {
    let available = false
    const timer = clock()
    const connection = new FriendsConnection({ connect: () => {if (!available) throw new Error('offline'); return Promise.resolve()}, list: async () => data('Back online') }, () => {}, timer)
    connection.select('alice'); await connection.refresh()
    expect(connection.state.connected).toBe(false)
    available = true; timer.tick(); await connection.refresh()
    expect(connection.state.connected).toBe(true)
    expect(connection.state.error).toBe('')
  })
  test('an old account response cannot replace the newly selected account', async () => {
    const old = deferred<FriendList>()
    const connection = new FriendsConnection({ connect: async () => {}, list: id => id === 'alice' ? old.promise : Promise.resolve(data('Bob friend')) }, () => {}, clock())
    connection.select('alice'); const oldPoll = connection.refresh()
    await Promise.resolve(); await Promise.resolve()
    connection.select('bob'); await connection.refresh()
    old.resolve(data('Alice friend')); await oldPoll
    expect(connection.state.accountId).toBe('bob')
    expect(connection.state.data.friends[0].name).toBe('Bob friend')
  })
  test('refresh after a mutation cannot reuse a poll from before the change', async () => {
    const old = deferred<FriendList>(); let polls = 0
    const timer = clock()
    const connection = new FriendsConnection({ connect: async () => {}, list: async () => ++polls === 2 ? old.promise : data(polls === 1 ? 'Initial' : 'New friend') }, () => {}, timer)
    connection.select('alice'); await connection.refresh()
    timer.tick(); await Promise.resolve(); await Promise.resolve()
    const changed = connection.refreshAfterChange()
    old.resolve(data('Old friend')); await changed
    expect(connection.state.data.friends[0].name).toBe('New friend')
  })
})
