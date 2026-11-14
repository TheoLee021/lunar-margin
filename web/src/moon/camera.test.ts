import { describe, expect, it } from 'vitest'
import { shouldFreeCameraAxis } from './camera'

describe('shouldFreeCameraAxis', () => {
  it('keeps the axis constrained at mid latitudes', () => {
    expect(shouldFreeCameraAxis(-45, false)).toBe(false)
  })

  it('frees the axis once the camera is over the south polar cap', () => {
    expect(shouldFreeCameraAxis(-85, false)).toBe(true)
  })

  it('stays free while drifting just outside the cap, so the axis does not flicker', () => {
    expect(shouldFreeCameraAxis(-78, true)).toBe(true)
  })

  it('does not free the axis in that band when it was constrained', () => {
    expect(shouldFreeCameraAxis(-78, false)).toBe(false)
  })

  it('constrains the axis again once well away from the pole', () => {
    expect(shouldFreeCameraAxis(-74, true)).toBe(false)
  })

  it('treats the north polar cap the same way', () => {
    expect(shouldFreeCameraAxis(85, false)).toBe(true)
  })
})
