import { useState } from 'react'
import { useStore } from '../store'
import { navigate } from '../router'
import { Avatar, Icon } from '../components/ui'
import { ROLE_RU } from '../data/actions'

/**
 * Вход только через корпоративную почту (OAuth 2.0 / OpenID Connect).
 * В демо окно провайдера имитируется: выбирается учётная запись, домен проверяется.
 */
export default function Login() {
  const { state, login } = useStore()
  const [step, setStep] = useState<'start' | 'pick'>('start')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const domain = state.admin.domain

  const enter = (mail: string) => {
    const e = mail.trim().toLowerCase()
    if (!e) return setError('Введите корпоративную почту')
    if (state.admin.blockOtherDomains && !e.endsWith('@' + domain)) return setError(`Вход разрешён только с корпоративной почты @${domain}. Адрес «${e}» отклонён.`)
    const u = state.users.find((x) => x.email === e)
    if (!u) return setError('Учётная запись не найдена в списках курса. Обратитесь к преподавателю или войдите по коду приглашения.')
    if (u.blocked) return setError('Учётная запись заблокирована администратором')
    login(u.id)
    navigate(u.role === 'student' ? '/dashboard' : u.role === 'admin' ? '/admin' : '/analytics')
  }

  const demo = [
    state.users.find((u) => u.name === 'Айгерим Сапарова')!,
    state.users.find((u) => u.name === 'Данияр Ахметов')!,
    state.users.find((u) => u.id === 't1')!,
    state.users.find((u) => u.id === 'as1')!,
    state.users.find((u) => u.id === 'adm')!,
  ]

  return (
    <div className="login">
      <div className="login-side">
        <div className="brand" style={{ padding: 0 }}>
          <div className="brand-logo">DC</div>
          <div>
            <div className="brand-name">Digital IT Company</div>
            <div className="brand-sub">Лидерство в IT</div>
          </div>
        </div>
        <div>
          <h1>
            15 недель
            <br />
            как IT-компания
          </h1>
          <p style={{ color: '#b9bac0', maxWidth: 420 }}>Индивидуальные задания, команды, спринты и прозрачный рейтинг. Каждая задача и сообщение сохраняются с автором и временем.</p>
        </div>
        <div className="tiny" style={{ color: '#8b8d93' }}>
          {state.course.name} · {state.course.stream}
        </div>
      </div>
      <div className="login-main">
        <div className="login-box">
          <h2 style={{ fontSize: 26, marginBottom: 6 }}>Вход</h2>
          <p className="muted" style={{ marginTop: 0, marginBottom: 22 }}>
            Только через корпоративную почту университета (@{domain}).
          </p>
          {step === 'start' ? (
            <div className="stack">
              <button className="provider-btn" onClick={() => (setStep('pick'), setError(null))}>
                <span className="ms-logo">
                  <i style={{ background: '#f25022' }} />
                  <i style={{ background: '#7fba00' }} />
                  <i style={{ background: '#00a4ef' }} />
                  <i style={{ background: '#ffb900' }} />
                </span>
                Войти через {state.admin.provider}
              </button>
              <div className="row muted small" style={{ gap: 10 }}>
                <div className="grow" style={{ borderTop: '1px solid var(--line)' }} /> или по адресу <div className="grow" style={{ borderTop: '1px solid var(--line)' }} />
              </div>
              <form
                className="stack-sm"
                onSubmit={(e) => {
                  e.preventDefault()
                  enter(email)
                }}
              >
                <input className="input" type="email" placeholder={`name@${domain}`} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
                <button className="btn btn-primary btn-block" style={{ height: 44 }}>
                  Продолжить
                </button>
              </form>
              {error && (
                <div className="banner" style={{ margin: 0 }}>
                  <Icon name="alert" size={16} />
                  {error}
                </div>
              )}
            </div>
          ) : (
            <div className="stack-sm">
              <div className="small muted">Выберите учётную запись ({state.admin.provider})</div>
              {demo.map((u) => (
                <button key={u.id} className="account" onClick={() => enter(u.email)}>
                  <Avatar user={u} size={36} />
                  <span className="grow">
                    <div className="bold">{u.name}</div>
                    <div className="tiny muted">
                      {u.email} · {ROLE_RU[u.role]}
                    </div>
                  </span>
                </button>
              ))}
              <button className="account" onClick={() => enter('aigerim@gmail.com')}>
                <span className="avatar" style={{ width: 36, height: 36 }}>
                  G
                </span>
                <span className="grow">
                  <div className="bold">Личный аккаунт</div>
                  <div className="tiny muted">aigerim@gmail.com — проверка запрета чужих доменов</div>
                </span>
              </button>
              {error && (
                <div className="banner" style={{ margin: '6px 0 0' }}>
                  <Icon name="alert" size={16} />
                  {error}
                </div>
              )}
              <button className="btn btn-ghost" onClick={() => (setStep('start'), setError(null))}>
                ← Назад
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
