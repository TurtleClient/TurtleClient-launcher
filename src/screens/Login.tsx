import { BRAND } from '../lib/branding'
import { enterApp } from '../lib/session'
import { useEffect, useRef, useState } from 'react'
import { PxIcon } from '../components/PxIcon'
import { LicenceBuyLink, type GameAccountKind } from '../components/AccountChoice'
import { KindPanel } from '../modals/AccountAdd'
import { LangPicker } from '../components/LangPicker'
import { useT } from '../i18n'
import { finishFirstRun } from '../state/firstRun'
import { isGameAccountKind, useAccounts } from '../state/accounts'
import { refreshGameNick } from '../state/gameNick'
import { openExt } from '../lib/api'
import { PixelField } from '../components/lobby/PixelField'
import '../styles/pixel/login.css'

const SAFETY_URL = 'https://millida.net/launcher/bezopasnost'

function GameAccountStep() {
  const t = useT()
  const [kind, setKind] = useState<GameAccountKind | null>(null)
  const added = useAccounts((s) => s.list.some((a) => isGameAccountKind(a.kind)))

  useEffect(() => {
    void refreshGameNick()
  }, [])

  useEffect(() => {
    if (added) {
      finishFirstRun()
      if (!BRAND.services) enterApp()
    }
  }, [added])

  return (
    <div className="login-form lg2-card">
      <LangPicker className="lg2-lang" />
      <div className="login-logo">
        <img src="/turtleclient-icon.svg" alt="" width={56} height={56} />
      </div>
      <h1>{t('Игровой аккаунт')}</h1>
      <p className="sub">{t('Как будешь играть?')}</p>
      {kind ? (
        <KindPanel kind={kind} onBack={() => setKind(null)} onDone={() => undefined} onSafety={() => openExt(SAFETY_URL)} />
      ) : (
        <>
          <button className="btn lg primary lg2-main" data-track="first_run_licence" onClick={() => setKind('microsoft')}>
            <PxIcon name="mc-grass" size={24} />
            {t('Лицензия')}
          </button>
          <LicenceBuyLink className="lg2-buy" track="first_run" />
        </>
      )}
    </div>
  )
}

export function Login({ on }: { on: boolean }) {
  const artRef = useRef<HTMLImageElement>(null)

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const r = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width - 0.5) * 14,
      y = ((e.clientY - r.top) / r.height - 0.5) * 8
    if (artRef.current) artRef.current.style.transform = 'translate(' + x + 'px,' + y + 'px)'
  }

  return (
    <div id="scr-login" className={'lg2' + (on ? ' on' : '')} onMouseMove={onMove}>
      {/* Сцена лобби фоном (правка владельца 23.09.2026: экраны входа были
          в старом UI со старыми персонажами). */}
      <PixelField on={on} />
      <div className="login-wrap lg2-wrap">
        <GameAccountStep />
        <div className="login-art lg2-art">
          <img className="lg2-emblem" src="/turtleclient-icon.svg" alt="" />
          <img ref={artRef} src="/turtleclient-wordmark.png" alt="TurtleClient" />
          <span className="lg2-shadow" aria-hidden="true" />
        </div>
      </div>
    </div>
  )
}
