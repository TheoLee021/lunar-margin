import { z } from 'zod'

const vector3 = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
])
const phase = z.object({
  epoch_utc: z.iso.datetime({ offset: true }),
  phase: z.string(),
  j2000_m_mps: z.array(z.number()).length(6),
  moon_me_m_mps: z.array(z.number()).length(6),
})
const orbitSample = z.object({
  epoch_utc: z.iso.datetime({ offset: true }),
  phase: z.enum(['PARKING_COAST', 'DOI_COAST']),
  moon_me_xyz_m: vector3,
  j2000_xyz_m: vector3,
  altitude_reference_m: z.number(),
})
const flightSample = z.object({
  t_s: z.number().nonnegative(),
  lat_deg: z.number(),
  lon_deg: z.number(),
  altitude_agl_m: z.number().nullable(),
  speed_mps: z.number(),
  thrust_n: z.number(),
  mass_kg: z.number(),
  moon_me_xyz_m: vector3,
})
export const FlightPreviewSchema = z.object({
  model: z.literal('REFERENCE_ONLY_NOT_FLIGHT_CERTIFIED'),
  status: z.enum([
    'NO_PDI_REFERENCE',
    'DESCENT_REFERENCE_PASSED',
    'DESCENT_REFERENCE_FAILED',
  ]),
  note: z.string(),
  target_latitude: z.number(),
  target_longitude: z.number(),
  orbit: z.object({
    model: z.string(),
    status: z.enum(['REFERENCE_ALIGNED', 'NO_ALIGNED_REFERENCE']),
    target_lat_deg: z.number(),
    target_lon_deg: z.number(),
    approach_error_m: z.number().nonnegative(),
    plane_offset_m: z.number().nonnegative(),
    tolerance_m: z.number().positive(),
    parking_altitude_m: z.number(),
    pdi_altitude_m: z.number(),
    parking_period_s: z.number(),
    coast_time_s: z.number(),
    doi_delta_v_mps: z.number(),
    loi: phase,
    doi_pre: phase,
    doi_post: phase,
    pdi: phase,
    aligned_pdi_moon_me_m_mps: z.array(z.number()).length(6).nullable(),
    samples: z.array(orbitSample).min(2),
  }),
  descent_epoch_utc: z.string().nullable(),
  descent: z
    .object({
      status: z.string(),
      duration_s: z.number(),
      loft_m: z.number(),
      propellant_kg: z.number().nullable(),
      min_clearance_m: z.number().nullable(),
      max_thrust_n: z.number().nullable(),
      min_thrust_n: z.number().nullable(),
      samples: z.array(flightSample),
    })
    .nullable(),
})

export type FlightPreview = z.infer<typeof FlightPreviewSchema>
export type FlightPoint = {
  epochUtc: string
  moonMe: [number, number, number]
  phase: 'PARKING_COAST' | 'DOI_COAST' | 'POWERED_DESCENT'
  altitudeM: number | null
  speedMps: number | null
  thrustN: number | null
  massKg: number | null
}

export function flightPoints(data: FlightPreview): FlightPoint[] {
  const orbit: FlightPoint[] = data.orbit.samples.map((sample) => ({
    epochUtc: sample.epoch_utc,
    moonMe: sample.moon_me_xyz_m,
    phase: sample.phase,
    altitudeM: sample.altitude_reference_m,
    speedMps: null,
    thrustN: null,
    massKg: null,
  }))
  if (data.descent && data.descent_epoch_utc) {
    const pdiTime = Date.parse(data.descent_epoch_utc)
    for (const sample of data.descent.samples) {
      if (sample.t_s === 0) continue
      orbit.push({
        epochUtc: new Date(pdiTime + sample.t_s * 1000).toISOString(),
        moonMe: sample.moon_me_xyz_m,
        phase: 'POWERED_DESCENT',
        altitudeM: sample.altitude_agl_m,
        speedMps: sample.speed_mps,
        thrustN: sample.thrust_n,
        massKg: sample.mass_kg,
      })
    }
  }
  return orbit
}
