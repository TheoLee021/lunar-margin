export const DAY = 86_400_000
export const BASE_DAY = Date.UTC(2026, 0, 1) / DAY
export const iso = (day: number) =>
  new Date(day * DAY).toISOString().slice(0, 10)
export const dayOf = (date: string) => Math.round(Date.parse(date) / DAY)
export const compact = (date: string) => date.replaceAll('-', '.')
export const short = (day: number) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    timeZone: 'UTC',
  }).format(day * DAY)
