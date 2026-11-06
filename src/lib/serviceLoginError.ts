// Loaded only when a provider-specific sign-in error actually occurs.
import { t } from '../i18n'

export function serviceLoginErrorText(error: unknown): string | undefined {
  const raw = String((error as { message?: string } | null)?.message ?? error ?? '').replace(/^Error:\s*/, '').trim()
  if (raw === 'horizon_auth_missing') return t('Temporary sign-in requires the Horizon Launcher. Please install Horizon first.')
  if (raw === 'horizon_auth_failed') return t('Sign-in through Horizon failed or was cancelled. Please try again.')
  if (raw === 'horizon_auth_relogin') return t('Your Horizon session needs a new sign-in. Please sign in again.')
  if (raw === 'minecraft_app_registration_required') {
    return t('Minecraft rejected this launcher’s app registration (HTTP 403). The launcher developer must request Minecraft API access: https://aka.ms/mce-reviewappid')
  }
  if (raw === 'minecraft_login_forbidden') {
    return t('Minecraft Services refused the login (HTTP 403). Microsoft sign-in succeeded, but Minecraft access was denied.')
  }
}
