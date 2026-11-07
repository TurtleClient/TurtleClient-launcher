import { useT } from '../../i18n'
import { PlusMark } from './PlusMark'
import { applyPremiumAccent, chooseTheme, PREMIUM_ACCENTS, usePremiumTheme, type PremiumTheme } from '../../lib/premiumTheme'

/**
 * Settings → Appearance: Standard, PLUS and Diamond are freely selectable.
 */
export function ThemeRow() {
  const t = useT()
  const theme = usePremiumTheme((s) => s.theme)
  const opts: { id: PremiumTheme; label: string }[] = [
    { id: 'off', label: t('Стандартная') },
    { id: 'plus', label: 'PLUS' },
    { id: 'diamond', label: 'Diamond' },
  ]
  return (
    <div className="pt-row" role="radiogroup" aria-label={t('Тема лаунчера')}>
      {opts.map((o) => {
        return (
          <button
            key={o.id}
            role="radio"
            aria-checked={theme === o.id}
            aria-label={o.label}
            className={'pt-opt' + (theme === o.id ? ' on' : '')}
            data-track={'ptheme_' + o.id}
            onClick={() => chooseTheme(o.id)}
          >
            {o.id === 'off' ? <i className="pt-std" /> : <PlusMark tier={o.id === 'diamond' ? 'DIAMOND' : 'PLUS'} height={o.id === 'diamond' ? 14 : 18} />}
            {o.id === 'off' ? o.label : null}
          </button>
        )
      })}
    </div>
  )
}

/** The matching gold and diamond accent colors are also available to everyone. */
export function PremiumSwatches({ current, onPick }: { current: string; onPick: (id: string) => void }) {
  return (
    <>
      {PREMIUM_ACCENTS.map((a) => (
        <button
          key={a.id}
          role="radio"
          aria-checked={current === a.id}
          aria-label={a.name}
          data-tip={a.name}
          className={'s2-sw' + (current === a.id ? ' on' : '')}
          style={{ background: a.c }}
          onClick={() => {
            applyPremiumAccent(a.id)
            onPick(a.id)
          }}
        ></button>
      ))}
    </>
  )
}
