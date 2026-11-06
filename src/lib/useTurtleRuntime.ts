import { useEffect, useState } from 'react'
import { launchTurtleClient } from './turtleLaunch'
import { turtle } from './turtleclient'
import type { TurtleStatus } from './turtleclient'
export function useTurtleRuntime(enabled: boolean) {
  const [running, setRunning] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!enabled) return
    let live = true
    const update = () => turtle<TurtleStatus>('turtle_status').then(s => { if (live) setRunning(s.running) }).catch(() => {})
    void update()
    const timer = setInterval(() => void update(), 3000)
    return () => {live = false; clearInterval(timer)}
  }, [enabled])
  return { running, busy, launch: async () => {setBusy(true); try {await launchTurtleClient()} finally {setBusy(false)}} }
}
