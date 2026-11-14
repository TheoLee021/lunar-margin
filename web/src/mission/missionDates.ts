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
export function exampleCost(departure: number, landing: number): number | null {
  const flight = landing - departure
  if (flight < 1) return null
  return (
    Math.round(
      (76 +
        Math.abs(flight - 4) * 9 +
        (Math.sin(departure * 0.8) + 1) * 8 +
        (Math.cos(landing * 0.7) + 1) * 5) *
        10,
    ) / 10
  )
}
