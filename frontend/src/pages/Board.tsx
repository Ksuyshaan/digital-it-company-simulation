import { useMemo, useState, type DragEvent } from 'react'
import { useMe } from '../store'
import { navigate, setQuery, useRoute } from '../router'
import { Avatar, Bar, Empty, Field, FilePick, Highlight, Icon, Modal, PageHead } from '../components/ui'
import type { Card, Column, Priority, Sprint, User } from '../types'
import { COLUMNS, COL_TITLE, PRIORITY, SP_VALUES, activeSprint, burndown, colIndex, isLocked, isStaff, moveError, needsReturnComment, wipOverflow } from '../lib/rules'
import { DAY, HOUR, fmtDay, fmtDayLong, fmtDateTime, fmtLeft, fmtRelDay, fmtSize, fmtTime, fmtWeekdayTime, fromInputDT, now, shortName, startOfDay, toInputDT, uid } from '../lib/util'
import {
  addRetroItem, archiveCard, attachToCard, checklistAdd, checklistRemove, checklistToggle, closeSprint, commentCard, createCard, moveCard, rateTeammates, restoreCard, setCardSprint, startSprint, updateCard,
} from '../data/actions'

export default function Board() {
  const { me, state, act, toast } = useMe()
  const { segments, query } = useRoute()
  const staff = isStaff(me)
  const teamId = segments[1] ?? me.teamId ?? (staff ? state.teams[0]?.id : undefined)
  const team = state.teams.find((t) => t.id === teamId)
  const [onlyMine, setOnlyMine] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [over, setOver] = useState<Column | null>(null)
  const [pendingReturn, setPendingReturn] = useState<{ cardId: string; to: Column } | null>(null)
  const [modal, setModal] = useState<null | 'new' | 'planning' | 'close' | 'start' | 'archive' | 'history'>(null)

  if (!team)
    return (
      <>
        <PageHead title="Доска задач" />
        <div className="card">
          <Empty>Доска появится после того, как вас добавят в команду.</Empty>
        </div>
      </>
    )

  const scrum = state.settings.boardMode === 'scrum'
  const sprint = activeSprint(state, team.id)
  const lock = isLocked(state, team.id)
  const readOnly = (!!lock && !staff) || (!staff && me.teamId !== team.id)
  const members = team.memberIds.map((id) => state.users.find((u) => u.id === id)!)
  const sm = members.find((u) => u.teamRole === 'Scrum Master')
  const canSM = staff || me.id === sm?.id

  const cards = state.cards.filter((c) => c.teamId === team.id && !c.archived)
  const visible = cards.filter((c) => {
    if (onlyMine && c.assigneeId !== me.id) return false
    if (!scrum) return true
    if (c.column === 'backlog') return sprint ? c.sprintId === sprint.id : false
    return sprint ? c.sprintId === sprint.id : c.sprintId === null
  })
  const productBacklog = cards.filter((c) => c.column === 'backlog' && (scrum ? c.sprintId === null || c.sprintId !== sprint?.id : false))
  const archived = state.cards.filter((c) => c.teamId === team.id && c.archived)
  const wip = wipOverflow(state, team.id)
  const history = state.history.filter((h) => h.teamId === team.id).sort((a, b) => b.at - a.at)
  const openCard = query.card ? state.cards.find((c) => c.id === query.card) : undefined
  const retroSprint = query.retro ? state.sprints.find((s) => s.id === query.retro) : undefined

  const doMove = (cardId: string, to: Column, comment?: string) => {
    const c = state.cards.find((x) => x.id === cardId)!
    if (!comment && needsReturnComment(c, to)) {
      const err = moveError(state, c, to, me)
      if (err) return toast(err, 'error')
      setPendingReturn({ cardId, to })
      return
    }
    if (act(moveCard(cardId, to, comment))) {
      if (to === 'progress' && c.assigneeId) {
        const n = state.cards.filter((x) => x.teamId === team.id && x.column === 'progress' && x.assigneeId === c.assigneeId && !x.archived && x.id !== cardId).length + 1
        if (n > state.settings.wipLimit) toast(`Лимит In Progress: у ${shortName(state.users.find((u) => u.id === c.assigneeId)!.name)} ${n} карточки при лимите ${state.settings.wipLimit}`, 'warn')
      }
    }
  }

  const onDrop = (e: DragEvent, col: Column) => {
    e.preventDefault()
    setOver(null)
    const id = e.dataTransfer.getData('text/plain') || dragId
    setDragId(null)
    if (id) doMove(id, col)
  }
  const dragCard = dragId ? state.cards.find((c) => c.id === dragId) : undefined
  const dropState = (col: Column) => (over === col && dragCard ? (moveError(state, dragCard, col, me) ? 'drop-bad' : 'drop-ok') : '')

  return (
    <>
      <PageHead
        crumb={`${team.name} · ${team.idea[0].toUpperCase() + team.idea.slice(1)}`}
        title="Доска задач"
        actions={
          <>
            {staff && (
              <select className="select" style={{ width: 180 }} value={team.id} onChange={(e) => navigate(`/board/${e.target.value}`)}>
                {state.teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
            <button className={`btn ${onlyMine ? 'on' : ''}`} onClick={() => setOnlyMine(!onlyMine)}>
              Только мои
            </button>
            {scrum && (
              <button className="btn" onClick={() => setModal('planning')}>
                Backlog · {productBacklog.length}
              </button>
            )}
            {!readOnly && (
              <button className="btn btn-primary" onClick={() => setModal('new')}>
                + Новая задача
              </button>
            )}
          </>
        }
      />

      {lock && (
        <div className="banner banner-dark">
          <Icon name="lock" size={16} />
          <span>
            <b>Только чтение.</b> {lock.reason}
            {staff && ' — преподаватель может редактировать'}
          </span>
        </div>
      )}

      {scrum && (
        <div className="card" style={{ marginBottom: 16 }}>
          {sprint ? (
            <SprintHeader sprint={sprint} sm={sm} canSM={canSM && !readOnly} onClose={() => setModal('close')} onRetro={() => setQuery({ retro: lastClosed(state.sprints, team.id)?.id ?? null })} />
          ) : (
            <div className="row-between wrap">
              <div>
                <div className="bold">Нет активного спринта</div>
                <div className="small muted">Scrum Master открывает спринт, команда переносит карточки из Backlog.</div>
              </div>
              <div className="row">
                {lastClosed(state.sprints, team.id) && (
                  <button className="btn" onClick={() => setQuery({ retro: lastClosed(state.sprints, team.id)!.id })}>
                    Ретроспектива
                  </button>
                )}
                {canSM && !readOnly && (
                  <button className="btn btn-primary" onClick={() => setModal('start')}>
                    Открыть спринт
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {wip.map((w) => (
        <div key={w.userId} className="banner">
          <Icon name="alert" size={16} />
          <span>
            <b>Лимит In Progress:</b> у {shortName(state.users.find((u) => u.id === w.userId)!.name)} {w.count} карточки при лимите {state.settings.wipLimit}. Завершите или верните одну в To Do.
          </span>
        </div>
      ))}

      <div className="board">
        {COLUMNS.map((col) => {
          const list = visible.filter((c) => c.column === col.id).sort((a, b) => (a.deadline ?? 9e15) - (b.deadline ?? 9e15))
          return (
            <div
              key={col.id}
              className={`col ${dropState(col.id)}`}
              onDragOver={(e) => {
                if (readOnly) return
                e.preventDefault()
                setOver(col.id)
              }}
              onDragLeave={() => setOver((o) => (o === col.id ? null : o))}
              onDrop={(e) => onDrop(e, col.id)}
            >
              <div className="col-head">
                <span>{col.title}</span>
                <span className="muted">{list.length}</span>
              </div>
              {list.map((c) => (
                <TaskCard key={c.id} c={c} readOnly={readOnly} dragging={dragId === c.id} onOpen={() => setQuery({ card: c.id })} onDragStart={() => setDragId(c.id)} onDragEnd={() => (setDragId(null), setOver(null))} />
              ))}
              {!list.length && <div className="tiny muted" style={{ textAlign: 'center', padding: 14 }}>Пусто</div>}
            </div>
          )
        })}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <div className="card-title">История изменений</div>
          <div className="row">
            <span className="tiny muted hide-sm">Записи не редактируются · видны преподавателю</span>
            {staff && archived.length > 0 && (
              <button className="btn btn-sm" onClick={() => setModal('archive')}>
                Архив · {archived.length}
              </button>
            )}
            <button className="btn btn-sm" onClick={() => setModal('history')}>
              Вся история
            </button>
          </div>
        </div>
        {history.slice(0, 6).map((h) => (
          <HistoryRow key={h.id} h={h} />
        ))}
        {!history.length && <Empty>Изменений пока нет</Empty>}
      </div>

      {openCard && <CardModal card={openCard} onClose={() => setQuery({ card: null })} onMove={doMove} readOnly={readOnly} />}
      {retroSprint && <RetroModal sprint={retroSprint} onClose={() => setQuery({ retro: null })} />}
      {pendingReturn && (
        <ReturnModal
          onCancel={() => setPendingReturn(null)}
          onOk={(text) => {
            doMove(pendingReturn.cardId, pendingReturn.to, text)
            setPendingReturn(null)
          }}
        />
      )}
      {modal === 'new' && <NewCardModal teamId={team.id} members={members} hasSprint={!!sprint} onClose={() => setModal(null)} />}
      {modal === 'planning' && <PlanningModal teamId={team.id} sprint={sprint} readOnly={readOnly} onClose={() => setModal(null)} />}
      {modal === 'close' && sprint && <CloseSprintModal sprint={sprint} onClose={() => setModal(null)} />}
      {modal === 'start' && <StartSprintModal teamId={team.id} onClose={() => setModal(null)} />}
      {modal === 'history' && (
        <Modal title="История изменений" wide onClose={() => setModal(null)}>
          {history.map((h) => (
            <HistoryRow key={h.id} h={h} />
          ))}
        </Modal>
      )}
      {modal === 'archive' && (
        <Modal title="Архив карточек" onClose={() => setModal(null)}>
          {archived.map((c) => (
            <div key={c.id} className="row-between" style={{ padding: '8px 0', borderTop: '1px solid var(--line-2)' }}>
              <span>
                <span className="task-key">{c.key}</span> {c.title}
              </span>
              <button className="btn btn-sm" onClick={() => act(restoreCard(c.id), 'Карточка восстановлена')}>
                Восстановить
              </button>
            </div>
          ))}
        </Modal>
      )}
    </>
  )
}

const lastClosed = (sprints: Sprint[], teamId: string) =>
  sprints
    .filter((s) => s.teamId === teamId && s.status === 'closed')
    .sort((a, b) => b.number - a.number)[0]

function SprintHeader({ sprint, sm, canSM, onClose, onRetro }: { sprint: Sprint; sm?: User; canSM: boolean; onClose: () => void; onRetro: () => void }) {
  const { state } = useMe()
  const b = burndown(state, sprint)
  const W = 180
  const H = 50
  const x = (d: number) => (d / b.days) * W
  const y = (v: number) => 4 + (1 - v / Math.max(1, b.total)) * (H - 8)
  const pts = b.actual.map((v, i) => `${x(i)},${y(v)}`).join(' ')
  return (
    <div className="sprint-card">
      <div>
        <div className="row wrap" style={{ marginBottom: 6 }}>
          <span className="bold" style={{ fontSize: 15 }}>
            {sprint.name} · {new Date(sprint.start).getDate()}–{fmtDayLong(sprint.end)}
          </span>
          <span className="pill pill-blue">Активный</span>
          <span className="small muted">Scrum Master: {sm?.name ?? 'не назначен'}</span>
        </div>
        <div className="small" style={{ color: 'var(--ink-2)' }}>
          Цель: {sprint.goal}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn btn-sm" onClick={onRetro}>
            Ретроспектива
          </button>
          {canSM && (
            <button className="btn btn-sm" onClick={onClose}>
              Закрыть спринт
            </button>
          )}
        </div>
      </div>
      <div>
        <div className="small muted">Сделано</div>
        <div className="stat-value" style={{ fontSize: 22, margin: '2px 0 8px' }}>
          {b.doneSp} <small>/ {b.total} SP</small>
        </div>
        <Bar value={b.doneSp} max={b.total} />
      </div>
      <div className="burn">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: 56 }}>
          <line x1={0} y1={y(b.total)} x2={W} y2={y(0)} stroke="#b6b4ad" strokeDasharray="4 4" strokeWidth={1.2} />
          <polyline points={pts} fill="none" stroke="var(--blue)" strokeWidth={2} />
          {b.actual.length > 0 && <circle cx={x(b.actual.length - 1)} cy={y(b.actual[b.actual.length - 1])} r={3.5} fill="var(--blue)" />}
        </svg>
        <div className="tiny muted" style={{ marginTop: 4 }}>
          Burndown · день {b.today} из {b.days} ·{' '}
          {b.behind > 0 ? <span className="orange bold">отстаём на {b.behind} SP</span> : <span className="green bold">{b.behind < 0 ? `опережаем на ${-b.behind} SP` : 'по плану'}</span>}
        </div>
      </div>
    </div>
  )
}

function TaskCard({ c, readOnly, dragging, onOpen, onDragStart, onDragEnd }: { c: Card; readOnly: boolean; dragging: boolean; onOpen: () => void; onDragStart: () => void; onDragEnd: () => void }) {
  const { state } = useMe()
  const assignee = state.users.find((u) => u.id === c.assigneeId)
  const overdue = c.column !== 'done' && c.deadline && c.deadline < now()
  const late = c.column === 'done' && c.deadline && c.closedAt && c.closedAt > c.deadline
  return (
    <div
      className={`tcard ${overdue ? 'overdue' : ''} ${dragging ? 'dragging' : ''} ${readOnly ? 'locked' : ''}`}
      draggable={!readOnly}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', c.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
    >
      <div className="row-between">
        <span className="task-key">{c.key}</span>
        <span className={`prio prio-${c.priority}`}>{PRIORITY[c.priority]}</span>
      </div>
      <div className="tcard-title">{c.title}</div>
      {c.checklist.length > 0 && (
        <div className="tiny muted">
          ☑ {c.checklist.filter((x) => x.done).length}/{c.checklist.length}
        </div>
      )}
      <div className="tcard-foot">
        {assignee ? <Avatar user={assignee} size={22} /> : <span className="avatar" style={{ width: 22, height: 22, fontSize: 10 }}>–</span>}
        <span className={`dl ${overdue || late ? 'orange bold' : c.column === 'done' ? 'green' : ''}`}>
          {c.column === 'done' ? (late ? 'С опозд.' : 'Вовремя') : overdue ? `Просрочено ${Math.ceil((now() - c.deadline!) / DAY)} д` : c.deadline ? fmtWeekdayTime(c.deadline) : 'без срока'}
        </span>
        <span className="sp">{c.sp ?? '–'} SP</span>
        <span className="cm">
          <Icon name="chat" size={12} />
          {c.comments.length}
        </span>
      </div>
    </div>
  )
}

function histDate(t: number) {
  const d = startOfDay(t)
  const today = startOfDay(now())
  const day = d === today ? 'сегодня' : d === today - DAY ? 'вчера' : fmtDay(t)
  return `${day}\n${fmtTime(t)}`
}

function HistoryRow({ h }: { h: { at: number; userId: string; cardId: string; field: string; from: string; to: string; note?: string } }) {
  const { state } = useMe()
  const u = state.users.find((x) => x.id === h.userId)
  const c = state.cards.find((x) => x.id === h.cardId)
  return (
    <div className="hist-row">
      <span className="mono">{histDate(h.at)}</span>
      <span className="bold">{u?.name ?? 'Система'}</span>
      <span>
        <button className="link" style={{ fontWeight: 600, color: 'inherit' }} onClick={() => setQuery({ card: h.cardId })}>
          {c?.key}
        </button>{' '}
        · {h.field === 'Колонка' ? '' : `${h.field}: `}
        {h.from} → {h.to}
        {h.note && <span className="muted"> · «{h.note}»</span>}
      </span>
    </div>
  )
}

function ReturnModal({ onCancel, onOk }: { onCancel: () => void; onOk: (t: string) => void }) {
  const [text, setText] = useState('')
  return (
    <Modal
      title="Возврат из Review"
      onClose={onCancel}
      footer={
        <>
          <button className="btn" onClick={onCancel}>
            Отмена
          </button>
          <button className="btn btn-primary" disabled={!text.trim()} onClick={() => onOk(text)}>
            Вернуть
          </button>
        </>
      }
    >
      <Field label="Комментарий исполнителю (обязательно)">
        <textarea className="textarea" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Что нужно доработать?" />
      </Field>
    </Modal>
  )
}

/* ─────────── Карточка ─────────── */

function CardModal({ card, onClose, onMove, readOnly }: { card: Card; onClose: () => void; onMove: (id: string, to: Column) => void; readOnly: boolean }) {
  const { me, state, act } = useMe()
  const team = state.teams.find((t) => t.id === card.teamId)!
  const members = team.memberIds.map((id) => state.users.find((u) => u.id === id)!)
  const [title, setTitle] = useState(card.title)
  const [desc, setDesc] = useState(card.description)
  const [comment, setComment] = useState('')
  const [check, setCheck] = useState('')
  const [label, setLabel] = useState('')
  const [tab, setTab] = useState<'comments' | 'history'>('comments')
  const hist = state.history.filter((h) => h.cardId === card.id).sort((a, b) => b.at - a.at)
  const author = state.users.find((u) => u.id === card.authorId)
  const upd = (p: Parameters<typeof updateCard>[1]) => act(updateCard(card.id, p))
  const ro = readOnly || !!card.archived

  return (
    <Modal
      wide
      title={
        <span className="row">
          <span className="task-key" style={{ fontSize: 13 }}>
            {card.key}
          </span>
          <span className={`pill pill-${card.column}`}>{COL_TITLE[card.column]}</span>
          {card.archived && <span className="pill pill-dark">в архиве</span>}
        </span>
      }
      onClose={onClose}
    >
      <div className="card-modal">
        <div className="stack">
          <input
            className="input"
            style={{ fontSize: 18, fontWeight: 800, height: 46 }}
            value={title}
            maxLength={120}
            disabled={ro}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title !== card.title && upd({ title })}
          />
          <Field label="Описание" hint={colIndex(card.column) >= 1 ? 'Обязательно для To Do и далее' : undefined}>
            <textarea className="textarea" value={desc} disabled={ro} onChange={(e) => setDesc(e.target.value)} onBlur={() => desc !== card.description && upd({ description: desc })} placeholder="Что нужно сделать, критерии готовности, ссылки" />
          </Field>

          <div>
            <div className="row-between">
              <span className="field-label">
                Чек-лист подзадач · {card.checklist.filter((x) => x.done).length}/{card.checklist.length}
              </span>
            </div>
            {card.checklist.map((it) => (
              <div key={it.id} className={`check-item ${it.done ? 'done' : ''}`}>
                <input type="checkbox" checked={it.done} disabled={ro} onChange={() => act(checklistToggle(card.id, it.id))} />
                <span className="grow">{it.text}</span>
                {!ro && (
                  <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => act(checklistRemove(card.id, it.id))}>
                    <Icon name="x" size={14} />
                  </button>
                )}
              </div>
            ))}
            {!ro && card.checklist.length < 20 && (
              <form
                className="row"
                style={{ marginTop: 6 }}
                onSubmit={(e) => {
                  e.preventDefault()
                  if (act(checklistAdd(card.id, check))) setCheck('')
                }}
              >
                <input className="input input-sm" placeholder="Новый пункт (до 20)" value={check} onChange={(e) => setCheck(e.target.value)} />
                <button className="btn btn-sm">Добавить</button>
              </form>
            )}
          </div>

          <div>
            <div className="row-between">
              <span className="field-label">Файлы · {card.files.length}/10</span>
              {!ro && (
                <FilePick onFiles={(fs) => act(attachToCard(card.id, fs.map((f) => ({ id: uid('f'), name: f.name, size: f.size }))), 'Файл прикреплён')}>
                  <span className="btn btn-sm">
                    <Icon name="clip" size={14} /> Прикрепить
                  </span>
                </FilePick>
              )}
            </div>
            <div className="row wrap">
              {card.files.map((f) => (
                <span key={f.id} className="file-chip" style={{ minWidth: 0 }}>
                  <span className="ext">{f.name.split('.').pop()}</span>
                  <span>
                    <div className="small bold">{f.name}</div>
                    <div className="tiny muted">{fmtSize(f.size)}</div>
                  </span>
                </span>
              ))}
            </div>
            <div className="tiny muted" style={{ marginTop: 4 }}>
              До 25 МБ каждый, исполняемые файлы запрещены
            </div>
          </div>

          <div>
            <div className="seg" style={{ marginBottom: 8 }}>
              <button className={tab === 'comments' ? 'on' : ''} onClick={() => setTab('comments')}>
                Комментарии · {card.comments.length}
              </button>
              <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>
                История · {hist.length}
              </button>
            </div>
            {tab === 'comments' ? (
              <>
                {card.comments.map((c) => {
                  const u = state.users.find((x) => x.id === c.authorId)
                  return (
                    <div key={c.id} className="comment">
                      <Avatar user={u} size={28} />
                      <div className="grow">
                        <div className="row">
                          <span className="bold small">{u?.name}</span>
                          <span className="tiny muted">{fmtRelDay(c.at)}</span>
                        </div>
                        <div>
                          <Highlight text={c.text} />
                        </div>
                        {c.files?.map((f) => (
                          <div key={f.id} className="tiny muted">
                            📎 {f.name}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
                {!ro && (
                  <form
                    className="row"
                    style={{ marginTop: 8, alignItems: 'flex-end' }}
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (act(commentCard(card.id, comment))) setComment('')
                    }}
                  >
                    <textarea className="textarea" style={{ minHeight: 44 }} placeholder="Комментарий. @имя — упомянуть участника" value={comment} onChange={(e) => setComment(e.target.value)} />
                    <button className="btn btn-primary">Отправить</button>
                  </form>
                )}
              </>
            ) : (
              <div>
                {hist.map((h) => (
                  <div key={h.id} className="hist-row" style={{ gridTemplateColumns: '120px 130px 1fr' }}>
                    <span className="mono">{fmtDateTime(h.at)}</span>
                    <span className="bold">{shortName(state.users.find((u) => u.id === h.userId)?.name ?? 'Система')}</span>
                    <span>
                      {h.field}: {h.from} → {h.to}
                      {h.note && <span className="muted"> · «{h.note}»</span>}
                    </span>
                  </div>
                ))}
                {!hist.length && <Empty>Нет записей</Empty>}
              </div>
            )}
          </div>
        </div>

        <div className="side-props">
          <Field label="Колонка">
            <select className="select" value={card.column} disabled={ro} onChange={(e) => onMove(card.id, e.target.value as Column)}>
              {COLUMNS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Исполнитель">
            <select className="select" value={card.assigneeId ?? ''} disabled={ro} onChange={(e) => upd({ assigneeId: e.target.value || null })}>
              <option value="">— не назначен —</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.id === me.id ? ' (вы)' : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Дедлайн" error={card.deadline && card.deadline < now() && card.column !== 'done' ? 'Просрочено' : null}>
            <input className="input" type="datetime-local" disabled={ro} value={toInputDT(card.deadline)} onChange={(e) => upd({ deadline: fromInputDT(e.target.value) })} />
          </Field>
          <div className="grid-2">
            <Field label="Приоритет">
              <select className="select" value={card.priority} disabled={ro} onChange={(e) => upd({ priority: e.target.value as Priority })}>
                {Object.entries(PRIORITY).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Story points">
              <select className="select" value={card.sp ?? ''} disabled={ro} onChange={(e) => upd({ sp: e.target.value ? Number(e.target.value) : null })}>
                <option value="">—</option>
                {SP_VALUES.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Метки">
            <div className="row wrap">
              {card.labels.map((l) => (
                <span key={l} className="chip">
                  {l}
                  {!ro && (
                    <button onClick={() => upd({ labels: card.labels.filter((x) => x !== l) })}>
                      <Icon name="x" size={12} />
                    </button>
                  )}
                </span>
              ))}
            </div>
            {!ro && (
              <input
                className="input input-sm"
                placeholder="Новая метка + Enter"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && label.trim()) {
                    e.preventDefault()
                    if (!card.labels.includes(label.trim())) upd({ labels: [...card.labels, label.trim()] })
                    setLabel('')
                  }
                }}
              />
            )}
          </Field>
          <div className="divider" style={{ margin: '4px 0' }} />
          <div className="tiny muted stack-sm" style={{ gap: 4 }}>
            <div>Автор: {author?.name}</div>
            <div>Создана: {fmtDateTime(card.createdAt)}</div>
            {card.closedAt && <div>Закрыта: {fmtDateTime(card.closedAt)}</div>}
            <div>Спринт: {state.sprints.find((s) => s.id === card.sprintId)?.name ?? 'Product Backlog'}</div>
          </div>
          {!ro && (
            <button
              className="btn btn-sm btn-danger"
              onClick={() => {
                if (confirm('Карточки не удаляются, а архивируются. Архив видит преподаватель. Продолжить?') && act(archiveCard(card.id), 'Карточка перенесена в архив')) onClose()
              }}
            >
              <Icon name="archive" size={14} /> В архив
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}

function NewCardModal({ teamId, members, hasSprint, onClose }: { teamId: string; members: User[]; hasSprint: boolean; onClose: () => void }) {
  const { act, state } = useMe()
  const [f, setF] = useState({ title: '', description: '', assigneeId: '', deadline: '', priority: 'mid' as Priority, sp: '', labels: '', inSprint: hasSprint })
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p })
  const submit = () => {
    if (
      act(
        createCard(teamId, {
          title: f.title,
          description: f.description,
          assigneeId: f.assigneeId || null,
          deadline: fromInputDT(f.deadline),
          priority: f.priority,
          sp: f.sp ? Number(f.sp) : null,
          labels: f.labels.split(',').map((x) => x.trim()).filter(Boolean),
          inSprint: f.inSprint,
        }),
        'Карточка создана в Backlog',
      )
    )
      onClose()
  }
  return (
    <Modal
      title="Новая задача"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-primary" onClick={submit}>
            Создать
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label={`Название · ${f.title.length}/120`}>
          <input className="input" autoFocus maxLength={120} value={f.title} onChange={(e) => set({ title: e.target.value })} />
        </Field>
        <Field label="Описание" hint="Обязательно, чтобы перенести в To Do">
          <textarea className="textarea" value={f.description} onChange={(e) => set({ description: e.target.value })} />
        </Field>
        <div className="grid-2">
          <Field label="Исполнитель">
            <select className="select" value={f.assigneeId} onChange={(e) => set({ assigneeId: e.target.value })}>
              <option value="">—</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Дедлайн">
            <input className="input" type="datetime-local" value={f.deadline} onChange={(e) => set({ deadline: e.target.value })} />
          </Field>
          <Field label="Приоритет">
            <select className="select" value={f.priority} onChange={(e) => set({ priority: e.target.value as Priority })}>
              {Object.entries(PRIORITY).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`Story points${state.settings.boardMode === 'scrum' ? ' (обязательно в Scrum)' : ''}`}>
            <select className="select" value={f.sp} onChange={(e) => set({ sp: e.target.value })}>
              <option value="">—</option>
              {SP_VALUES.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Метки (через запятую)">
          <input className="input" value={f.labels} onChange={(e) => set({ labels: e.target.value })} placeholder="frontend, design" />
        </Field>
        {hasSprint && (
          <label className="row small">
            <input type="checkbox" checked={f.inSprint} onChange={(e) => set({ inSprint: e.target.checked })} /> Добавить в текущий спринт (иначе — в Product Backlog)
          </label>
        )}
      </div>
    </Modal>
  )
}

function PlanningModal({ teamId, sprint, readOnly, onClose }: { teamId: string; sprint?: Sprint; readOnly: boolean; onClose: () => void }) {
  const { state, act } = useMe()
  const team = state.teams.find((t) => t.id === teamId)!
  const cards = state.cards.filter((c) => c.teamId === teamId && !c.archived)
  const backlog = cards.filter((c) => c.column === 'backlog' && c.sprintId !== sprint?.id)
  const inSprint = sprint ? cards.filter((c) => c.sprintId === sprint.id) : []
  const prev = lastClosed(state.sprints, teamId)
  const velocity = prev ? state.cards.filter((c) => c.sprintId === prev.id && c.column === 'done').reduce((a, c) => a + (c.sp ?? 0), 0) || prev.report?.doneSp || 0 : null
  const perMember = team.memberIds.map((id) => ({ u: state.users.find((x) => x.id === id)!, sp: inSprint.filter((c) => c.assigneeId === id).reduce((a, c) => a + (c.sp ?? 0), 0) }))
  const total = inSprint.reduce((a, c) => a + (c.sp ?? 0), 0)
  return (
    <Modal title="Product Backlog и планирование" wide onClose={onClose}>
      {sprint ? (
        <div className="banner banner-blue">
          <Icon name="chart" size={16} />
          <span>
            В спринте {total} SP · скорость прошлого спринта: <b>{velocity ?? '—'} SP</b>
          </span>
        </div>
      ) : (
        <div className="banner">
          <Icon name="alert" size={16} /> Нет активного спринта — откройте спринт, чтобы планировать.
        </div>
      )}
      {sprint && (
        <div className="row wrap" style={{ marginBottom: 16 }}>
          {perMember.map((m) => (
            <span key={m.u.id} className="chip">
              <Avatar user={m.u} size={18} /> {shortName(m.u.name)} · <b className="mono">{m.sp} SP</b>
            </span>
          ))}
        </div>
      )}
      <div className="label-caps">Product Backlog · {backlog.length}</div>
      {backlog.map((c) => (
        <div key={c.id} className="row-between" style={{ padding: '9px 0', borderTop: '1px solid var(--line-2)' }}>
          <span className="row grow">
            <span className="task-key">{c.key}</span>
            <span className="grow">{c.title}</span>
            <span className={`prio prio-${c.priority}`}>{PRIORITY[c.priority]}</span>
            <span className="kbd">{c.sp ?? '–'} SP</span>
          </span>
          {sprint && !readOnly && (
            <button className="btn btn-sm" style={{ marginLeft: 10 }} onClick={() => act(setCardSprint(c.id, sprint.id), `${c.key} добавлена в спринт`)}>
              В спринт →
            </button>
          )}
        </div>
      ))}
      {!backlog.length && <Empty>Backlog пуст</Empty>}
      {sprint && (
        <>
          <div className="label-caps">В спринте, ещё не начаты</div>
          {inSprint
            .filter((c) => c.column === 'backlog')
            .map((c) => (
              <div key={c.id} className="row-between" style={{ padding: '9px 0', borderTop: '1px solid var(--line-2)' }}>
                <span className="row grow">
                  <span className="task-key">{c.key}</span>
                  <span className="grow">{c.title}</span>
                  <span className="kbd">{c.sp ?? '–'} SP</span>
                </span>
                {!readOnly && (
                  <button className="btn btn-sm" style={{ marginLeft: 10 }} onClick={() => act(setCardSprint(c.id, null))}>
                    ← В Backlog
                  </button>
                )}
              </div>
            ))}
        </>
      )}
    </Modal>
  )
}

function CloseSprintModal({ sprint, onClose }: { sprint: Sprint; onClose: () => void }) {
  const { state, act } = useMe()
  const [mode, setMode] = useState<'backlog' | 'next'>('backlog')
  const cards = state.cards.filter((c) => c.sprintId === sprint.id && !c.archived)
  const done = cards.filter((c) => c.column === 'done')
  const overdue = cards.filter((c) => c.deadline && ((c.closedAt && c.closedAt > c.deadline) || (!c.closedAt && c.deadline < now())))
  const early = now() < startOfDay(sprint.end)
  return (
    <Modal
      title={`Sprint review · ${sprint.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-primary" onClick={() => act(closeSprint(sprint.id, mode), 'Спринт закрыт, отчёт сохранён') && onClose()}>
            Закрыть спринт
          </button>
        </>
      }
    >
      {early && (
        <div className="banner">
          <Icon name="alert" size={16} /> Обычно спринт закрывают в последний день ({fmtDay(sprint.end)}).
        </div>
      )}
      <div className="grid-3" style={{ marginBottom: 16 }}>
        <div className="stat">
          <div className="stat-label">Запланировано</div>
          <div className="stat-value">{cards.length}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Сделано</div>
          <div className="stat-value green">{done.length}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Просрочено</div>
          <div className="stat-value orange">{overdue.length}</div>
        </div>
      </div>
      <div className="label-caps">Незавершённые карточки · {cards.length - done.length}</div>
      <label className="row small" style={{ padding: '4px 0' }}>
        <input type="radio" checked={mode === 'backlog'} onChange={() => setMode('backlog')} /> Вернуть в Backlog
      </label>
      <label className="row small" style={{ padding: '4px 0' }}>
        <input type="radio" checked={mode === 'next'} onChange={() => setMode('next')} /> Перенести в следующий спринт (откроется автоматически)
      </label>
      <p className="small muted">После закрытия у каждого участника 48 часов на ретроспективу.</p>
    </Modal>
  )
}

function StartSprintModal({ teamId, onClose }: { teamId: string; onClose: () => void }) {
  const { state, act } = useMe()
  const n = state.sprints.filter((s) => s.teamId === teamId).length + 1
  const start = startOfDay(now())
  const [f, setF] = useState({ name: `Спринт ${n}`, goal: '', start: toInputDT(start), end: toInputDT(start + state.settings.sprintWeeks * 7 * DAY - 60_000) })
  return (
    <Modal
      title="Открыть спринт"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-primary" onClick={() => act(startSprint(teamId, { name: f.name, goal: f.goal, start: fromInputDT(f.start)!, end: fromInputDT(f.end)! }), 'Спринт открыт') && onClose()}>
            Открыть
          </button>
        </>
      }
    >
      <div className="stack">
        <Field label="Название">
          <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label={`Цель спринта · ${f.goal.length}/300`}>
          <textarea className="textarea" maxLength={300} value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value })} />
        </Field>
        <div className="grid-2">
          <Field label="Начало">
            <input className="input" type="datetime-local" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />
          </Field>
          <Field label="Конец">
            <input className="input" type="datetime-local" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} />
          </Field>
        </div>
      </div>
    </Modal>
  )
}

/* ─────────── Ретроспектива ─────────── */

function RetroModal({ sprint, onClose }: { sprint: Sprint; onClose: () => void }) {
  const { me, state, act } = useMe()
  const staff = isStaff(me)
  const team = state.teams.find((t) => t.id === sprint.teamId)!
  const retro = state.retros.find((r) => r.sprintId === sprint.id)
  const deadline = (sprint.closedAt ?? sprint.end) + 48 * HOUR
  const open = sprint.status === 'closed' && now() < deadline && me.teamId === team.id
  const mates = team.memberIds.filter((id) => id !== me.id).map((id) => state.users.find((u) => u.id === id)!)
  const myRatings = Object.fromEntries((retro?.ratings ?? []).filter((r) => r.from === me.id).map((r) => [r.to, r.score]))
  const [ratings, setRatings] = useState<Record<string, number>>(myRatings)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const sprints = state.sprints.filter((s) => s.teamId === team.id && s.status === 'closed')
  const cols = [
    { id: 'good' as const, title: 'Что было хорошо' },
    { id: 'bad' as const, title: 'Что мешало' },
    { id: 'change' as const, title: 'Что меняем' },
  ]
  const avgFor = useMemo(() => {
    const m: Record<string, number[]> = {}
    for (const r of retro?.ratings ?? []) (m[r.to] ??= []).push(r.score)
    return m
  }, [retro])
  return (
    <Modal
      wide
      title={
        <span className="row">
          Ретроспектива ·
          <select className="select select-sm" style={{ width: 'auto' }} value={sprint.id} onChange={(e) => setQuery({ retro: e.target.value })}>
            {sprints.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </span>
      }
      onClose={onClose}
    >
      {sprint.status !== 'closed' ? (
        <div className="banner banner-blue">Ретроспектива открывается после закрытия спринта.</div>
      ) : open ? (
        <div className="banner banner-blue">
          <Icon name="clock" size={16} /> Каждый добавляет не менее 1 пункта · осталось {fmtLeft(deadline - now())}
        </div>
      ) : (
        <div className="banner">
          <Icon name="lock" size={16} /> Приём пунктов закрыт {fmtDateTime(deadline)}
        </div>
      )}
      {sprint.report && (
        <div className="small muted" style={{ marginBottom: 12 }}>
          Отчёт спринта: запланировано {sprint.report.planned} · сделано {sprint.report.done} · просрочено {sprint.report.overdue} · {sprint.report.doneSp}/{sprint.report.plannedSp} SP
        </div>
      )}
      <div className="retro-cols">
        {cols.map((c) => (
          <div key={c.id} className="retro-col">
            <div className="bold small">{c.title}</div>
            {retro?.items
              .filter((i) => i.col === c.id)
              .map((i) => (
                <div key={i.id} className="retro-item">
                  {i.text}
                  <div className="tiny muted">{shortName(state.users.find((u) => u.id === i.authorId)?.name ?? '')}</div>
                </div>
              ))}
            {open && (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  if (act(addRetroItem(sprint.id, c.id, drafts[c.id] ?? ''))) setDrafts({ ...drafts, [c.id]: '' })
                }}
              >
                <input className="input input-sm" placeholder="+ пункт" value={drafts[c.id] ?? ''} onChange={(e) => setDrafts({ ...drafts, [c.id]: e.target.value })} />
              </form>
            )}
          </div>
        ))}
      </div>
      <div className="label-caps">Кто заполнил</div>
      <div className="row wrap">
        {team.memberIds.map((id) => {
          const u = state.users.find((x) => x.id === id)!
          const ok = retro?.items.some((i) => i.authorId === id)
          return (
            <span key={id} className={`chip ${ok ? 'chip-blue' : ''}`}>
              {ok ? '✓' : '·'} {shortName(u.name)}
            </span>
          )
        })}
      </div>
      {open && (
        <>
          <div className="label-caps">Оценка вклада коллег (видно только преподавателю)</div>
          {mates.map((m) => (
            <div key={m.id} className="row-between" style={{ padding: '6px 0' }}>
              <span className="row">
                <Avatar user={m} size={26} /> {m.name}
              </span>
              <span className="stars">
                {[1, 2, 3, 4, 5].map((v) => (
                  <button key={v} className={ratings[m.id] === v ? 'on' : ''} onClick={() => setRatings({ ...ratings, [m.id]: v })}>
                    {v}
                  </button>
                ))}
              </span>
            </div>
          ))}
          <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={Object.keys(ratings).length < mates.length} onClick={() => act(rateTeammates(sprint.id, ratings), 'Оценки сохранены')}>
            Сохранить оценки
          </button>
        </>
      )}
      {staff && (
        <>
          <div className="label-caps">Оценки коллег (средние)</div>
          <div className="row wrap">
            {team.memberIds.map((id) => {
              const arr = avgFor[id] ?? []
              return (
                <span key={id} className="chip">
                  {shortName(state.users.find((u) => u.id === id)!.name)} · <b className="mono">{arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : '—'}</b>
                </span>
              )
            })}
          </div>
        </>
      )}
    </Modal>
  )
}
