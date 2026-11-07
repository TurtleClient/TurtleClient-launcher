import { hasTauri } from '../ipc/tauri'
import { setAppIcon } from '../ipc/commands'
import { writePref } from './prefs'
import type { AppIconId } from './appIconRules'

export { APP_ICONS, effectiveIcon, iconUnlocked, isIconId } from './appIconRules'
export type { AppIconDef, AppIconId, IconAccess } from './appIconRules'

export function chosenIcon(): AppIconId { return 'default' }

export async function applyAppIcon(_id: AppIconId): Promise<void> {
  if (hasTauri()) await setAppIcon('default').catch(() => {})
}

export function pickAppIcon(_id: AppIconId) {
  writePref('m-app-icon', 'default')
  return applyAppIcon('default')
}

export async function syncAppIcon(): Promise<void> {
  await pickAppIcon('default')
}
