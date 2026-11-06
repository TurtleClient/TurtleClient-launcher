import type { FriendList } from './turtleclient'

export interface ConnectionState {
  accountId: string | null
  connected: boolean
  connecting: boolean
  error: string
  data: FriendList
}
interface Transport { connect(id: string): Promise<unknown>; list(id: string): Promise<FriendList> }
interface Clock { repeat(callback: () => void, ms: number): unknown; clear(timer: unknown): void }
const blank = (): FriendList => ({ friends: [], incoming: [], outgoing: [] })
const authError = (error: unknown) => /401|connect_required/.test(String(error))

/** Account-scoped connection lifetime belongs to the launcher, not a screen. */
export class FriendsConnection {
  state: ConnectionState = { accountId: null, connected: false, connecting: false, error: '', data: blank() }
  private generation = 0
  private timer: unknown
  private pending: Promise<void> | null = null
  constructor(private transport: Transport, private publish: (state: ConnectionState) => void, private clock: Clock = {
    repeat: (callback, ms) => setInterval(callback, ms),
    clear: timer => clearInterval(timer as ReturnType<typeof setInterval>),
  }) {}
  private update(patch: Partial<ConnectionState>) {
    this.state = { ...this.state, ...patch }
    this.publish(this.state)
  }
  select(accountId: string | null) {
    if (accountId === this.state.accountId) return
    this.generation++
    if (this.timer !== undefined) this.clock.clear(this.timer)
    this.timer = undefined
    this.pending = null
    this.update({ accountId, connected: false, connecting: !!accountId, error: '', data: blank() })
    if (!accountId) return
    void this.refresh()
    this.timer = this.clock.repeat(() => void this.refresh(), 20000)
  }
  refresh(): Promise<void> {
    if (this.pending) return this.pending
    const accountId = this.state.accountId
    if (!accountId) return Promise.resolve()
    const generation = this.generation
    const current = () => this.generation === generation
    this.update({ connecting: !this.state.connected })
    this.pending = Promise.resolve().then(async () => {
      try {
        // Native connect reuses a valid service session, or renews it when expired.
        for (let attempt = 0; attempt < 2; attempt++) {
          await this.transport.connect(accountId)
          if (!current()) return
          try {
            const data = await this.transport.list(accountId)
            if (current()) this.update({ data, connected: true, connecting: false, error: '' })
            return
          } catch (error) {
            if (!authError(error) || attempt) throw error
            // A server restart invalidates its in-memory session. Native list
            // removes that credential on 401, so connect obtains a fresh one.
          }
        }
      } catch (error) {
        if (current()) this.update({ connected: false, connecting: false, error: String(error) })
      } finally {
        if (current()) this.pending = null
      }
    })
    return this.pending
  }
  async refreshAfterChange() {
    await this.pending
    await this.refresh()
  }
}
