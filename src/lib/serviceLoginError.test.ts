import { expect, test } from 'bun:test'
import { serviceLoginErrorText } from './serviceLoginError'

test('Minecraft app approval and other refusals retain their distinct next steps', () => {
  const approval = serviceLoginErrorText('minecraft_app_registration_required')
  const forbidden = serviceLoginErrorText('minecraft_login_forbidden')
  expect(approval).toContain('https://aka.ms/mce-reviewappid')
  expect(approval).toContain('403')
  expect(forbidden).toContain('Minecraft Services')
  expect(forbidden).not.toContain('mce-reviewappid')
})

test('Horizon failures identify the provider and unrelated errors keep their own handler', () => {
  expect(serviceLoginErrorText(new Error('horizon_auth_missing'))).toContain('Horizon Launcher')
  expect(serviceLoginErrorText('horizon_auth_failed')).toContain('Horizon')
  expect(serviceLoginErrorText('horizon_auth_relogin')).toContain('Horizon')
  expect(serviceLoginErrorText('http 500')).toBeUndefined()
})
