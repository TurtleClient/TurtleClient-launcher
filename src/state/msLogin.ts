// Startup account renewal. Interactive device-code sign-in lives in its own lazy chunk.
import { hasTauri } from '../ipc/tauri'
import { msSessionRefresh, msSessionValidate } from '../ipc/commands'
import { getAccount, hasLicenseSession, msTokenFresh, useAccounts } from './accounts'
import type { Account } from './accounts'
import { refreshSessionState } from '../lib/secure'

export async function startMsLogin(afterSpentCode = false) {
  const flow = await import('./msLoginFlow')
  return flow.startMsLogin(afterSpentCode)
}

// Identifies a live licensed session. The token behind it stays in the core.
export interface MsAuth {
  id: string
  uuid: string
  xuid: string
}

export const expiresAt = (seconds?: number) => Date.now() + Math.max(60, seconds || 86400) * 1000

function patchAccount(id: string, patch: Partial<Account>) {
  const st = useAccounts.getState()
  st.save(st.list.map((x) => (x.id === id ? { ...x, ...patch } : x)))
}

function authOf(a: Account): MsAuth {
  return { id: a.id, uuid: a.uuid || '', xuid: a.xuid || '' }
}

async function refreshMsAccount(a: Account): Promise<MsAuth | null> {
  let r
  try {
    r = await msSessionRefresh(a.id)
  } catch {
    // Microsoft unreachable: the stored session stays as it is.
    return null
  }
  if (r.status === 'relogin') {
    patchAccount(a.id, { exp: 0 })
    await refreshSessionState()
    return null
  }
  if (r.status !== 'ok') return null
  const patch: Partial<Account> = { exp: expiresAt(r.expires_in) }
  if (r.nick) patch.nick = r.nick
  if (r.uuid) patch.uuid = r.uuid
  if (r.xuid) patch.xuid = r.xuid
  patchAccount(a.id, patch)
  await refreshSessionState()
  return { id: a.id, uuid: r.uuid || a.uuid || '', xuid: r.xuid || a.xuid || '' }
}

// Past this the launch goes on with the stored token. Without a network the
// renewal hangs on connect timeouts for a minute and more, and the game itself
// says so if the session is refused.
const RENEW_WAIT_MS = 15000

function withinRenewWait<T>(work: Promise<T>): Promise<T | 'late'> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => resolve('late'), RENEW_WAIT_MS)
  })
  return Promise.race([work, late]).finally(() => clearTimeout(timer))
}

// A present token is not enough: MC tokens last a day while the launcher can sit
// in the tray for longer, and the game would then fail joinServer with 401.
//
// `ahead`: renew a token that ends within this many ms, not only within the usual five minutes. The lobby asks for ten:
// asked with the usual margin, a token with seven minutes left counted as fresh and the renewal did nothing (Н3).
export async function ensureMsAuth(acc?: Account | null, ahead = 0): Promise<MsAuth | null> {
  const a = acc || getAccount()
  if (!a || a.kind !== 'microsoft' || !hasTauri()) return null
  if (msTokenFresh(a, ahead)) return authOf(a)
  // The renewal is not cancelled: it keeps going and saves the new token for
  // the next launch.
  const renewed = await withinRenewWait(renewMsAuth(a))
  if (renewed !== 'late') return renewed
  return hasLicenseSession(a) ? authOf(a) : null
}

async function renewMsAuth(a: Account): Promise<MsAuth | null> {
  const fresh = await refreshMsAccount(a)
  if (fresh) return fresh
  if (!hasLicenseSession(a)) return null
  try {
    const v = await msSessionValidate(a.id)
    if (v.status === 'ok') {
      // Real expiry is unknown, so trust the validated token for a short window only.
      patchAccount(a.id, { exp: Date.now() + 15 * 60 * 1000 })
      return authOf(a)
    }
    if (v.status === 'expired') {
      patchAccount(a.id, { exp: 0 })
      await refreshSessionState()
    }
    return null
  } catch {
    // Offline: let the game report the session problem instead of blocking launch.
    return authOf(a)
  }
}

export async function refreshMsAccounts(force = false) {
  if (!hasTauri()) return
  const ms = useAccounts.getState().list.filter((a) => a.kind === 'microsoft')
  for (const a of ms) {
    if (!force && msTokenFresh(a)) continue
    await refreshMsAccount(a)
  }
}
