import { describe, expect, it } from 'vitest'
import { confirmReservation, fetchAvailability } from './reservations'

const booking = {
  id: '88b02b95-e126-4c10-9d89-3a3b4417ff33',
  cell_id: 'SP500v1:1:2',
  cell_ix: 1,
  cell_iy: 2,
  company: 'A',
  mission_name: 'M',
  starts_at: '2027-01-01T00:00:00Z',
  ends_at: '2027-01-15T00:00:00Z',
  confirmed_at: '2026-11-14T20:00:00Z',
  status: 'confirmed',
  cancelled_at: null,
}

describe('reservation API boundary', () => {
  it('validates live availability and escapes the run ID', async () => {
    const data = {
      run_id: 'demo',
      checked_at: booking.confirmed_at,
      starts_at: booking.starts_at,
      ends_at: booking.ends_at,
      candidates: [
        {
          candidate_id: 'p1',
          cell_id: booking.cell_id,
          cell_ix: 1,
          cell_iy: 2,
          status: 'reserved',
          available_rank: null,
          conflicts: [booking],
        },
      ],
    }
    const result = await fetchAvailability('demo/a', {
      baseUrl: '',
      fetchFn: async (url) => {
        expect(url).toBe('/candidates/runs/demo%2Fa/availability')
        return Response.json(data)
      },
    })
    expect(result.candidates[0]?.conflicts[0]?.company).toBe('A')
  })
  it('sends operator authorization only on mutation and propagates a conflict', async () => {
    await expect(
      confirmReservation(
        {
          company: 'A',
          mission_name: 'M',
          cell_ix: 1,
          cell_iy: 2,
          landing_date: '2027-01-01',
          mission_duration_days: 14,
        },
        'operator-secret',
        {
          baseUrl: '',
          fetchFn: async (url, init) => {
            expect(url).toBe('/reservations')
            expect(init?.method).toBe('POST')
            expect(new Headers(init?.headers).get('Authorization')).toBe(
              'Bearer operator-secret',
            )
            expect(init?.body).not.toContain('operator-secret')
            return Response.json({ detail: '이미 예약됨' }, { status: 409 })
          },
        },
      ),
    ).rejects.toMatchObject({ status: 409, message: '이미 예약됨' })
  })
  it('rejects malformed server data instead of displaying available', async () => {
    await expect(
      fetchAvailability('demo', {
        fetchFn: async () => Response.json({ candidates: [] }),
      }),
    ).rejects.toThrow()
  })
})
