import { useLayoutEffect, useRef, useState } from 'react'
import { lobbyFigureBox } from '../../lib/lobbyFrame'
import { stageGeom } from '../../lib/lobbyStill'
import { FlatFigure } from '../character/FlatFigure'
import { Nametag } from '../character/Nametag'

/**
 * Плоская фигурка скина ровно там, где встанет 3D: ноги на той же линии, рост тот же
 * (lib/lobbyFrame). Иначе смена заглушки на 3D (LobbyFigure) или 3D на лёгкую графику
 * (LobbyCharacter) выглядела прыжком фигуры. Кладётся в .lobby-char — по нему и меряется.
 */
export function FlatStand({ url, slim, onReady, nick }: { url?: string; slim?: boolean; onReady?: () => void; nick?:string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<{ top: number; height: number; width:number } | null>(null)
  useLayoutEffect(() => {
    const stage = ref.current?.parentElement
    if (!stage) return
    const place = () => {
      const g = stageGeom(stage)
      const { feet, tall } = lobbyFigureBox(g.h, g.top, g.scene)
      setBox({ top: feet - tall, height: tall, width:g.w })
    }
    place()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(place)
    ro.observe(stage)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={ref} className="lobby-flat-stand" style={box ? { top: box.top, height: box.height } : { visibility: 'hidden' }}>
      {nick && box && <Nametag nick={nick} at={{x:box.width/2,y:-8}} own />}
      {url && <FlatFigure url={url} slim={slim} onReady={onReady} />}
    </div>
  )
}
