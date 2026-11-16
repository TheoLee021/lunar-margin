import { describe, expect, it } from 'vitest'
import { FlightPreviewSchema, flightPoints } from './flightData'

const event = (phase: 'PARKING_COAST' | 'DOI_COAST', epoch: string) => ({
  epoch_utc: epoch,
  phase,
  moon_me_xyz_m: [0, 0, -1_800_000],
  j2000_xyz_m: [0, 0, -1_800_000],
  altitude_reference_m: 62_600,
})

const phaseState = {
  epoch_utc: '2027-01-10T00:00:00Z',
  phase: 'LOI',
  j2000_m_mps: [1, 2, 3, 4, 5, 6],
  moon_me_m_mps: [1, 2, 3, 4, 5, 6],
}

const response = {
  model: 'REFERENCE_ONLY_NOT_FLIGHT_CERTIFIED',
  status: 'NO_PDI_REFERENCE',
  note: 'No aligned orbit',
  target_latitude: -89,
  target_longitude: 30,
  orbit: {
    model: 'TWO_BODY_REFERENCE_NO_MISSION_FEASIBILITY',
    status: 'NO_ALIGNED_REFERENCE',
    target_lat_deg: -89,
    target_lon_deg: 30,
    approach_error_m: 10000,
    plane_offset_m: 10000,
    tolerance_m: 5000,
    parking_altitude_m: 100000,
    pdi_altitude_m: 15000,
    parking_period_s: 7000,
    coast_time_s: 3300,
    doi_delta_v_mps: 19,
    loi: phaseState,
    doi_pre: phaseState,
    doi_post: phaseState,
    pdi: phaseState,
    aligned_pdi_moon_me_m_mps: null,
    samples: [
      event('PARKING_COAST', '2027-01-10T00:00:00Z'),
      event('DOI_COAST', '2027-01-10T01:00:00Z'),
    ],
  },
  estimated_touchdown_utc: null,
  descent_epoch_utc: null,
  descent: null,
}

describe('flight preview visualization data', () => {
  it('never invents a descent when site alignment fails', () => {
    const parsed = FlightPreviewSchema.parse(response)
    expect(flightPoints(parsed).map((item) => item.phase)).toEqual([
      'PARKING_COAST',
      'DOI_COAST',
    ])
  })

  it('uses the computed PDI UTC as the descent time origin', () => {
    const withDescent = {
      ...response,
      status: 'DESCENT_REFERENCE_PASSED',
      estimated_touchdown_utc: '2027-01-10T01:01:00Z',
      descent_epoch_utc: '2027-01-10T01:00:00Z',
      descent: {
        status: 'REFERENCE_FEASIBLE',
        duration_s: 60,
        loft_m: 0,
        propellant_kg: 50,
        min_clearance_m: 0,
        max_thrust_n: 20000,
        min_thrust_n: 100,
        samples: [
          {
            t_s: 0,
            lat_deg: -89,
            lon_deg: 30,
            altitude_agl_m: 15000,
            speed_mps: 1600,
            thrust_n: 100,
            mass_kg: 1200,
            moon_me_xyz_m: [0, 0, -1752400],
          },
          {
            t_s: 60,
            lat_deg: -89,
            lon_deg: 30,
            altitude_agl_m: 0,
            speed_mps: 0,
            thrust_n: 1000,
            mass_kg: 1150,
            moon_me_xyz_m: [0, 0, -1737400],
          },
        ],
      },
    }
    const failed = FlightPreviewSchema.parse({
      ...withDescent,
      status: 'DESCENT_REFERENCE_FAILED',
      estimated_touchdown_utc: null,
    })
    expect(
      flightPoints(failed).some((point) => point.phase === 'POWERED_DESCENT'),
    ).toBe(false)
    const parsed = FlightPreviewSchema.parse(withDescent)
    const items = flightPoints(parsed)
    expect(items.at(-1)?.epochUtc).toBe('2027-01-10T01:01:00.000Z')
    expect(items.at(-1)?.phase).toBe('POWERED_DESCENT')
    expect(items.at(-1)?.thrustN).toBe(1000)
  })
})
