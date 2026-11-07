import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { PxIcon } from '../components/PxIcon'
import { closeModal, useUi } from '../state/ui'
import { useAccounts } from '../state/accounts'
import { useAccountAdd, type AccountAddKind } from '../state/accountAdd'
import { cancelMsLogin, copyMsCode, copyMsVerifyLink, openMsVerifyPage, startMsLogin, useMsLogin } from '../state/msLoginFlow'
import { backdropClose } from '../lib/dismiss'
import { useT } from '../i18n'
import { SecurityInfo } from './SecurityInfo'
import { AccountChoice } from '../components/AccountChoice'

type Kind = AccountAddKind

const MC_ICON = <PxIcon name="mc-grass" size={24} />

export function KindPanel({ kind: _kind, onBack, onDone, onSafety }: { kind: Kind; onBack: () => void; onDone: () => void; onSafety: () => void }) {
  const t = useT()
  const ms = useMsLogin()
  const count = useAccounts((s) => s.list.length)
  const startCount = useRef(count)
  const doneRef = useRef(false)
  const doneCb = useRef(onDone)
  doneCb.current = onDone

  useEffect(() => {
    if (doneRef.current || count === startCount.current) return
    doneRef.current = true
    doneCb.current()
  }, [count])

  const busy = ms.busy
  const code = ms.userCode
  const hint = ms.hint

  return (
    <>
      <button
        className="btn sm ghost"
        style={{ alignSelf: 'flex-start', marginBottom: '12px' }}
        onClick={() => {
          cancelMsLogin()
          onBack()
        }}
      >
        <Icon id="i-chev-l" />
        {t('Назад')}
      </button>
      <div className="acc-opt" style={{ cursor: 'default' }}>
        <span className="acc-opt-ic">{MC_ICON}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <b style={{ display: 'block', fontSize: '13.5px', fontWeight: 650 }}>{t('Лицензия Minecraft')}</b>
          <span style={{ fontSize: '12px', color: 'var(--m-fg-subtle)' }}>{t('Вход через Microsoft')}</span>
        </span>
      </div>

      <div style={{ marginTop: '16px' }}>
        {busy && code ? (
          <>
            {ms.provider === 'horizon' ? (
              <p className="faint-note">{t('Temporary sign-in via Horizon. Confirm this code on Microsoft’s page.')}</p>
            ) : null}
            <button
              className="acc-code"
              aria-label={t('Скопировать код')}
              onClick={() => void copyMsCode()}
            >
              <span>{code}</span>
              <Icon id="i-copy" />
            </button>
            <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
              <button
                className="btn sm secondary"
                style={{ flex: 1 }}
                onClick={() => openMsVerifyPage()}
              >
                {t('Открыть страницу')}
              </button>
              <button className="btn sm ghost" onClick={() => copyMsVerifyLink()}>
                {t('Копировать ссылку')}
              </button>
              <button className="btn sm ghost" onClick={() => cancelMsLogin()}>
                {t('Отмена')}
              </button>
            </div>
          </>
        ) : (
          <button
            className="btn md primary"
            style={{ width: '100%' }}
            disabled={busy}
            onClick={() => void startMsLogin()}
          >
            <Icon id="i-mo-shield" />
            {busy ? t('Ждём подтверждения…') : t('Войти через Microsoft')}
          </button>
        )}

          <div className="faint-note" style={{ marginTop: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <Icon id="i-shield" />
            <span>{t('Полностью безопасно. Убедись сам:')}</span>
            <a
              href="https://millida.net/launcher/bezopasnost"
              onClick={(e) => {
                e.preventDefault()
                onSafety()
              }}
            >
              {t('Как это работает?')}
            </a>
          </div>
        {hint ? (
          <p className="faint-note" style={{ marginTop: '12px', lineHeight: 1.5 }}>
            {hint}
          </p>
        ) : null}
      </div>
    </>
  )
}

export function AccountAddModal() {
  const t = useT()
  const modal = useUi((s) => s.modals.accModal)
  const preset = useAccountAdd((s) => s.kind)
  const [kind, setKind] = useState<Kind | null>(null)
  const [safety, setSafety] = useState(false)

  useEffect(() => {
    if (modal.open) {
      setKind('microsoft')
      return
    }
    setKind(null)
    setSafety(false)
    useAccountAdd.setState({ kind: null })
  }, [modal.open, preset])

  useEffect(() => {
    if (!modal.open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal('accModal')
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [modal.open])

  if (!modal.open) return null
  const close = () => closeModal('accModal')

  return (
    <div
      className={'modal-bg' + (modal.open ? ' open' : '') + (modal.vis ? ' vis' : '')}
      id="accModal"
      {...backdropClose(close)}
    >
      <div className={'modal ' + (safety ? 'mw-md' : 'mw-sm')} style={{ display: 'flex', flexDirection: 'column' }}>
        <h3>{safety ? t('Как это работает') : t('Добавить аккаунт')}</h3>

        <div style={{ marginTop: '18px', display: 'flex', flexDirection: 'column' }}>
          {safety ? (
            <SecurityInfo onBack={() => setSafety(false)} />
          ) : kind ? (
            <KindPanel
              kind={kind}
              onBack={() => (preset ? close() : setKind(null))}
              onDone={close}
              onSafety={() => setSafety(true)}
            />
          ) : (
            <AccountChoice track="account_add" onPick={setKind} />
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '22px' }}>
          <button className="btn md secondary" data-sound="close" onClick={close}>
            {t('Закрыть')}
          </button>
        </div>
      </div>
    </div>
  )
}
