import { Injectable } from '@nestjs/common'
import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'
import { existsSync } from 'fs'
import { CourseContext } from '../common/course-context.service'
import { AuditService } from '../common/audit.service'
import { config } from '../common/config'
import { fail, forbid, must } from '../common/errors'
import type { Actor } from '../common/actor'
import type { State } from '../domain/types'
import { BADGES, allScores, badgesOf, finalGrade, isStaff, teamMetrics } from '../domain/rules'
import { fmtDate, fmtDateTime, round1 } from '../domain/util'

export type Format = 'xlsx' | 'pdf'
export interface Report {
  filename: string
  mime: string
  body: Buffer
}

interface Table {
  title: string
  subtitle?: string
  sections: { heading?: string; columns: { header: string; width: number }[]; rows: (string | number)[][] }[]
}

const FONT_CANDIDATES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/TTF/DejaVuSans.ttf',
  'C:/Windows/Fonts/arial.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/Library/Fonts/Arial.ttf',
]

const n1 = (v: number | null | undefined) => (v === null || v === undefined ? '' : round1(v))

/** Экспорт отчётов в PDF и Excel (.xlsx), п. 8 ТЗ */
@Injectable()
export class ReportsService {
  constructor(
    private readonly ctx: CourseContext,
    private readonly audit: AuditService,
  ) {}

  /* ───────── данные отчётов ───────── */

  private gradebook(s: State): Table {
    const sc = allScores(s)
    const rows = s.users
      .filter((u) => u.role === 'student')
      .map((u) => ({ u, v: sc.get(u.id)! }))
      .filter((x) => x.v)
      .sort((a, b) => a.v.place - b.v.place)
      .map(({ u, v }) => [
        v.place, u.name, u.group, s.teams.find((t) => t.id === u.teamId)?.name ?? '—',
        n1(v.I), n1(v.A), n1(v.R1), n1(v.K), n1(v.P), n1(v.R2), n1(v.RD), v.RD >= s.settings.admissionThreshold ? 'да' : 'нет',
      ])
    return {
      title: `Ведомость баллов · ${s.course.name} · ${s.course.stream}`,
      subtitle: `Сформирована ${fmtDateTime(Date.now())}. РД = (Р1 + Р2) / 2, Р1 = И + А, Р2 = К + П. Порог допуска — ${s.settings.admissionThreshold}`,
      sections: [
        {
          columns: [
            { header: '№', width: 5 }, { header: 'ФИО', width: 30 }, { header: 'Группа', width: 11 }, { header: 'Команда', width: 18 },
            { header: 'И', width: 7 }, { header: 'А', width: 7 }, { header: 'Р1', width: 7 }, { header: 'К', width: 7 }, { header: 'П', width: 7 }, { header: 'Р2', width: 7 }, { header: 'РД', width: 7 }, { header: 'Допуск', width: 9 },
          ],
          rows,
        },
      ],
    }
  }

  private team(s: State, teamId: string): Table {
    const team = must(s.teams.find((t) => t.id === teamId), 'Команда не найдена')
    const sc = allScores(s)
    const m = teamMetrics(s, team, { from: s.course.start, to: Date.now(), label: '' })
    const members = team.memberIds.map((id) => {
      const u = s.users.find((x) => x.id === id)!
      const v = sc.get(id)
      const load = m.load.find((l) => l.id === id)
      return [u?.name ?? id, u?.teamRole ?? '', load ? `${load.pct}%` : '0%', n1(v?.R1), n1(v?.K), n1(v?.P), n1(v?.R2), n1(v?.RD)]
    })
    const sprints = s.sprints
      .filter((x) => x.teamId === teamId)
      .map((sp) => [sp.name, fmtDate(sp.start), fmtDate(sp.end), sp.status === 'closed' ? 'закрыт' : sp.status === 'active' ? 'активен' : 'план', sp.report?.planned ?? '', sp.report?.done ?? '', sp.report?.overdue ?? '', sp.report ? `${sp.report.doneSp}/${sp.report.plannedSp}` : '', s.retros.some((r) => r.sprintId === sp.id && r.items.length) ? 'да' : 'нет'])
    return {
      title: `Отчёт по команде ${team.name}`,
      subtitle: `${s.course.name} · ${s.course.stream}. Проект: ${team.idea}. Балл проекта: ${team.projectScore} из 60`,
      sections: [
        {
          heading: 'Показатели',
          columns: [{ header: 'Метрика', width: 40 }, { header: 'Значение', width: 20 }],
          rows: [
            ['Карточек', m.cards], ['Выполнено', m.doneCount], ['Story points сделано / всего', `${m.spDone} / ${m.spTotal}`],
            ['Соблюдение сроков', m.onTimePct === null ? '—' : `${m.onTimePct}%`], ['Просрочено сейчас', m.overdue],
            ['Время выполнения, дней', m.cycleDays === null ? '—' : round1(m.cycleDays)], ['Сообщений и комментариев в неделю', m.chatPerWeek],
          ],
        },
        { heading: 'Участники', columns: [{ header: 'ФИО', width: 30 }, { header: 'Роль', width: 14 }, { header: 'Доля SP', width: 9 }, { header: 'Р1', width: 7 }, { header: 'К', width: 7 }, { header: 'П', width: 7 }, { header: 'Р2', width: 7 }, { header: 'РД', width: 7 }], rows: members },
        { heading: 'Спринты', columns: [{ header: 'Спринт', width: 14 }, { header: 'Начало', width: 11 }, { header: 'Конец', width: 11 }, { header: 'Статус', width: 10 }, { header: 'План', width: 7 }, { header: 'Сделано', width: 8 }, { header: 'Просроч.', width: 8 }, { header: 'SP', width: 9 }, { header: 'Ретро', width: 7 }], rows: sprints },
      ],
    }
  }

  private student(s: State, userId: string): Table {
    const u = must(s.users.find((x) => x.id === userId && x.role === 'student'), 'Студент не найден')
    const v = allScores(s).get(userId)
    const grades = s.assignments
      .filter((a) => a.deadline < Date.now())
      .map((a) => {
        const sub = s.submissions.find((x) => x.assignmentId === a.id && x.studentId === userId)
        const g = finalGrade(a, sub, s)
        return [a.title, sub?.versions.length ? fmtDateTime(sub.versions[sub.versions.length - 1].at) : 'не сдано', g === null ? '—' : g, a.maxScore]
      })
    const badges = badgesOf(s, u).map((k) => BADGES.find((b) => b.key === k)?.title ?? k)
    return {
      title: `Карточка студента · ${u.name}`,
      subtitle: `${u.email} · группа ${u.group} · команда ${s.teams.find((t) => t.id === u.teamId)?.name ?? '—'} · ${u.teamRole ?? ''}. Место в курсе: ${v?.place ?? '—'}`,
      sections: [
        {
          heading: 'Рейтинг',
          columns: [{ header: 'Компонент', width: 44 }, { header: 'Баллы', width: 10 }],
          rows: v
            ? [
                ['И — индивидуальные задания (из 60)', n1(v.I)],
                ['А — активность (из 40)', n1(v.A)],
                ['   профиль / рецензии / сдачи в срок / вручную', `${v.A_parts.profile} / ${v.A_parts.reviews} / ${v.A_parts.onTime} / ${v.A_parts.manual}`],
                ['Р1', n1(v.R1)],
                ['К — работа в команде (из 40)', n1(v.K)],
                ['   сроки / вклад / оценка коллег / ретро', `${n1(v.K_parts.onTime)} / ${n1(v.K_parts.volume)} / ${n1(v.K_parts.peers)} / ${n1(v.K_parts.retro)}`],
                ['П — проект (из 60)', n1(v.P)],
                ['Р2', n1(v.R2)],
                ['РД = (Р1 + Р2) / 2', n1(v.RD)],
                ['Допуск к экзамену', v.RD >= s.settings.admissionThreshold ? 'да' : `нет, не хватает ${n1(s.settings.admissionThreshold - v.RD)}`],
              ]
            : [],
        },
        { heading: 'Задания', columns: [{ header: 'Задание', width: 44 }, { header: 'Сдано', width: 16 }, { header: 'Оценка', width: 8 }, { header: 'Макс.', width: 7 }], rows: grades },
        {
          heading: 'Ручные начисления',
          columns: [{ header: 'Дата', width: 16 }, { header: 'Компонент', width: 10 }, { header: 'Баллы', width: 8 }, { header: 'Причина', width: 42 }],
          rows: s.adjustments.filter((a) => a.studentId === userId).map((a) => [fmtDateTime(a.at), a.component, a.delta, a.reason]),
        },
        { heading: 'Достижения', columns: [{ header: 'Достижение', width: 44 }], rows: badges.map((b) => [b]) },
      ],
    }
  }

  private async chat(s: State, teamId: string): Promise<Table> {
    const team = must(s.teams.find((t) => t.id === teamId), 'Команда не найдена')
    const name = (id: string) => s.users.find((u) => u.id === id)?.name ?? id
    const rows = s.messages
      .filter((m) => m.channelId === team.channelId)
      .map((m) => [
        fmtDateTime(m.at),
        name(m.authorId),
        m.text + (m.files?.length ? ` [файлы: ${m.files.map((f) => f.name).join(', ')}]` : ''),
        [m.parentId ? 'ответ в ветке' : '', m.editedAt ? `изменено, было: «${m.originalText ?? ''}»` : '', m.deletedAt ? `удалено ${fmtDateTime(m.deletedAt)}` : ''].filter(Boolean).join('; '),
      ])
    return {
      title: `История чата команды ${team.name}`,
      subtitle: `Канал #${s.channels.find((c) => c.id === team.channelId)?.name ?? ''} · ${rows.length} сообщений · включая удалённые и отредактированные`,
      sections: [{ columns: [{ header: 'Время', width: 14 }, { header: 'Автор', width: 22 }, { header: 'Сообщение', width: 60 }, { header: 'Отметки', width: 24 }], rows }],
    }
  }

  /* ───────── точки входа ───────── */

  async build(actor: Actor, kind: 'gradebook' | 'team' | 'student' | 'chat', id: string | undefined, format: Format): Promise<Report> {
    if (format !== 'xlsx' && format !== 'pdf') fail('Формат: pdf или xlsx')
    const c = await this.ctx.read(actor)
    const staff = isStaff(c.me) || c.me.role === 'admin'
    let table: Table
    let base: string
    switch (kind) {
      case 'gradebook':
        if (!staff) forbid('Ведомость курса выгружает преподаватель')
        table = this.gradebook(c.s)
        base = `vedomost-${c.s.course.stream}`
        break
      case 'team':
        if (!staff) forbid('Отчёт по команде выгружает преподаватель')
        table = this.team(c.s, must(id, 'Не указана команда'))
        base = `team-${c.s.teams.find((t) => t.id === id)?.name ?? id}`
        break
      case 'student': {
        const uid = id ?? c.me.id
        if (!staff && uid !== c.me.id) forbid('Студент выгружает только свой профиль')
        table = this.student(c.s, uid)
        base = `student-${c.s.users.find((u) => u.id === uid)?.name ?? uid}`
        break
      }
      case 'chat':
        if (!staff) forbid('Историю чата выгружает преподаватель')
        table = await this.chat(c.s, must(id, 'Не указана команда'))
        base = `chat-${c.s.teams.find((t) => t.id === id)?.name ?? id}`
        break
      default:
        fail('Неизвестный отчёт')
        throw new Error()
    }
    const body = format === 'xlsx' ? await this.xlsx(table) : await this.pdf(table)
    await this.audit.log(actor, c.courseId, `Выгружен отчёт: ${table.title} (${format.toUpperCase()})`, { objectType: 'report', objectId: id })
    const safe = base.replace(/[^\p{L}\p{N}._-]+/gu, '_')
    return {
      filename: `${safe}.${format}`,
      mime: format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf',
      body,
    }
  }

  private async xlsx(t: Table): Promise<Buffer> {
    const wb = new ExcelJS.Workbook()
    wb.creator = 'Digital IT Company Simulation'
    const ws = wb.addWorksheet('Отчёт')
    ws.addRow([t.title]).font = { bold: true, size: 14 }
    if (t.subtitle) ws.addRow([t.subtitle]).font = { italic: true, color: { argb: 'FF666666' } }
    const widths: number[] = []
    for (const sec of t.sections) {
      ws.addRow([])
      if (sec.heading) ws.addRow([sec.heading]).font = { bold: true, size: 12 }
      const head = ws.addRow(sec.columns.map((c) => c.header))
      head.font = { bold: true }
      head.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFF2' } }
        cell.border = { bottom: { style: 'thin' } }
      })
      sec.columns.forEach((c, i) => (widths[i] = Math.max(widths[i] ?? 0, c.width)))
      for (const r of sec.rows) ws.addRow(r).alignment = { wrapText: true, vertical: 'top' }
    }
    widths.forEach((w, i) => (ws.getColumn(i + 1).width = w + 2))
    return Buffer.from(await wb.xlsx.writeBuffer())
  }

  private font() {
    const f = [config.pdfFont, ...FONT_CANDIDATES].find((p) => p && existsSync(p))
    if (!f) fail('Для PDF нужен шрифт с кириллицей: установите fonts-dejavu-core или задайте PDF_FONT')
    return f!
  }

  private pdf(t: Table): Promise<Buffer> {
    const font = this.font()
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, info: { Title: t.title, Creator: 'Digital IT Company Simulation' } })
      const chunks: Buffer[] = []
      doc.on('data', (c: Buffer) => chunks.push(c))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)
      doc.registerFont('main', font)
      doc.font('main')
      const left = doc.page.margins.left
      const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right
      const bottom = doc.page.height - doc.page.margins.bottom

      doc.fontSize(15).text(t.title, { width: usable })
      if (t.subtitle) doc.moveDown(0.2).fontSize(9).fillColor('#555').text(t.subtitle, { width: usable }).fillColor('#000')

      for (const sec of t.sections) {
        doc.moveDown(0.8)
        if (sec.heading) doc.fontSize(11.5).text(sec.heading).moveDown(0.3)
        const total = sec.columns.reduce((a, c) => a + c.width, 0)
        const widths = sec.columns.map((c) => (c.width / total) * usable)
        const drawRow = (cells: (string | number)[], header = false) => {
          doc.fontSize(header ? 8.5 : 8.5)
          const h = Math.max(...cells.map((v, i) => doc.heightOfString(String(v ?? ''), { width: widths[i] - 6 }))) + 6
          if (doc.y + h > bottom) {
            doc.addPage()
            doc.font('main')
          }
          const y = doc.y
          if (header) doc.rect(left, y, usable, h).fill('#efeff2').fillColor('#000')
          let x = left
          cells.forEach((v, i) => {
            doc.text(String(v ?? ''), x + 3, y + 3, { width: widths[i] - 6 })
            x += widths[i]
          })
          doc.moveTo(left, y + h).lineTo(left + usable, y + h).lineWidth(0.4).strokeColor('#d0d0d6').stroke()
          doc.x = left
          doc.y = y + h
        }
        drawRow(sec.columns.map((c) => c.header), true)
        if (!sec.rows.length) drawRow(['—'])
        for (const r of sec.rows) drawRow(r)
      }
      doc.end()
    })
  }
}
