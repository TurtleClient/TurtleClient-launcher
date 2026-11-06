import { useEffect, useRef, useState } from 'react'
import { useT } from '../../i18n'
import { useAccounts } from '../../state/accounts'
import { uiConfirm } from '../../state/confirm'
import { emptyFriends, serviceError, turtle } from '../../lib/turtleclient'
import type { Friend, FriendList } from '../../lib/turtleclient'
import { Icon } from '../Icon'
import { Head } from '../Head'
import '../../styles/pixel/friends.css'

/** Uses the existing friends page, tabs, gate and row styles. */
export function TurtleFriends({ on }: { on: boolean }) {
  const t = useT()
  const { list, active } = useAccounts()
  const account = list.find(a => a.id === active)
  const [data, setData] = useState<FriendList>(emptyFriends)
  const [connected, setConnected] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [tab, setTab] = useState<'friends' | 'requests'>('friends')
  const generation = useRef(0)
  function handleError(e: unknown) {
    setError(serviceError(e))
    if (/401|connect_required/.test(String(e))) setConnected(false)
  }
  useEffect(() => {generation.current++; setConnected(false); setData(emptyFriends()); setError(''); setBusy(false)}, [active])
  async function refresh() {
    const current = generation.current
    const next = await turtle<FriendList>('turtle_friends', { accountId: active, action: 'list' })
    if (current === generation.current) setData(next)
  }
  useEffect(() => {
    if (!connected) return
    const timer = setInterval(() => void refresh().catch(handleError), 20000)
    return () => clearInterval(timer)
  }, [connected, active])
  async function perform(action: string, uuid?: string) {
    const current = generation.current
    setBusy(true); setError('')
    try {
      if (action === 'connect') {
        await turtle('turtle_friends_connect', { accountId: active })
        if (current !== generation.current) return
        setConnected(true)
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
    {error && <p role="alert" className="faint-note">{t(error)}</p>}
    {!connected ? <div className="card gate-card"><div className="gate-ic"><Icon id="i-users" /></div><div className="gate-title">{t('Играй вместе с друзьями')}</div>
      <p className="faint-note">{t('Turtle: connecting verifies your Minecraft account on our server. The Minecraft token is never stored there.')}</p>
      <p className="faint-note">{t('Turtle: both players must connect once. Friends see you online while this page is open.')}</p>
      <button className="btn md primary gate-btn" disabled={busy || account?.kind !== 'microsoft'} onClick={() => void perform('connect')}>{t(busy ? 'Turtle: connecting…' : 'Turtle: connect Friends')}</button>
      {account?.kind !== 'microsoft' && <p className="faint-note">{t('Turtle: sign in with a Microsoft Minecraft account.')}</p>}
    </div> : <><div className="fr-tabbar"><div className="segs fr-tabs" role="tablist"><button className={'seg' + (tab === 'friends' ? ' on' : '')} role="tab" aria-selected={tab === 'friends'} onClick={() => setTab('friends')}><Icon id="i-users" />{t('Друзья')}<span className="fr-tab-n">{data.friends.length}</span></button><button className={'seg' + (tab === 'requests' ? ' on' : '')} role="tab" aria-selected={tab === 'requests'} onClick={() => setTab('requests')}><Icon id="i-inbox" />{t('Заявки')}<span className="fr-tab-n hot">{data.incoming.length}</span></button></div></div>
      <div className="stack fr-list" data-private>{tab === 'friends' ? data.friends.length ? data.friends.map(f => row(f, 'friend')) : <p className="faint-note">{t('Turtle: no friends yet. Send a request using their Minecraft name.')}</p> : <><div className="fr-cap">{t('Turtle: incoming requests')}</div>{data.incoming.map(f => row(f, 'incoming'))}<div className="fr-cap">{t('Turtle: sent requests')}</div>{data.outgoing.map(f => row(f, 'outgoing'))}</>}</div>
    </>}
  </section>
}
