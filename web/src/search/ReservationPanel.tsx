import { useState, type FormEvent } from 'react'
import type { MissionRequest } from '../api/candidates'
import {
  cancelReservation,
  confirmReservation,
  fetchReservations,
  type Booking,
  type CandidateAvailability,
} from '../api/reservations'

const inputClass =
  'w-full rounded-lg border border-white/15 bg-[#171b21] px-3 py-2 text-sm text-neutral-100 disabled:opacity-50'
const buttonClass =
  'rounded-lg border border-white/20 px-3 py-2 text-xs text-neutral-100 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40'
function period(booking: Pick<Booking, 'starts_at' | 'ends_at'>) {
  return `${booking.starts_at.slice(0, 10)} → ${booking.ends_at.slice(0, 10)} UTC (종료 제외)`
}

export function ReservationPanel({
  mission,
  selected,
  onChanged,
}: {
  mission: MissionRequest | null
  selected: CandidateAvailability | null
  onChanged: () => void
}) {
  const [company, setCompany] = useState('')
  const [missionName, setMissionName] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [bookings, setBookings] = useState<Booking[] | null>(null)
  const [more, setMore] = useState(false)

  async function load(offset: number) {
    const result = await fetchReservations(offset)
    setBookings((current) =>
      offset === 0
        ? result.reservations
        : [...(current ?? []), ...result.reservations],
    )
    setMore(result.reservations.length === 100)
  }
  async function operate(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await action()
    } catch (cause: unknown) {
      setError(
        cause instanceof Error ? cause.message : '예약 요청에 실패했습니다',
      )
    } finally {
      setBusy(false)
    }
  }
  function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!mission || !selected || selected.status !== 'available') return
    void operate(async () => {
      try {
        await confirmReservation({
          company,
          mission_name: missionName,
          cell_ix: selected.cell_ix,
          cell_iy: selected.cell_iy,
          landing_date: mission.landing_date,
          mission_duration_days: mission.mission_duration_days,
        })
        setMessage(`${selected.cell_id} 예약을 확정했습니다.`)
      } finally {
        onChanged()
      }
      if (bookings !== null) await load(0)
    })
  }
  function cancel(booking: Booking) {
    void operate(async () => {
      try {
        await cancelReservation(booking.id)
        setMessage(
          `${booking.company} · ${booking.cell_id} 예약을 취소했습니다.`,
        )
      } finally {
        onChanged()
      }
      await load(0)
    })
  }

  return (
    <details className="rounded-xl border border-white/10 bg-[#101419]/95 p-4">
      <summary className="cursor-pointer text-sm font-semibold text-neutral-100">
        예약 관리
      </summary>
      <p className="mt-3 text-xs leading-5 text-neutral-400">
        공개 데모로 누구나 예약을 확정하거나 취소할 수 있습니다. 같은 500 × 500m
        격자의 겹치는 기간은 중복 예약할 수 없습니다.
      </p>
      <form className="mt-4 flex flex-col gap-3" onSubmit={confirm}>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs text-neutral-400">
            회사명
            <input
              className={inputClass}
              value={company}
              maxLength={120}
              required
              disabled={busy}
              onChange={(event) => setCompany(event.target.value)}
            />
          </label>
          <label className="text-xs text-neutral-400">
            임무명
            <input
              className={inputClass}
              value={missionName}
              maxLength={120}
              required
              disabled={busy}
              onChange={(event) => setMissionName(event.target.value)}
            />
          </label>
        </div>
        <div className="rounded-lg border border-white/10 p-3 text-xs leading-6 text-neutral-300">
          <p>
            선택 격자:{' '}
            <span className="font-mono text-neutral-100">
              {selected?.cell_id ?? '후보 표에서 ID를 선택하세요'}
            </span>
          </p>
          {mission ? (
            <p>
              착륙일 {mission.landing_date} 00:00 UTC부터{' '}
              {mission.mission_duration_days}일 동안 예약
            </p>
          ) : (
            <p className="text-amber-300">
              이 실행에는 임무 입력이 없습니다. 위에서 착륙일과 표면 임무 기간을
              지정해 탐색한 뒤 예약하세요.
            </p>
          )}
          {selected?.status === 'reserved' ? (
            <p className="text-amber-300">
              예약됨 · 이 기간에는 확정할 수 없습니다.
            </p>
          ) : null}
        </div>
        <button
          className={buttonClass}
          type="submit"
          disabled={
            busy ||
            !company.trim() ||
            !missionName.trim() ||
            !mission ||
            selected?.status !== 'available'
          }
        >
          선택 격자 예약 확정
        </button>
      </form>
      <div className="mt-4 flex flex-col gap-3">
        <button
          className={`${buttonClass} self-start`}
          type="button"
          disabled={busy}
          onClick={() => {
            void operate(() => load(0))
          }}
        >
          예약 이력 조회
        </button>
        {busy ? (
          <p role="status" className="text-xs text-neutral-400">
            예약 요청 처리 중…
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        ) : null}
        {message ? (
          <p role="status" className="text-sm text-emerald-300">
            {message}
          </p>
        ) : null}
        {bookings?.length === 0 ? (
          <p className="text-xs text-neutral-400">등록된 예약이 없습니다.</p>
        ) : null}
        {bookings && bookings.length > 0 ? (
          <ul
            className="max-h-80 space-y-2 overflow-auto"
            aria-label="예약 이력"
          >
            {bookings.map((booking) => (
              <li
                key={booking.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 p-3 text-xs"
              >
                <div>
                  <p className="font-medium text-neutral-100">
                    {booking.company} · {booking.mission_name} ·{' '}
                    {booking.status === 'confirmed' ? '확정' : '취소됨'}
                  </p>
                  <p className="mt-1 font-mono text-neutral-400">
                    {booking.cell_id}
                  </p>
                  <p className="mt-1 text-neutral-400">{period(booking)}</p>
                </div>
                {booking.status === 'confirmed' ? (
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={busy}
                    aria-label={`${booking.company} ${booking.mission_name} 예약 취소`}
                    onClick={() => cancel(booking)}
                  >
                    예약 취소
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {more && bookings ? (
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            onClick={() => {
              void operate(() => load(bookings.length))
            }}
          >
            이전 예약 더 보기
          </button>
        ) : null}
      </div>
    </details>
  )
}
