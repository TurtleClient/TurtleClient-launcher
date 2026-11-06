import { useEffect, useState } from 'react'
import { useT } from '../i18n'
import { turtle, serviceError } from '../lib/turtleclient'
import type { TurtleSettings, TurtleStatus } from '../lib/turtleclient'
import { Group, Row } from './SetKit'
import { setScreen, showToast } from '../state/ui'
import { useLobby } from '../state/lobbyMode'

export function TurtleRuntimeSettings() {
  const t = useT()
  const [config, setConfig] = useState<TurtleSettings | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { void turtle<TurtleStatus>('turtle_status').then(s => setConfig(s.settings)).catch(() => {}) }, [])
  async function browse(field: keyof TurtleSettings) {
    const path = await turtle<string | null>('turtle_pick_path', { field }).catch(() => null)
    if (path) setConfig(c => c && ({ ...c, [field]: path }))
  }
  async function save() {
    setBusy(true)
    try { await turtle('turtle_configure', { settings: config }); showToast(t('Turtle: configuration saved.')) }
    catch (e) { showToast(t(serviceError(e)), 'error') }
    finally { setBusy(false) }
  }
  return <Group title="TurtleClient">
    <Row title={t('Turtle: play TurtleClient')}>
      <button className="btn sm primary" onClick={() => {useLobby.getState().pickNative(); setScreen('play')}}>{t('Turtle: select in lobby')}</button>
    </Row>
    {config && (['executable', 'resources', 'game_dir'] as const).map(field => <Row key={field} title={t(field === 'executable' ? 'Turtle: executable' : field === 'resources' ? 'Turtle: resources' : 'Turtle: game folder')} hint={config[field]}>
      <button className="btn sm secondary" onClick={() => void browse(field)}>{t('Turtle: browse')}</button>
    </Row>)}
    <Row title={t('Turtle: native client')} hint={t('Turtle: select the built client and prepared Minecraft 26.3 resources.')}>
      <button className="btn sm primary" disabled={!config || busy} onClick={() => void save()}>{t('Turtle: save configuration')}</button>
    </Row>
  </Group>
}
