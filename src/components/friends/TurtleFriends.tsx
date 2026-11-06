import { useEffect, useRef, useState } from 'react'
import { useT } from '../../i18n'
import { useAccounts } from '../../state/accounts'
import { uiConfirm } from '../../state/confirm'
import { serviceError, turtle } from '../../lib/turtleclient'
import type { Friend } from '../../lib/turtleclient'
import { turtleFriendsConnection, useTurtleFriends } from '../../state/turtleFriends'
import { Icon } from '../Icon'
import { Head } from '../Head'
import '../../styles/pixel/friends.css'

/** Uses the existing friends page, tabs, gate and row styles. */
export function TurtleFriends({ on }: { on: boolean }) {
  const t = useT()
  const { list, active } = useAccounts()
  const account = list.find(a => a.id === active)
  const connection = useTurtleFriends()
  const connected = connection.accountId === account?.id && connection.connected
  const data = connection.data
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [tab, setTab] = useState<'friends' | 'requests'>('friends')
  const generation = useRef(0)
  function handleError(e: unknown) {
    setError(serviceError(e))
  }
  useEffect(() => {generation.current++; setError(''); setBusy(false)}, [active])
  async function refresh() {
    await turtleFriendsConnection.refreshAfterChange()
  }
  async function perform(action: string, uuid?: string) {
    const current = generation.current
    setBusy(true); setError('')
    try {
      if (action === 'connect') {
        turtleFriendsConnection.select(account?.kind === 'microsoft' ? account.id : null)
      } else await turtle('turtle_friends', { accountId: active, action, uuid, name })
      if (current !== generation.current) return
      await refresh()
      if (action === 'request') setName('')
    } catch (e) {if (current === generation.current) handleError(e)}
    finally {if (current === generation.current) setBusy(false)}
  }
  async function remove(uuid: string) {
    if (await uiConfirm(t('Turtle: remove this friend?'))) await perform('remove', uuid)
  }
  function row(friend: Friend, kind: 'friend' | 'incoming' | 'outgoing') {
    return <div className="fr-row" key={friend.uuid}>
      <span className="fr-ava"><Head nick={friend.name} size={40} /></span>
      <span className="fr-body"><span className="fr-nick">{friend.name}</span><span className={'fr-status' + (friend.online ? ' on' : '')}>{kind === 'friend' ? t(friend.online ? 'Turtle: online' : 'Turtle: offline') : t(kind === 'incoming' ? 'Turtle: friend request' : 'Turtle: awaiting acceptance')}</span></span>
      <span className="fr-acts">{kind === 'incoming' ? <><button className="btn md primary" disabled={busy} onClick={() => void perform('accept', friend.uuid)}>{t('Turtle: accept')}</button><button className="btn md secondary" disabled={busy} onClick={() => void perform('reject', friend.uuid)}>{t('Turtle: decline')}</button></> : <button className="btn sm secondary" disabled={busy} onClick={() => void (kind === 'friend' ? remove(friend.uuid) : perform('remove', friend.uuid))}>{t(kind === 'friend' ? 'Turtle: remove friend' : 'Turtle: cancel request')}</button>}</span>
    </div>
  }
  return <section className={'screen' + (on ? ' on' : '')} id="s-friends">
    <div className="page-head"><h1>{t('Друзья')}</h1>{connected && <form className="right" onSubmit={e => {e.preventDefault(); void perform('request')}}><div className="input sm fr-q"><Icon id="i-search" /><input aria-label={t('Turtle: Minecraft username')} placeholder={t('Turtle: Minecraft username')} value={name} maxLength={16} pattern="[A-Za-z0-9_]{1,16}" required onChange={e => setName(e.target.value)} /></div><button className="btn sm primary" disabled={busy}>{t('Turtle: send request')}</button></form>}</div>
    {(error || connection.error) && <p role="alert" className="faint-note">{t(error || serviceError(connection.error))}</p>}
    {!connected ? <div className="card gate-card"><div className="gate-ic"><Icon id="i-users" /></div><div className="gate-title">{t('Играй вместе с друзьями')}</div>
      <p className="faint-note">{t('Turtle: connecting verifies your Minecraft account on our server. The Minecraft token is never stored there.')}</p>
      <p className="faint-note">{t('Turtle: Friends connects automatically and stays online while the launcher is running.')}</p>
      <button className="btn md primary gate-btn" disabled={busy || connection.connecting || account?.kind !== 'microsoft'} onClick={() => void perform('connect')}>{t(busy || connection.connecting ? 'Turtle: connecting…' : 'Turtle: connect Friends')}</button>
      {account?.kind !== 'microsoft' && <p className="faint-note">{t('Turtle: sign in with a Microsoft Minecraft account.')}</p>}
    </div> : <><div className="fr-tabbar"><div className="segs fr-tabs" role="tablist"><button className={'seg' + (tab === 'friends' ? ' on' : '')} role="tab" aria-selected={tab === 'friends'} onClick={() => setTab('friends')}><Icon id="i-users" />{t('Друзья')}<span className="fr-tab-n">{data.friends.length}</span></button><button className={'seg' + (tab === 'requests' ? ' on' : '')} role="tab" aria-selected={tab === 'requests'} onClick={() => setTab('requests')}><Icon id="i-inbox" />{t('Заявки')}<span className="fr-tab-n hot">{data.incoming.length}</span></button></div></div>
      <div className="stack fr-list" data-private>{tab === 'friends' ? data.friends.length ? data.friends.map(f => row(f, 'friend')) : <p className="faint-note">{t('Turtle: no friends yet. Send a request using their Minecraft name.')}</p> : <><div className="fr-cap">{t('Turtle: incoming requests')}</div>{data.incoming.map(f => row(f, 'incoming'))}<div className="fr-cap">{t('Turtle: sent requests')}</div>{data.outgoing.map(f => row(f, 'outgoing'))}</>}</div>
    </>}
  </section>
}
