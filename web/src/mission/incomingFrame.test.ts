import { expect, it } from 'vitest'
import { incomingFrame, project } from './transferData'
it('preserves incoming transverse motion when the LOI burn turns the plane by 90 degrees', () => {
  const frame = incomingFrame({
    capture_plane_x: [1, 0, 0],
    capture_plane_y: [0, 1, 0],
    transfer: [
      { seconds: 0, spacecraft_km: [1837, 0, -8], moon_km: [0, 0, 0] },
      { seconds: 5, spacecraft_km: [1837, 0, 0], moon_km: [0, 0, 0] },
    ],
  })
  expect(project(frame, [1837, 0, -8])).toEqual([-1837, -8])
  expect(project(frame, [1837, 0, 0])).toEqual([-1837, 0])
})
