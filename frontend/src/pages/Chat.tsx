import { useEffect, useMemo, useRef, useState } from 'react'
import { useMe } from '../store'
import { Link, useRoute } from '../router'
import { Avatar, Empty, FilePick, Highlight, Icon } from '../components/ui'
import type { Attachment, Message, User } from '../types'
import { isStaff } from '../lib/rules'
import { MIN, checkFile, fmtDateTime, fmtDay, fmtDayLong, fmtSize, fmtTime, firstName, now, plural, startOfDay, uid } from '../lib/util'
import { canRead, canWrite, deleteMessage, editMessage, react, sendMessage } from '../data/actions'

const EMOJI = ['👍', '🔥', '✅', '😂', '👀', '🙏']

export default function Chat() {
  const { me, state } = useMe()
  const { segments } = useRoute()
  const staff = isStaff(me)
  const base = segments[0] // chat | channels
  const team = state.teams.find((t) => t.id === me.teamId)
  const visibleChannels = state.channels.filter((c) => canRead(state, me, c.id))
  const channelId = segments[1] ?? (staff ? visibleChannels.find((c) => c.kind === 'team')?.id : team?.channelId) ?? 'ch_general'
  const channel = state.channels.find((c) => c.id === channelId)
  const [q, setQ] = useState('')
  const [date, setDate] = useState('')
  const [author, setAuthor] = useState('')
  const [everywhere, setEverywhere] = useState(false)
  const [thread, setThread] = useState<string | null>(null)
  useEffect(() => {
    setThread(null)
  }, [channelId])

  if (!channel || !canRead(state, me, channel.id))
    return (
      <div className="card">
        <Empty>Канал недоступен. Студенты видят только каналы своей команды и общие каналы курса.</Empty>
      </div>
    )

  const chTeam = state.teams.find((t) => t.id === channel.teamId)
  const members = chTeam ? chTeam.memberIds.map((id) => state.users.find((u) => u.id === id)!) : []
  const lastSeen = (chId: string) => state.messages.filter((m) => m.channelId === chId && (staff || !m.deletedAt)).reduce((a, m) => Math.max(a, m.at), 0)
  const groups: { title: string; list: typeof visibleChannels }[] = [
    { title: 'Курс', list: visibleChannels.filter((c) => c.kind !== 'team') },
    { title: staff ? `Команды · ${visibleChannels.filter((c) => c.kind === 'team').length}` : 'Моя команда', list: visibleChannels.filter((c) => c.kind === 'team') },
  ]

  return (
    <div className="chat-layout">
      <div className="channels">
        {groups.map((g) => (
          <div key={g.title} style={{ marginBottom: 10 }}>
            <div className="label-caps" style={{ margin: '6px 10px' }}>
              {g.title}
            </div>
            {g.list.map((c) => (
              <Link key={c.id} to={`/${base}/${c.id}`} className={c.id === channelId ? 'active' : ''}>
                <span>
                  {c.kind === 'announcements' ? '📣 ' : '# '}
                  {c.name}
                </span>
                <span className="tiny muted">{lastSeen(c.id) ? (startOfDay(lastSeen(c.id)) === startOfDay(now()) ? fmtTime(lastSeen(c.id)) : fmtDay(lastSeen(c.id))) : ''}</span>
              </Link>
            ))}
          </div>
        ))}
      </div>
      <div className="chat">
        <div className="chat-head">
          <div>
            <h2>
              {channel.kind === 'announcements' ? '📣 ' : '# '}
              {channel.name}
            </h2>
            <div className="small muted">
              {chTeam
                ? `${members.length} ${plural(members.length, 'участник', 'участника', 'участников')} · ${members.map((m) => firstName(m.name)).join(', ')}`
                : channel.kind === 'announcements'
                  ? 'Пишут преподаватель и ассистент · читают все'
                  : 'Общий канал курса'}
            </div>
          </div>
          <div className="row wrap">
            <div className="search" style={{ width: 200 }}>
              <Icon name="search" size={15} />
              <input className="input input-sm" style={{ paddingLeft: 32, height: 36 }} placeholder={everywhere ? 'Поиск по всем каналам' : 'Поиск по каналу'} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            {(q || date || author) && (
              <>
                <select className="select select-sm" style={{ width: 140, height: 36 }} value={author} onChange={(e) => setAuthor(e.target.value)}>
                  <option value="">Любой автор</option>
                  {(chTeam && !everywhere ? members : state.users.filter((u) => u.courseIds.includes(state.course.id))).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
                <input className="input input-sm" type="date" style={{ width: 140, height: 36 }} value={date} onChange={(e) => setDate(e.target.value)} />
              </>
            )}
            {!q && !date && (
              <button className="btn btn-sm" style={{ height: 36 }} onClick={() => setQ(' ')} title="Фильтр по автору и дате">
                <Icon name="filter" size={14} />
              </button>
            )}
            {staff && (
              <label className="row tiny" title="Преподаватель ищет по всем каналам сразу">
                <input type="checkbox" checked={everywhere} onChange={(e) => setEverywhere(e.target.checked)} /> все каналы
              </label>
            )}
          </div>
        </div>
        <div className="chat-note">
          <Icon name="eye" size={15} />
          Переписку видит преподаватель. Удалённые и отредактированные сообщения сохраняются в истории.
        </div>
        <div className="chat-split">
          <div className="chat-main">
            {q.trim() || date || author ? (
              <SearchResults q={q.trim()} date={date} author={author} channelIds={everywhere ? visibleChannels.map((c) => c.id) : [channel.id]} base={base} onOpenThread={setThread} />
            ) : (
              <Feed channelId={channel.id} onOpenThread={setThread} />
            )}
            <Composer channelId={channel.id} members={chTeam ? members : state.users.filter((u) => u.courseIds.includes(state.course.id))} name={channel.name} />
          </div>
          {thread && <Thread parentId={thread} onClose={() => setThread(null)} />}
        </div>
      </div>
    </div>
  )
}

function visibleTo(me: User, m: Message) {
  return isStaff(me) || !m.deletedAt
}

function Feed({ channelId, onOpenThread }: { channelId: string; onOpenThread: (id: string) => void }) {
  const { me, state } = useMe()
  const ref = useRef<HTMLDivElement>(null)
  const list = useMemo(() => state.messages.filter((m) => m.channelId === channelId && !m.parentId && visibleTo(me, m)).sort((a, b) => a.at - b.at), [state.messages, channelId, me])
  const count = list.length
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight })
  }, [count, channelId])
  let lastDay = 0
  const today = startOfDay(now())
  return (
    <div className="chat-body" ref={ref}>
      {!list.length && <Empty>Сообщений пока нет. Начните обсуждение!</Empty>}
      {list.map((m) => {
        const d = startOfDay(m.at)
        const sep = d !== lastDay
        lastDay = d
        return (
          <div key={m.id}>
            {sep && <div className="day-sep">{d === today ? `Сегодня, ${fmtDayLong(m.at)}` : d === today - 86_400_000 ? `Вчера, ${fmtDayLong(m.at)}` : fmtDayLong(m.at)}</div>}
            <MessageView m={m} onOpenThread={onOpenThread} />
          </div>
        )
      })}
    </div>
  )
}

function SearchResults({ q, date, author, channelIds, base, onOpenThread }: { q: string; date: string; author: string; channelIds: string[]; base: string; onOpenThread: (id: string) => void }) {
  const { me, state } = useMe()
  const s = q.toLowerCase()
  const res = state.messages
    .filter(
      (m) =>
        channelIds.includes(m.channelId) &&
        visibleTo(me, m) &&
        (!s || m.text.toLowerCase().includes(s) || (isStaff(me) && m.originalText?.toLowerCase().includes(s)) || state.users.find((u) => u.id === m.authorId)?.name.toLowerCase().includes(s)) &&
        (!author || m.authorId === author) &&
        (!date || startOfDay(m.at) === startOfDay(new Date(date).getTime())),
    )
    .sort((a, b) => b.at - a.at)
  return (
    <div className="chat-body">
      <div className="small muted" style={{ margin: '10px 0' }}>
        Найдено: {res.length}
      </div>
      {res.map((m) => (
        <div key={m.id}>
          {channelIds.length > 1 && (
            <Link to={`/${base}/${m.channelId}`} className="tiny muted">
              #{state.channels.find((c) => c.id === m.channelId)?.name} · {fmtDateTime(m.at)}
            </Link>
          )}
          <MessageView m={m} onOpenThread={onOpenThread} />
        </div>
      ))}
    </div>
  )
}

function roleLabel(u: User | undefined) {
  if (!u) return ''
  if (u.role === 'teacher') return 'Преподаватель'
  if (u.role === 'assistant') return 'Ассистент'
  return u.teamRole ?? ''
}

function MessageView({ m, onOpenThread, inThread }: { m: Message; onOpenThread: (id: string) => void; inThread?: boolean }) {
  const { me, state, act } = useMe()
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(m.text)
  const [emoji, setEmoji] = useState(false)
  const [showOrig, setShowOrig] = useState(false)
  const u = state.users.find((x) => x.id === m.authorId)
  const replies = state.messages.filter((x) => x.parentId === m.id && visibleTo(me, x))
  const mentioned = m.text.toLowerCase().includes('@' + firstName(me.name).toLowerCase())
  const canEdit = m.authorId === me.id && now() - m.at < 15 * MIN && !m.deletedAt
  const canDelete = (m.authorId === me.id || isStaff(me)) && !m.deletedAt
  const staff = isStaff(me)
  return (
    <div className={`msg ${m.deletedAt ? 'msg-deleted' : ''}`}>
      <Avatar user={u} size={34} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="msg-head">
          <span className="msg-name">{u?.name}</span>
          <span className="msg-role">{roleLabel(u)}</span>
          <span className="msg-time">{fmtTime(m.at)}</span>
          {m.editedAt && (
            <button className="tiny muted" style={{ border: 0, background: 'none', padding: 0, cursor: staff ? 'pointer' : 'default' }} onClick={() => staff && setShowOrig(!showOrig)} title={staff ? 'Показать исходный текст' : undefined}>
              (изменено)
            </button>
          )}
          {m.deletedAt && staff && <span className="pill pill-orange">удалено {fmtTime(m.deletedAt)} · скрыто от студентов</span>}
        </div>
        {editing ? (
          <form
            className="row"
            style={{ alignItems: 'flex-end', marginTop: 4 }}
            onSubmit={(e) => {
              e.preventDefault()
              if (act(editMessage(m.id, text))) setEditing(false)
            }}
          >
            <textarea className="textarea" style={{ minHeight: 44 }} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
            <button className="btn btn-sm btn-primary">Сохранить</button>
            <button type="button" className="btn btn-sm" onClick={() => setEditing(false)}>
              Отмена
            </button>
          </form>
        ) : (
          m.text && (
            <div>
              <div className={`msg-text ${mentioned ? 'mentioned' : ''}`}>
                <Highlight text={m.text} />
              </div>
            </div>
          )
        )}
        {showOrig && m.originalText && (
          <div className="small" style={{ marginTop: 4, padding: '6px 10px', background: '#f7f6f2', borderRadius: 8 }}>
            <span className="tiny muted">Исходный текст: </span>
            {m.originalText}
          </div>
        )}
        {m.files?.map((f) => <FileChip key={f.id} f={f} />)}
        {Object.keys(m.reactions).length > 0 && (
          <div className="reactions">
            {Object.entries(m.reactions).map(([e, ids]) => (
              <button key={e} className={`reaction ${ids.includes(me.id) ? 'on' : ''}`} onClick={() => act(react(m.id, e))} title={ids.map((id) => state.users.find((x) => x.id === id)?.name).join(', ')}>
                {e} {ids.length}
              </button>
            ))}
          </div>
        )}
        {!inThread && replies.length > 0 && (
          <button className="thread-link" onClick={() => onOpenThread(m.id)}>
            {replies.length} {plural(replies.length, 'ответ', 'ответа', 'ответов')} в ветке
          </button>
        )}
      </div>
      {!m.deletedAt && (
        <div className="msg-tools">
          <button className="icon-btn" title="Реакция" onClick={() => setEmoji(!emoji)}>
            <Icon name="smile" size={15} />
          </button>
          {!inThread && (
            <button className="icon-btn" title="Ответить в ветке" onClick={() => onOpenThread(m.id)}>
              <Icon name="reply" size={15} />
            </button>
          )}
          {canEdit && (
            <button className="icon-btn" title="Редактировать (15 минут)" onClick={() => (setText(m.text), setEditing(true))}>
              <Icon name="edit" size={15} />
            </button>
          )}
          {canDelete && (
            <button className="icon-btn" title="Удалить" onClick={() => confirm('Удалить сообщение? Оно скроется от студентов, но останется видно преподавателю.') && act(deleteMessage(m.id))}>
              <Icon name="trash" size={15} />
            </button>
          )}
        </div>
      )}
      {emoji && (
        <div className="emoji-pop" onMouseLeave={() => setEmoji(false)}>
          {EMOJI.map((e) => (
            <button
              key={e}
              onClick={() => {
                act(react(m.id, e))
                setEmoji(false)
              }}
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function FileChip({ f }: { f: Attachment }) {
  return (
    <div>
      <span className="file-chip">
        <span className="ext">{f.name.split('.').pop()}</span>
        <span>
          <div className="small bold">{f.name}</div>
          <div className="tiny muted">{fmtSize(f.size)}</div>
        </span>
      </span>
    </div>
  )
}

function Thread({ parentId, onClose }: { parentId: string; onClose: () => void }) {
  const { me, state } = useMe()
  const parent = state.messages.find((m) => m.id === parentId)
  if (!parent) return null
  const replies = state.messages.filter((m) => m.parentId === parentId && visibleTo(me, m)).sort((a, b) => a.at - b.at)
  const ch = state.channels.find((c) => c.id === parent.channelId)!
  const team = state.teams.find((t) => t.id === ch.teamId)
  return (
    <div className="thread-panel">
      <div className="row-between" style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
        <span className="bold">Ветка</span>
        <button className="icon-btn" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      <div className="chat-body" style={{ padding: '8px 10px' }}>
        <MessageView m={parent} onOpenThread={() => {}} inThread />
        <div className="day-sep">
          {replies.length} {plural(replies.length, 'ответ', 'ответа', 'ответов')}
        </div>
        {replies.map((m) => (
          <MessageView key={m.id} m={m} onOpenThread={() => {}} inThread />
        ))}
      </div>
      <Composer channelId={parent.channelId} parentId={parentId} members={team ? team.memberIds.map((id) => state.users.find((u) => u.id === id)!) : []} name="ветку" />
    </div>
  )
}

function Composer({ channelId, parentId, members, name }: { channelId: string; parentId?: string; members: User[]; name: string }) {
  const { me, state, act, toast } = useMe()
  const [text, setText] = useState('')
  const [files, setFiles] = useState<Attachment[]>([])
  const [mq, setMq] = useState<string | null>(null)
  const ta = useRef<HTMLTextAreaElement>(null)
  if (!canWrite(state, me, channelId))
    return (
      <div className="composer small muted">
        <Icon name="lock" size={14} /> {state.channels.find((c) => c.id === channelId)?.kind === 'announcements' ? 'В объявления пишут только преподаватель и ассистент.' : 'Вы можете читать этот канал, но не писать в него.'}
      </div>
    )
  const sugg = mq !== null ? members.filter((u) => u.id !== me.id && u.name.toLowerCase().startsWith(mq.toLowerCase())).slice(0, 5) : []
  const send = () => {
    if (act(sendMessage(channelId, text, parentId, files))) {
      setText('')
      setFiles([])
      setMq(null)
    }
  }
  const onChange = (v: string) => {
    setText(v)
    const m = /@([A-Za-zА-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі]*)$/.exec(v.slice(0, ta.current?.selectionStart ?? v.length))
    setMq(m ? m[1] : null)
  }
  const pickMention = (u: User) => {
    const first = firstName(u.name)
    setText(text.replace(/@([A-Za-zА-Яа-яЁё]*)$/, `@${first} `))
    setMq(null)
    ta.current?.focus()
  }
  return (
    <div className="composer">
      {!parentId && <div className="tiny muted" style={{ marginBottom: 6 }}>Сообщение в #{name}</div>}
      {files.length > 0 && (
        <div className="row wrap" style={{ marginBottom: 8 }}>
          {files.map((f) => (
            <span key={f.id} className="chip">
              📎 {f.name} · {fmtSize(f.size)}
              <button onClick={() => setFiles(files.filter((x) => x.id !== f.id))}>
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="composer-row" style={{ position: 'relative' }}>
        <FilePick
          onFiles={(fs) => {
            const ok: Attachment[] = []
            for (const f of fs) {
              const err = checkFile(f)
              if (err) toast(err, 'error')
              else ok.push({ id: uid('f'), name: f.name, size: f.size })
            }
            setFiles([...files, ...ok])
          }}
        >
          <span className="attach" title="Прикрепить файл (до 25 МБ)">
            <Icon name="clip" size={17} />
          </span>
        </FilePick>
        <div className="grow" style={{ position: 'relative' }}>
          {sugg.length > 0 && (
            <div className="mention-pop">
              {sugg.map((u) => (
                <button key={u.id} onMouseDown={(e) => (e.preventDefault(), pickMention(u))}>
                  <Avatar user={u} size={22} /> {u.name}
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={ta}
            className="textarea"
            rows={1}
            maxLength={4000}
            placeholder="Напишите сообщение. @ — упомянуть участника"
            value={text}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (sugg.length && mq !== null) pickMention(sugg[0])
                else send()
              }
            }}
          />
        </div>
        <button className="btn btn-primary" style={{ height: 44, padding: '0 20px' }} onClick={send}>
          Отправить
        </button>
      </div>
      {text.length > 3500 && <div className="tiny orange">{text.length}/4000</div>}
    </div>
  )
}
