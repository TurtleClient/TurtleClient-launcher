import { getAccount } from '../state/accounts'
import { openSettings, showToast } from '../state/ui'
import { t } from '../i18n'
import { serviceError, turtle } from './turtleclient'
let starting = false
export async function launchTurtleClient() {
  if (starting) return
  const account = getAccount()
  if (!account || account.kind !== 'microsoft') { showToast(t('Turtle: sign in with a Microsoft Minecraft account.'), 'error'); return }
  starting = true
  try { await turtle('turtle_launch', { accountId: account.id, nick: account.nick }) }
  catch (e) {
    showToast(t(serviceError(e)), 'error')
    if (/executable|resources|game_dir/.test(String(e))) openSettings('game')
  } finally { starting = false }
}
