import { useEffect, useState } from 'react'
import { useT } from '../i18n'
import { turtle, serviceError } from '../lib/turtleclient'
import type { TurtleSettings, TurtleStatus } from '../lib/turtleclient'
import { Group, Row } from './SetKit'
import { setScreen, showToast } from '../state/ui'
import { useLobby } from '../state/lobbyMode'
import { clientUpdateLabel, useTurtleRuntime } from '../lib/useTurtleRuntime'

export function TurtleRuntimeSettings() {
  const t = useT()
  const [config, setConfig] = useState<TurtleSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const runtime=useTurtleRuntime(true)
  useEffect(() => { void turtle<TurtleStatus>('turtle_status').then(s => setConfig(current=>({...s.settings,resources:current?.resources || s.settings.resources,game_dir:current?.game_dir || s.settings.game_dir}))).catch(() => {}) }, [runtime.clientUpdate?.phase])
  async function checkUpdates() {
    setBusy(true)
    try {await turtle('turtle_client_update')}
    catch(error){showToast(t(serviceError(error)),'error')}
    finally {setBusy(false)}
  }
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
    <Row title={t('Turtle: automatic client updates')} hint={runtime.busy?clientUpdateLabel(runtime.clientUpdate):runtime.clientUpdate?.version?t('Turtle: client version {version}',{version:runtime.clientUpdate.version}):t('Turtle: checked whenever the launcher starts.')}>
      <button className="btn sm secondary" disabled={busy || runtime.busy} onClick={()=>void checkUpdates()}>{t('Turtle: check for client updates')}</button>
    </Row>
    {config && <Row title={t('Turtle: executable')} hint={config.executable} />}
    {config && (['resources', 'game_dir'] as const).map(field => <Row key={field} title={t(field === 'resources' ? 'Turtle: resources' : 'Turtle: game folder')} hint={config[field]}>
      <button className="btn sm secondary" onClick={() => void browse(field)}>{t('Turtle: browse')}</button>
    </Row>)}
    <Row title={t('Turtle: native client')} hint={t('Turtle: the client updates automatically. Select your prepared Minecraft resources and game folder.')}>
      <button className="btn sm primary" disabled={!config || busy || runtime.busy} onClick={() => void save()}>{t('Turtle: save configuration')}</button>
    </Row>
  </Group>
}
