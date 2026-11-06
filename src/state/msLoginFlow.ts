// Interactive sign-in is loaded with the account dialog, not the startup renewal code.
import { create } from 'zustand'
import { hasTauri } from '../ipc/tauri'
import { msDeviceCancel, msDevicePoll, msDeviceStart, msSessionCommit, openUrl } from '../ipc/commands'
import { useAccounts } from './accounts'
import { showToast } from './ui'
import { enterApp } from '../lib/session'
import { refreshSessionState } from '../lib/secure'
import { copyText } from '../lib/clipboard'
import { copyLink } from '../lib/links'
import { apiErrorText } from '../lib/apiError'
import { track, trackFailure } from '../lib/telemetry'
import { t } from '../i18n'
import { CORE_NO_CONNECTION } from '../lib/coreErrors'
import { expiresAt } from './msLogin'

interface MsLoginState {
  busy: boolean
  provider: 'horizon' | 'microsoft'
  userCode: string
  verifyUrl: string
  hint: string
  set: (patch: Partial<MsLoginState>) => void
}

const MS_VERIFY_URL = 'https://www.microsoft.com/link'
const MAX_POLL_NET_FAILS = 6

export const useMsLogin = create<MsLoginState>((set) => ({
  busy: false,
  provider: 'microsoft',
  userCode: '',
  verifyUrl: '',
  hint: '',
  set: (patch) => set(patch as MsLoginState),
}))

let pollTimer: ReturnType<typeof setTimeout> | null = null
let flowSeq = 0
let activeDeviceCode: string | null = null

function reset(hint?: string) {
  activeDeviceCode = null
  flowSeq++
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
  useMsLogin.getState().set({ busy: false, provider: 'microsoft', userCode: '', verifyUrl: '', hint: hint || '' })
}

export function cancelMsLogin() {
  const code = activeDeviceCode
  reset()
  if (code) cancelDevice(code)
}

function cancelDevice(code: string) {
  void msDeviceCancel(code).catch((e) => trackFailure('login', e, { provider: 'microsoft', step: 'cancel' }))
}

export function openMsVerifyPage() {
  const url = useMsLogin.getState().verifyUrl || MS_VERIFY_URL
  if (hasTauri()) openUrl(url)
  else window.open(url, '_blank')
}

export function copyMsVerifyLink() {
  void copyLink(useMsLogin.getState().verifyUrl || MS_VERIFY_URL)
}

export async function copyMsCode() {
  const code = useMsLogin.getState().userCode
  if (!code) {
    showToast(t('Код ещё не пришёл — подожди пару секунд'))
    return
  }
  showToast((await copyText(code)) ? t('Код скопирован: {code}', { code }) : t('Скопируй код вручную: {code}', { code }))
}

const maskNick = (e: unknown, nick: string) => (nick ? String(e).split(nick).join('<nick>') : String(e))

async function loginErrorText(error: unknown, fallback: string): Promise<string> {
  if (/^(Error:\s*)?(horizon_auth_|minecraft_)/.test(String(error))) {
    const { serviceLoginErrorText } = await import('../lib/serviceLoginError')
    return serviceLoginErrorText(error) ?? apiErrorText(error, fallback)
  }
  return apiErrorText(error, fallback)
}

// Microsoft refuses a device code it already redeemed or dropped; only a fresh code can finish the sign-in.
const SPENT_DEVICE_CODE = /AADSTS70000\b/

export async function startMsLogin(afterSpentCode = false) {
  const s = useMsLogin.getState()
  if (s.busy) {
    openMsVerifyPage()
    return
  }
  if (!hasTauri()) {
    showToast(t('Вход по лицензии доступен только в приложении лаунчера'), 'error')
    return
  }
  s.set({ busy: true, hint: t('Запрашиваем код у Microsoft…') })
  const flow = ++flowSeq
  let init
  try {
    try {
      init = await msDeviceStart()
    } catch (e) {
      if (!String(e).startsWith(CORE_NO_CONNECTION)) throw e
      await new Promise((r) => setTimeout(r, 1500))
      init = await msDeviceStart()
    }
  } catch (e) {
    if (flow !== flowSeq) return
    trackFailure('login', e, { provider: 'microsoft', step: 'start' })
    const message = await loginErrorText(e, t('Microsoft не ответила — повтори попытку'))
    if (flow !== flowSeq) return
    reset(message)
    showToast('Microsoft: ' + message, 'error')
    return
  }
  if (flow !== flowSeq) { cancelDevice(init.device_code); return }
  activeDeviceCode = init.device_code
  const url = init.verification_uri || MS_VERIFY_URL
  useMsLogin.getState().set({
    provider: init.provider === 'horizon' ? 'horizon' : 'microsoft',
    userCode: init.user_code,
    verifyUrl: url,
    hint: afterSpentCode
      ? t('Microsoft не приняла прошлый код — введи новый код на странице Microsoft.')
      : t('Введи код на странице Microsoft и подтверди вход.'),
  })
  openMsVerifyPage()
  void copyText(init.user_code).then((copied) => {
    if (!copied || useMsLogin.getState().userCode !== init.user_code) return
    useMsLogin.getState().set({ hint: t('Код скопирован — вставь его на странице Microsoft и подтверди вход.') })
  })

  const intervalMs = Math.max(2, init.interval || 5) * 1000
  const deadline = Date.now() + 15 * 60 * 1000
  let netFails = 0

  const poll = async () => {
    if (flow !== flowSeq) return
    if (Date.now() > deadline) {
      reset(t('Время вышло — начни вход заново.'))
      return
    }
    let r
    try {
      r = await msDevicePoll(init.device_code)
      netFails = 0
    } catch (e) {
      if (flow !== flowSeq) return
      // Обрыв соединения посреди ожидания не должен убивать вход: код устройства жив 15 минут.
      if (String(e).startsWith(CORE_NO_CONNECTION) && ++netFails <= MAX_POLL_NET_FAILS) {
        trackFailure('login', e, { provider: 'microsoft', step: 'poll_retry', attempt: netFails })
        pollTimer = setTimeout(() => void poll(), intervalMs)
        return
      }
      trackFailure('login', e, { provider: 'microsoft', step: 'poll', after_spent: afterSpentCode })
      if (SPENT_DEVICE_CODE.test(String(e)) && !afterSpentCode) {
        reset()
        void startMsLogin(true)
        return
      }
      const message = await loginErrorText(e, t('Microsoft не ответила — повтори попытку'))
      if (flow !== flowSeq) return
      reset(message)
      showToast('Microsoft: ' + message, 'error')
      return
    }
    if (flow !== flowSeq) return
    if (r.status === 'pending') {
      pollTimer = setTimeout(() => void poll(), intervalMs)
      return
    }
    const acc = useAccounts.getState().add({
      nick: r.nick,
      kind: 'microsoft',
      uuid: r.uuid,
      xuid: r.xuid,
      exp: expiresAt(r.expires_in),
    })
    try {
      await msSessionCommit(init.device_code, acc.id)
    } catch (e) {
      useAccounts.getState().remove(acc.id)
      trackFailure('login', maskNick(e, r.nick), { provider: 'microsoft', step: 'commit' })
      reset(String(e))
      showToast('Microsoft: ' + e, 'error')
      return
    }
    await refreshSessionState()
    reset()
    enterApp()
    track('account_link', { kind: 'microsoft' })
    showToast(t('Лицензия подключена: {nick}', { nick: r.nick }))
  }
  pollTimer = setTimeout(() => void poll(), intervalMs)
}
