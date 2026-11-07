import { PxIcon } from './PxIcon'
import { openExt } from '../lib/api'
import { useMarket, useT, type Market } from '../i18n'
import type { AccountAddKind } from '../state/accountAdd'

export type GameAccountKind = Exclude<AccountAddKind, 'millida'>

const BUY_URL: Record<Market, string> = {
  RU: 'https://blups.me/product/minecraft',
  CIS: 'https://www.minecraft.net/get-minecraft',
  INTL: 'https://www.minecraft.net/get-minecraft',
}

export function LicenceBuyLink({ className, track }: { className: string; track: string }) {
  const t = useT()
  const market = useMarket()
  const buy = BUY_URL[market]
  return (
    <a
      className={className}
      href={buy}
      data-track={track + '_buy'}
      onClick={(e) => {
        e.preventDefault()
        openExt(buy)
      }}
    >
      {market === 'RU' ? t('Купить у реселлера Blups') : t('Купить на minecraft.net')}
    </a>
  )
}

export function AccountChoice({ onPick, track }: { onPick: (kind: GameAccountKind) => void; track: string }) {
  const t = useT()
  return (
    <div className="acc-choice">
      <button type="button" className="btn lg primary acc-choice-licence" data-track={track + '_licence'} onClick={() => onPick('microsoft')}>
        <PxIcon name="mc-grass" size={24} />
        {t('Лицензия')}
      </button>
      <LicenceBuyLink className="acc-choice-buy" track={track} />
    </div>
  )
}
