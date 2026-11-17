import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'

/** Ошибка бизнес-правила — текст показывается пользователю как есть (как тост на фронтенде) */
export const fail = (message: string): never => {
  throw new BadRequestException(message)
}
export const forbid = (message = 'Недостаточно прав'): never => {
  throw new ForbiddenException(message)
}
export const notFound = (message = 'Не найдено'): never => {
  throw new NotFoundException(message)
}

/** Если проверка вернула текст ошибки — выбросить его */
export const check = (err: string | null | undefined | void) => {
  if (err) fail(err)
}

export function must<T>(v: T | null | undefined, message = 'Не найдено'): T {
  if (v === null || v === undefined) notFound(message)
  return v as T
}
