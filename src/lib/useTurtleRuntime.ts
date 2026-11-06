import { useEffect, useState } from 'react'
import { launchTurtleClient } from './turtleLaunch'
import { turtle } from './turtleclient'
import type { TurtleStatus, TurtleUpdateStatus } from './turtleclient'
import { t } from '../i18n'
export function clientUpdateLabel(update?:TurtleUpdateStatus) {
  if(update?.phase==='checking')return t('Turtle: checking client updates…')
  if(update?.phase==='downloading')return t('Turtle: downloading client… {percent}%',{percent:Math.floor(100*update.downloaded/Math.max(1,update.total))})
  if(update?.phase==='installing')return t('Turtle: installing client…')
  return t('Turtle: starting…')
}
export function useTurtleRuntime(enabled: boolean) {
  const [running, setRunning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [clientUpdate,setClientUpdate]=useState<TurtleUpdateStatus | undefined>()
  useEffect(() => {
    if (!enabled) return
    let live = true
    const update = () => turtle<TurtleStatus>('turtle_status').then(s => { if (live) {setRunning(s.running);setClientUpdate(s.update)} }).catch(() => {})
    void update()
    const timer = setInterval(() => void update(), 3000)
    return () => {live = false; clearInterval(timer)}
  }, [enabled])
  return { running, busy:busy || ['checking','downloading','installing'].includes(clientUpdate?.phase || ''),clientUpdate, launch: async () => {setBusy(true); try {await launchTurtleClient()} finally {setBusy(false)}} }
}
