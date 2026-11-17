import { useState } from 'react'
import { useMe } from '../store'
import { Empty, Field, Icon, Modal, PageHead, Segmented, Toggle } from '../components/ui'
import type { Assignment, Criterion, Submission } from '../types'
import { activeReviews, finalGrade, isLocked, isStaff, lateInfo, peerAvg, reviewCounts, reviewScore, submittedAt, teacherScore } from '../lib/rules'
import { DAY, HOUR, fmtDateTime, fmtLeft, fmtNum, fromInputDT, now, startOfDay, sum, toInputDT } from '../lib/util'
import { addLock, cancelLock, createAssignment, disputeReview, extendFor, gradeWork, resolveDispute, runReviewAssignment, submitReview, submitWork } from '../data/actions'

const FORMAT = { file: 'Файл', link: 'Ссылка', text: 'Текст' }

export default function Assignments() {
  const { me } = useMe()
  return isStaff(me) ? <StaffAssignments /> : <StudentAssignments />
}

function Formula({ a, sub }: { a: Assignment; sub?: Submission }) {
  const { state } = useMe()
  if (!sub?.versions.length) return <span className="muted small">не сдано</span>
  const t = teacherScore(sub)
  const p = peerAvg(sub)
  const { penalty, lateDays } = lateInfo(a, sub, state)
  const f = finalGrade(a, sub, state)
  if (t === null) return <span className="small muted">ждёт оценки</span>
  const tw = state.settings.teacherWeight
  const pw = state.settings.peerWeight
  return (
    <span className="small">
      <b className="mono">{fmtNum(f ?? 0)}</b> <span className="muted">/ {a.maxScore}</span>
      <span className="tiny muted" style={{ display: 'block' }}>
        {a.peerReview && p !== null ? `${tw}×${t} + ${pw}×${fmtNum(p)}` : `${t}`}
        {lateDays > 0 && ` − ${fmtNum(penalty)} (опоздание ${lateDays} д)`}
      </span>
    </span>
  )
}

/* ─────────── Студент ─────────── */

function StudentAssignments() {
  const { me, state } = useMe()
  const [open, setOpen] = useState<string | null>(null)
  const [review, setReview] = useState<{ subId: string; reviewId: string } | null>(null)
  const list = [...state.assignments].sort((a, b) => b.deadline - a.deadline)
  const mySub = (a: Assignment) => state.submissions.find((s) => s.assignmentId === a.id && s.studentId === me.id)
  const reviews = state.submissions.flatMap((s) => s.reviews.filter((r) => r.reviewerId === me.id).map((r) => ({ sub: s, r })))
  const pending = reviews.filter((x) => !x.r.scores && now() - x.r.assignedAt < 48 * HOUR)

  return (
    <>
      <PageHead crumb={`${state.course.name} · Индивидуальные задания`} title="Задания" />
      {pending.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">Ждут вашей проверки · {pending.length}</div>
          {pending.map(({ sub, r }, i) => {
            const a = state.assignments.find((x) => x.id === sub.assignmentId)!
            return (
              <div key={r.id} className="row-between" style={{ padding: '10px 0', borderTop: '1px solid var(--line-2)' }}>
                <span>
                  <b>Работа #{i + 1}</b> · {a.title}
                  <div className="tiny muted">Анонимно · осталось {fmtLeft(r.assignedAt + 48 * HOUR - now())}</div>
                </span>
                <button className="btn btn-sm btn-primary" onClick={() => setReview({ subId: sub.id, reviewId: r.id })}>
                  Проверить
                </button>
              </div>
            )
          })}
        </div>
      )}
      <div className="card">
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Задание</th>
                <th>Дедлайн</th>
                <th>Статус</th>
                <th>Оценка</th>
              </tr>
            </thead>
            <tbody>
              {list.map((a) => {
                const sub = mySub(a)
                const info = lateInfo(a, sub, state)
                const submitted = !!sub?.versions.length
                const st = submitted
                  ? info.lateDays > 0
                    ? <span className="pill pill-orange">Сдано с опозданием {info.lateDays} д</span>
                    : <span className="pill pill-done">Сдано</span>
                  : now() < a.openAt
                    ? <span className="pill pill-todo">Откроется {fmtDateTime(a.openAt)}</span>
                    : now() < info.deadline
                      ? <span className="pill pill-blue">Открыто · {fmtLeft(info.deadline - now())}</span>
                      : now() < info.closeAt
                        ? <span className="pill pill-orange">Просрочено · закроется через {fmtLeft(info.closeAt - now())}</span>
                        : <span className="pill pill-todo">Не сдано</span>
                return (
                  <tr key={a.id} className="clickable" onClick={() => setOpen(a.id)}>
                    <td>
                      <div className="bold">{a.title}</div>
                      <div className="tiny muted">
                        {FORMAT[a.format]} · макс. {a.maxScore}
                        {a.peerReview ? ' · peer-review' : ''}
                      </div>
                    </td>
                    <td className="small nowrap">{fmtDateTime(info.deadline)}</td>
                    <td>{st}</td>
                    <td>
                      <Formula a={a} sub={sub} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      {open && <StudentAssignmentModal a={state.assignments.find((x) => x.id === open)!} onClose={() => setOpen(null)} />}
      {review && <ReviewModal subId={review.subId} reviewId={review.reviewId} onClose={() => setReview(null)} />}
    </>
  )
}

function StudentAssignmentModal({ a, onClose }: { a: Assignment; onClose: () => void }) {
  const { me, state, act } = useMe()
  const sub = state.submissions.find((s) => s.assignmentId === a.id && s.studentId === me.id)
  const info = lateInfo(a, sub, state)
  const [content, setContent] = useState(sub ? sub.versions[sub.versions.length - 1]?.content ?? '' : '')
  const [dispute, setDispute] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const lock = isLocked(state, undefined, a.id)
  const canSubmit = now() >= a.openAt && now() < info.closeAt && !lock && !a.locked && !(sub?.reviews.length && now() > info.deadline)
  const pendingLate = now() > info.deadline ? Math.ceil((now() - info.deadline) / DAY) : 0
  return (
    <Modal title={a.title} wide onClose={onClose}>
      <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0,1fr) 260px', gap: 22 }}>
        <div className="stack">
          <p style={{ margin: 0 }}>{a.description}</p>
          <div>
            <div className="label-caps" style={{ marginTop: 0 }}>
              Чек-лист оценки
            </div>
            {a.criteria.map((c) => (
              <div key={c.text} className="row-between small" style={{ padding: '4px 0' }}>
                <span>{c.text}</span>
                <span className="mono">{c.points}</span>
              </div>
            ))}
          </div>
          {lock && (
            <div className="banner banner-dark">
              <Icon name="lock" size={16} /> {lock.reason}
            </div>
          )}
          {canSubmit ? (
            <form
              className="stack-sm"
              onSubmit={(e) => {
                e.preventDefault()
                act(submitWork(a.id, content), sub?.versions.length ? 'Новая версия сдана — оценивается последняя' : 'Работа сдана')
              }}
            >
              <Field label={a.format === 'link' ? 'Ссылка на работу' : a.format === 'file' ? 'Файл' : 'Ответ'} hint="До дедлайна можно пересдавать сколько угодно раз — оценивается последняя версия">
                {a.format === 'text' ? (
                  <textarea className="textarea" style={{ minHeight: 140 }} value={content} onChange={(e) => setContent(e.target.value)} />
                ) : a.format === 'link' ? (
                  <input className="input" value={content} onChange={(e) => setContent(e.target.value)} placeholder="https://" />
                ) : (
                  <input
                    className="input"
                    type="file"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) setContent(f.name)
                    }}
                  />
                )}
              </Field>
              {pendingLate > 0 && (
                <div className="banner" style={{ margin: 0 }}>
                  <Icon name="alert" size={16} /> Дедлайн прошёл: штраф {state.settings.latePenaltyPct}% от максимума за каждые начатые сутки (сейчас −{fmtNum((pendingLate * state.settings.latePenaltyPct * a.maxScore) / 100)}). Сдача закроется через {fmtLeft(info.closeAt - now())}.
                </div>
              )}
              <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>
                {sub?.versions.length ? 'Пересдать' : 'Сдать работу'}
              </button>
            </form>
          ) : (
            !sub?.versions.length && <div className="banner">{now() < a.openAt ? 'Задание ещё не открыто' : 'Сдача закрыта. Продлить срок может преподаватель.'}</div>
          )}
          {sub && sub.reviews.some((r) => r.scores) && (
            <div>
              <div className="label-caps">Рецензии (анонимно)</div>
              {sub.reviews
                .filter((r) => r.scores)
                .map((r, i) => (
                  <div key={r.id} className="retro-item" style={{ marginBottom: 8 }}>
                    <div className="row-between">
                      <b>Рецензент {i + 1}</b>
                      <span className="mono">
                        {reviewScore(r)} / {a.maxScore}
                      </span>
                    </div>
                    <div className="small" style={{ margin: '4px 0' }}>
                      {r.comment}
                    </div>
                    {r.disputed ? (
                      <div className="tiny orange">
                        Оспорено: «{r.disputed.reason}» · {r.disputed.resolution ? (r.disputed.resolution === 'removed' ? 'рецензия исключена' : 'рецензия оставлена') : 'ждёт решения преподавателя'}
                      </div>
                    ) : (
                      r.doneAt &&
                      now() - r.doneAt < 48 * HOUR && (
                        <button className="link tiny" onClick={() => (setDispute(r.id), setReason(''))}>
                          Оспорить (осталось {fmtLeft(r.doneAt + 48 * HOUR - now())})
                        </button>
                      )
                    )}
                  </div>
                ))}
            </div>
          )}
        </div>
        <div className="side-props">
          <div className="stat">
            <div className="stat-label">Итоговая оценка</div>
            <div style={{ marginTop: 6 }}>
              <Formula a={a} sub={sub} />
            </div>
            {sub?.teacherComment && <div className="small" style={{ marginTop: 8 }}>«{sub.teacherComment}»</div>}
          </div>
          <div className="kv">
            <span className="muted">Открыто</span>
            <b>{fmtDateTime(a.openAt)}</b>
          </div>
          <div className="kv">
            <span className="muted">Дедлайн</span>
            <b>{fmtDateTime(info.deadline)}</b>
          </div>
          {sub?.extensionUntil && <div className="tiny green">Срок продлён преподавателем</div>}
          <div className="kv">
            <span className="muted">Закрытие сдачи</span>
            <b>{fmtDateTime(info.closeAt)}</b>
          </div>
          <div className="kv">
            <span className="muted">Формат</span>
            <b>{FORMAT[a.format]}</b>
          </div>
          {sub && sub.versions.length > 0 && (
            <>
              <div className="label-caps">Версии · {sub.versions.length}</div>
              {sub.versions
                .slice()
                .reverse()
                .map((v, i) => (
                  <div key={i} className="tiny">
                    {fmtDateTime(v.at)} {i === 0 && <b>(оценивается)</b>}
                  </div>
                ))}
            </>
          )}
          <div className="tiny muted">
            Итог = {state.settings.teacherWeight} × преподаватель + {state.settings.peerWeight} × среднее рецензентов. Поздняя сдача: −{state.settings.latePenaltyPct}% за сутки, через {state.settings.lateCloseHours} ч сдача закрывается.
          </div>
        </div>
      </div>
      {dispute && sub && (
        <Modal title="Оспорить рецензию" onClose={() => setDispute(null)} footer={<button className="btn btn-primary" onClick={() => act(disputeReview(sub.id, dispute, reason), 'Спор отправлен преподавателю') && setDispute(null)}>Отправить</button>}>
          <Field label="Почему рецензия несправедлива">
            <textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </Modal>
      )}
    </Modal>
  )
}

function ReviewModal({ subId, reviewId, onClose }: { subId: string; reviewId: string; onClose: () => void }) {
  const { state, act } = useMe()
  const sub = state.submissions.find((s) => s.id === subId)!
  const r = sub.reviews.find((x) => x.id === reviewId)!
  const a = state.assignments.find((x) => x.id === sub.assignmentId)!
  const [scores, setScores] = useState<number[]>(a.criteria.map(() => 0))
  const [comment, setComment] = useState('')
  return (
    <Modal
      title={`Peer-review · ${a.title}`}
      wide
      onClose={onClose}
      footer={
        <>
          <span className="tiny muted grow">Осталось {fmtLeft(r.assignedAt + 48 * HOUR - now())}</span>
          <button className="btn btn-primary" onClick={() => act(submitReview(subId, reviewId, scores, comment), 'Проверка отправлена') && onClose()}>
            Отправить проверку
          </button>
        </>
      }
    >
      <div className="banner banner-blue">
        <Icon name="eye" size={16} /> Проверка анонимна в обе стороны. Если ваша оценка отличается от оценки преподавателя более чем на {state.settings.peerDeviationPct}%, баллы активности не начисляются.
      </div>
      <div className="label-caps">Работа</div>
      <div className="retro-item" style={{ whiteSpace: 'pre-wrap' }}>
        {sub.versions[sub.versions.length - 1]?.content}
      </div>
      <div className="label-caps">Чек-лист</div>
      {a.criteria.map((c, i) => (
        <div key={c.text} className="row-between" style={{ padding: '6px 0' }}>
          <span>{c.text}</span>
          <span className="row">
            <input className="input input-sm" type="number" min={0} max={c.points} style={{ width: 70 }} value={scores[i]} onChange={(e) => setScores(scores.map((x, j) => (j === i ? Number(e.target.value) : x)))} />
            <span className="muted small">/ {c.points}</span>
          </span>
        </div>
      ))}
      <div className="row-between bold" style={{ padding: '6px 0' }}>
        <span>Итого</span>
        <span className="mono">
          {sum(scores)} / {a.maxScore}
        </span>
      </div>
      <Field label={`Комментарий · ${comment.trim().length}/100 минимум`} error={comment.trim().length < 100 && comment.length > 0 ? 'Не короче 100 символов' : null}>
        <textarea className="textarea" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Что получилось, что улучшить — конкретно и по критериям" />
      </Field>
    </Modal>
  )
}

/* ─────────── Преподаватель ─────────── */

function StaffAssignments() {
  const { state } = useMe()
  const [open, setOpen] = useState<string | null>(null)
  const [create, setCreate] = useState(false)
  const students = state.users.filter((u) => u.role === 'student' && u.courseIds.includes(state.course.id)).length
  const list = [...state.assignments].sort((a, b) => b.deadline - a.deadline)
  return (
    <>
      <PageHead
        crumb={`${state.course.name} · ${state.course.stream}`}
        title="Задания и оценки"
        actions={
          <button className="btn btn-primary" onClick={() => setCreate(true)}>
            + Новое задание
          </button>
        }
      />
      <div className="card">
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Задание</th>
                <th>Дедлайн</th>
                <th className="num">Сдали</th>
                <th className="num">Оценено</th>
                <th className="num">Рецензии</th>
                <th className="num">Споры</th>
              </tr>
            </thead>
            <tbody>
              {list.map((a) => {
                const subs = state.submissions.filter((s) => s.assignmentId === a.id && s.versions.length)
                const graded = subs.filter((s) => s.teacherScores).length
                const revs = subs.flatMap((s) => s.reviews)
                const disputes = revs.filter((r) => r.disputed && !r.disputed.resolution).length
                return (
                  <tr key={a.id} className="clickable" onClick={() => setOpen(a.id)}>
                    <td>
                      <div className="bold">{a.title}</div>
                      <div className="tiny muted">
                        {FORMAT[a.format]} · макс. {a.maxScore} {a.peerReview ? '· peer-review' : ''} {a.locked || isLocked(state, undefined, a.id) ? '· 🔒' : ''}
                      </div>
                    </td>
                    <td className="small nowrap">
                      {fmtDateTime(a.deadline)}
                      {a.deadline > now() && <div className="tiny blue">через {fmtLeft(a.deadline - now())}</div>}
                    </td>
                    <td className="num">
                      {subs.length}/{students}
                    </td>
                    <td className="num">
                      {graded < subs.length ? <span className="orange">{graded}</span> : graded}/{subs.length}
                    </td>
                    <td className="num">{a.peerReview ? `${revs.filter((r) => r.scores).length}/${revs.length}` : '—'}</td>
                    <td className="num">{disputes ? <span className="pill pill-orange">{disputes}</span> : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      {open && <StaffAssignmentModal a={state.assignments.find((x) => x.id === open)!} onClose={() => setOpen(null)} />}
      {create && <CreateAssignment onClose={() => setCreate(false)} />}
    </>
  )
}

function StaffAssignmentModal({ a, onClose }: { a: Assignment; onClose: () => void }) {
  const { state, act } = useMe()
  const [grade, setGrade] = useState<Submission | null>(null)
  const [ext, setExt] = useState<string | null>(null)
  const [extDate, setExtDate] = useState(toInputDT(now() + DAY))
  const [filter, setFilter] = useState<'all' | 'ungraded' | 'late' | 'disputes' | 'missing'>('all')
  const students = state.users.filter((u) => u.role === 'student' && u.courseIds.includes(state.course.id))
  const lock = state.locks.find((l) => l.scope === 'assignment' && l.targetId === a.id && !l.cancelled)
  const rows = students
    .map((u) => ({ u, sub: state.submissions.find((s) => s.assignmentId === a.id && s.studentId === u.id) }))
    .filter(({ sub }) => {
      if (filter === 'ungraded') return sub?.versions.length && !sub.teacherScores
      if (filter === 'late') return sub?.versions.length && lateInfo(a, sub, state).lateDays > 0
      if (filter === 'disputes') return sub?.reviews.some((r) => r.disputed && !r.disputed.resolution)
      if (filter === 'missing') return !sub?.versions.length
      return true
    })
  return (
    <Modal title={a.title} wide onClose={onClose}>
      <div className="row-between wrap" style={{ marginBottom: 12 }}>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Все' },
            { value: 'ungraded', label: 'Без оценки' },
            { value: 'late', label: 'Опоздания' },
            { value: 'disputes', label: 'Споры' },
            { value: 'missing', label: 'Не сдали' },
          ]}
        />
        <div className="row">
          {a.peerReview && now() > a.deadline && (
            <button className="btn btn-sm" onClick={() => act(runReviewAssignment(a.id), 'Рецензенты назначены')}>
              Назначить рецензентов
            </button>
          )}
          {lock ? (
            <button className="btn btn-sm" onClick={() => act(cancelLock(lock.id), 'Блокировка снята')}>
              <Icon name="lock" size={14} /> Снять блокировку
            </button>
          ) : (
            <button className="btn btn-sm" onClick={() => act(addLock('assignment', a.id, 'Задание закрыто преподавателем', now()), 'Задание переведено в «только чтение»')}>
              <Icon name="lock" size={14} /> Только чтение
            </button>
          )}
        </div>
      </div>
      <div className="table-wrap" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
        <table className="t">
          <thead>
            <tr>
              <th>Студент</th>
              <th>Сдано</th>
              <th className="num">Препод.</th>
              <th>Рецензенты (видны только вам)</th>
              <th>Итог</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ u, sub }) => {
              const info = lateInfo(a, sub, state)
              return (
                <tr key={u.id}>
                  <td className="bold">{u.name}</td>
                  <td className="small nowrap">
                    {sub?.versions.length ? (
                      <>
                        {fmtDateTime(submittedAt(sub))}
                        {info.lateDays > 0 && <div className="tiny orange">опоздание {info.lateDays} д · −{fmtNum(info.penalty)}</div>}
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                    {sub?.extensionUntil && <div className="tiny green">продлено до {fmtDateTime(sub.extensionUntil)}</div>}
                  </td>
                  <td className="num">{sub && teacherScore(sub) !== null ? teacherScore(sub) : '—'}</td>
                  <td className="small">
                    {sub?.reviews.map((r) => (
                      <div key={r.id}>
                        {state.users.find((x) => x.id === r.reviewerId)?.name.split(' ')[0]}: {r.scores ? <b className="mono">{reviewScore(r)}</b> : <span className="muted">ждём</span>}
                        {r.scores && sub.teacherScores && !reviewCounts(r, sub, a, state) && <span className="tiny orange"> · не засчитано</span>}
                        {r.disputed && !r.disputed.resolution && (
                          <span className="tiny">
                            {' '}
                            · <span className="orange">спор: «{r.disputed.reason}»</span>{' '}
                            <button className="link" onClick={() => act(resolveDispute(sub.id, r.id, 'removed'), 'Рецензия исключена')}>
                              исключить
                            </button>{' '}
                            /{' '}
                            <button className="link" onClick={() => act(resolveDispute(sub.id, r.id, 'kept'), 'Рецензия оставлена')}>
                              оставить
                            </button>
                          </span>
                        )}
                        {r.disputed?.resolution === 'removed' && <span className="tiny muted"> · исключена</span>}
                      </div>
                    ))}
                    {sub && activeReviews(sub).length > 0 && <div className="tiny muted">среднее {fmtNum(peerAvg(sub) ?? 0)}</div>}
                  </td>
                  <td>
                    <Formula a={a} sub={sub} />
                  </td>
                  <td className="nowrap">
                    {sub?.versions.length ? (
                      <button className="btn btn-sm" onClick={() => setGrade(sub)}>
                        {sub.teacherScores ? 'Изменить' : 'Оценить'}
                      </button>
                    ) : null}{' '}
                    {(info.closed || now() > a.deadline) && (
                      <button className="btn btn-sm btn-ghost" title="Продлить срок" onClick={() => setExt(u.id)}>
                        <Icon name="clock" size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!rows.length && <Empty>Нет записей</Empty>}
      </div>
      {grade && <GradeModal a={a} sub={grade} onClose={() => setGrade(null)} />}
      {ext && (
        <Modal title="Продлить срок студенту" onClose={() => setExt(null)} footer={<button className="btn btn-primary" onClick={() => act(extendFor(a.id, ext, fromInputDT(extDate)!), 'Срок продлён') && setExt(null)}>Продлить</button>}>
          <Field label="Новый дедлайн">
            <input className="input" type="datetime-local" value={extDate} onChange={(e) => setExtDate(e.target.value)} />
          </Field>
        </Modal>
      )}
    </Modal>
  )
}

function GradeModal({ a, sub, onClose }: { a: Assignment; sub: Submission; onClose: () => void }) {
  const { state, act } = useMe()
  const [scores, setScores] = useState<number[]>(sub.teacherScores ?? a.criteria.map(() => 0))
  const [comment, setComment] = useState(sub.teacherComment ?? '')
  const u = state.users.find((x) => x.id === sub.studentId)!
  const info = lateInfo(a, sub, state)
  const p = peerAvg(sub)
  const t = sum(scores)
  const preview = Math.max(0, (a.peerReview && p !== null ? state.settings.teacherWeight * t + state.settings.peerWeight * p : t) - info.penalty)
  return (
    <Modal
      title={`Оценка · ${u.name}`}
      onClose={onClose}
      footer={
        <button className="btn btn-primary" onClick={() => act(gradeWork(sub.id, scores, comment), 'Оценка сохранена, студент получил уведомление') && onClose()}>
          Сохранить оценку
        </button>
      }
    >
      <div className="retro-item" style={{ whiteSpace: 'pre-wrap', marginBottom: 12 }}>
        {sub.versions[sub.versions.length - 1]?.content}
      </div>
      {a.criteria.map((c, i) => (
        <div key={c.text} className="row-between" style={{ padding: '5px 0' }}>
          <span>{c.text}</span>
          <span className="row">
            <input className="input input-sm" type="number" min={0} max={c.points} style={{ width: 70 }} value={scores[i]} onChange={(e) => setScores(scores.map((x, j) => (j === i ? Number(e.target.value) : x)))} />
            <span className="muted small">/ {c.points}</span>
          </span>
        </div>
      ))}
      <Field label="Комментарий студенту">
        <textarea className="textarea" value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
      <div className="banner banner-blue" style={{ marginTop: 12, marginBottom: 0 }}>
        Итог: {a.peerReview && p !== null ? `${state.settings.teacherWeight} × ${t} + ${state.settings.peerWeight} × ${fmtNum(p)}` : t}
        {info.penalty > 0 && ` − ${fmtNum(info.penalty)} (опоздание ${info.lateDays} д)`} = <b>{fmtNum(Math.min(a.maxScore, preview))}</b>
      </div>
    </Modal>
  )
}

function CreateAssignment({ onClose }: { onClose: () => void }) {
  const { act } = useMe()
  const start = startOfDay(now()) + 9 * HOUR
  const [f, setF] = useState({ title: '', description: '', openAt: toInputDT(start), deadline: toInputDT(start + 7 * DAY + 14 * HOUR + 59 * 60000), maxScore: 10, format: 'text' as Assignment['format'], peerReview: true })
  const [crit, setCrit] = useState<Criterion[]>([
    { text: 'Полнота ответа', points: 4 },
    { text: 'Аргументация', points: 4 },
    { text: 'Оформление', points: 2 },
  ])
  const total = sum(crit.map((c) => c.points))
  return (
    <Modal
      title="Новое задание"
      wide
      onClose={onClose}
      footer={
        <button
          className="btn btn-primary"
          onClick={() => act(createAssignment({ ...f, openAt: fromInputDT(f.openAt)!, deadline: fromInputDT(f.deadline)!, criteria: crit }), 'Задание создано, студенты получили уведомление') && onClose()}
        >
          Создать задание
        </button>
      }
    >
      <div className="stack">
        <Field label="Название">
          <input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
        <Field label="Описание">
          <textarea className="textarea" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <div className="grid-3">
          <Field label="Открытие">
            <input className="input" type="datetime-local" value={f.openAt} onChange={(e) => setF({ ...f, openAt: e.target.value })} />
          </Field>
          <Field label="Дедлайн">
            <input className="input" type="datetime-local" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} />
          </Field>
          <Field label="Макс. балл">
            <input className="input" type="number" min={1} value={f.maxScore} onChange={(e) => setF({ ...f, maxScore: Number(e.target.value) })} />
          </Field>
        </div>
        <div className="row wrap" style={{ gap: 18 }}>
          <Field label="Формат сдачи">
            <Segmented
              value={f.format}
              onChange={(v) => setF({ ...f, format: v })}
              options={[
                { value: 'file', label: 'Файл' },
                { value: 'link', label: 'Ссылка' },
                { value: 'text', label: 'Текст' },
              ]}
            />
          </Field>
          <Toggle on={f.peerReview} onChange={(v) => setF({ ...f, peerReview: v })} label="Peer-review (2 рецензента)" />
        </div>
        <div>
          <div className="row-between">
            <span className="field-label">Чек-лист критериев</span>
            <span className={`small mono ${total === f.maxScore ? 'green' : 'orange'}`}>
              Σ {total} / {f.maxScore}
            </span>
          </div>
          {crit.map((c, i) => (
            <div key={i} className="row" style={{ marginTop: 6 }}>
              <input className="input input-sm" value={c.text} onChange={(e) => setCrit(crit.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
              <input className="input input-sm" type="number" style={{ width: 80 }} value={c.points} onChange={(e) => setCrit(crit.map((x, j) => (j === i ? { ...x, points: Number(e.target.value) } : x)))} />
              <button className="icon-btn" onClick={() => setCrit(crit.filter((_, j) => j !== i))}>
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
          <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => setCrit([...crit, { text: '', points: 1 }])}>
            + Критерий
          </button>
        </div>
      </div>
    </Modal>
  )
}
