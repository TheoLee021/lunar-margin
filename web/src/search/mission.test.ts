import { describe, expect, it } from 'vitest'
import type { MissionRequest } from '../api/candidates'
import {
  DEFAULT_MISSION_VALUES,
  missionRequestJson,
  missionSummaryItems,
  parseMissionForm,
  priorityLabel,
  windowPreview,
  windowPreviewText,
  type MissionFormValues,
} from './mission'

// 사용자가 제시한 입력 예시 (docs/api.md 요청 본문)
const EXAMPLE: MissionRequest = {
  landing_date: '2027-01-01',
  mission_duration_days: 14,
  max_continuous_darkness_hours: 24,
  max_communication_blackout_hours: 6,
  max_terrain_slope_degrees: 10,
  search_region: 'south',
  optimization_priority: 'balanced',
  observer_height_m: null,
}

function values(patch: Partial<MissionFormValues> = {}): MissionFormValues {
  return { ...DEFAULT_MISSION_VALUES, ...patch }
}

function errorsOf(patch: Partial<MissionFormValues>) {
  const result = parseMissionForm(values(patch))
  return result.ok ? null : result.errors
}

describe('parseMissionForm', () => {
  it('turns the default form into exactly the contract example', () => {
    const result = parseMissionForm(DEFAULT_MISSION_VALUES)

    expect(result).toEqual({ ok: true, request: EXAMPLE })
  })

  it('sends null for a cleared limit (no condition) and never 0', () => {
    const result = parseMissionForm(
      values({ maxDarknessHours: '', maxBlackoutHours: '  ' }),
    )

    expect(result.ok && result.request.max_continuous_darkness_hours).toBeNull()
    expect(
      result.ok && result.request.max_communication_blackout_hours,
    ).toBeNull()
  })

  it('keeps a limit of exactly 0 (nothing may be dark) as 0', () => {
    const result = parseMissionForm(values({ maxDarknessHours: '0' }))

    expect(result.ok && result.request.max_continuous_darkness_hours).toBe(0)
  })

  it('sends null for unchecked slope and observer height, even with leftover text', () => {
    const result = parseMissionForm(
      values({
        slopeEnabled: false,
        slopeDegrees: 'garbage',
        observerEnabled: false,
        observerHeightM: '-5',
      }),
    )

    expect(result.ok && result.request.max_terrain_slope_degrees).toBeNull()
    expect(result.ok && result.request.observer_height_m).toBeNull()
  })

  it('sends the observer height and priority when chosen', () => {
    const result = parseMissionForm(
      values({
        observerEnabled: true,
        observerHeightM: '2.5',
        priority: 'earth',
      }),
    )

    expect(result.ok && result.request.observer_height_m).toBe(2.5)
    expect(result.ok && result.request.optimization_priority).toBe('earth')
  })

  it('always searches the south pole', () => {
    const result = parseMissionForm(DEFAULT_MISSION_VALUES)

    expect(result.ok && result.request.search_region).toBe('south')
  })

  describe('validation (messages are Korean, nothing is sent when invalid)', () => {
    it.each([
      ['', '착륙 날짜'],
      ['2027-02-30', '착륙 날짜'],
      ['27-01-01', '착륙 날짜'],
      ['not a date', '착륙 날짜'],
    ])('rejects landing date %j', (landingDate, field) => {
      expect(errorsOf({ landingDate })?.landingDate).toContain(field)
    })

    it.each(['0', '366', '1.5', 'abc', '', '-3', '1e2', '0x10'])(
      'rejects mission duration %j',
      (durationDays) => {
        expect(errorsOf({ durationDays })?.durationDays).toMatch(/1.*365/)
      },
    )

    it.each(['1', '14', '365'])(
      'accepts mission duration %j',
      (durationDays) => {
        expect(errorsOf({ durationDays })).toBeNull()
      },
    )

    it.each(['-1', 'x', '1,5', '1e2'])(
      'rejects darkness and blackout limit %j',
      (text) => {
        expect(
          errorsOf({ maxDarknessHours: text })?.maxDarknessHours,
        ).toContain('0 이상')
        expect(
          errorsOf({ maxBlackoutHours: text })?.maxBlackoutHours,
        ).toContain('0 이상')
      },
    )

    it.each(['0', '-1', '91', 'abc', ''])(
      'rejects slope %j when the slope box is checked',
      (slopeDegrees) => {
        expect(
          errorsOf({ slopeEnabled: true, slopeDegrees })?.slopeDegrees,
        ).toMatch(/0.*90/)
      },
    )

    it.each(['10', '90', '0.5'])('accepts slope %j', (slopeDegrees) => {
      expect(errorsOf({ slopeEnabled: true, slopeDegrees })).toBeNull()
    })

    it.each(['-1', '101', 'abc', ''])(
      'rejects observer height %j when the box is checked',
      (observerHeightM) => {
        expect(
          errorsOf({ observerEnabled: true, observerHeightM })?.observerHeightM,
        ).toMatch(/0.*100/)
      },
    )

    it.each(['0', '100', '1.8'])(
      'accepts observer height %j',
      (observerHeightM) => {
        expect(errorsOf({ observerEnabled: true, observerHeightM })).toBeNull()
      },
    )

    it('reports every invalid field at once', () => {
      const errors = errorsOf({
        landingDate: '',
        durationDays: '0',
        maxDarknessHours: '-1',
      })

      expect(Object.keys(errors ?? {}).toSorted()).toEqual([
        'durationDays',
        'landingDate',
        'maxDarknessHours',
      ])
    })
  })

  describe('ephemeris coverage 1850-2150 (the server rejects anything outside)', () => {
    it('rejects a landing date before 1850', () => {
      expect(errorsOf({ landingDate: '1849-12-31' })?.landingDate).toContain(
        '1850',
      )
    })

    it('allows the mission to end exactly at 2150-01-01 but not a day later', () => {
      expect(
        errorsOf({ landingDate: '2149-12-31', durationDays: '1' }),
      ).toBeNull()
      expect(
        errorsOf({ landingDate: '2150-01-01', durationDays: '1' })?.landingDate,
      ).toContain('2150')
      expect(
        errorsOf({ landingDate: '2149-12-31', durationDays: '2' })?.landingDate,
      ).toContain('2150')
    })
  })
})

describe('missionRequestJson', () => {
  it('prints the exact contract example (same keys, same order, null kept)', () => {
    expect(missionRequestJson(EXAMPLE)).toBe(JSON.stringify(EXAMPLE, null, 2))
    expect(Object.keys(JSON.parse(missionRequestJson(EXAMPLE)))).toEqual([
      'landing_date',
      'mission_duration_days',
      'max_continuous_darkness_hours',
      'max_communication_blackout_hours',
      'max_terrain_slope_degrees',
      'search_region',
      'optimization_priority',
      'observer_height_m',
    ])
  })

  it('round-trips through the parser', () => {
    const request: MissionRequest = {
      ...EXAMPLE,
      max_continuous_darkness_hours: null,
      observer_height_m: 3,
    }

    expect(JSON.parse(missionRequestJson(request))).toEqual(request)
  })
})

describe('windowPreview', () => {
  it('derives the analysis window from landing date and duration', () => {
    expect(windowPreview('2027-01-01', 14)).toEqual({
      startDate: '2027-01-01',
      endDate: '2027-01-15',
      days: 14,
    })
  })

  it('crosses month, year and leap-day boundaries correctly', () => {
    expect(windowPreview('2027-12-25', 14)?.endDate).toBe('2028-01-08')
    expect(windowPreview('2028-02-20', 10)?.endDate).toBe('2028-03-01')
    expect(windowPreview('2027-02-20', 10)?.endDate).toBe('2027-03-02')
  })

  it('is null when either input is unusable', () => {
    expect(windowPreview('', 14)).toBeNull()
    expect(windowPreview('2027-02-30', 14)).toBeNull()
    expect(windowPreview('2027-01-01', 0)).toBeNull()
    expect(windowPreview('2027-01-01', Number.NaN)).toBeNull()
  })

  it('has a one-line text saying the end date is not included', () => {
    expect(windowPreviewText('2027-01-01', 14)).toBe(
      '2027-01-01 ~ 2027-01-15 (14일, 끝 날짜는 포함하지 않음)',
    )
    expect(windowPreviewText('', 14)).toBeNull()
  })
})

describe('priorityLabel', () => {
  it('names the three priorities in Korean with their weights', () => {
    expect(priorityLabel('balanced')).toBe('균형 (일조 0.5 : 지구 0.5)')
    expect(priorityLabel('solar')).toBe('일조 우선 (일조 0.75 : 지구 0.25)')
    expect(priorityLabel('earth')).toBe(
      '지구 가시성 우선 (일조 0.25 : 지구 0.75)',
    )
  })
})

describe('missionSummaryItems', () => {
  function item(mission: MissionRequest, label: string): string | undefined {
    return missionSummaryItems(mission).find((i) => i.label === label)?.value
  }

  it('describes every input in plain Korean', () => {
    expect(item(EXAMPLE, '착륙 날짜')).toBe('2027-01-01')
    expect(item(EXAMPLE, '임무 기간')).toBe('14일 (2027-01-01 ~ 2027-01-15)')
    expect(item(EXAMPLE, '최대 연속 암흑')).toBe('24시간 이하')
    expect(item(EXAMPLE, '최대 통신 두절')).toBe('6시간 이하')
    expect(item(EXAMPLE, '최적화 우선순위')).toBe('균형 (일조 0.5 : 지구 0.5)')
    expect(item(EXAMPLE, '탐색 영역')).toBe('달 남극')
  })

  it('says "조건 없음" for unset limits and notes that slope is not applied', () => {
    const open: MissionRequest = {
      ...EXAMPLE,
      max_continuous_darkness_hours: null,
      max_communication_blackout_hours: null,
    }

    expect(item(open, '최대 연속 암흑')).toBe('조건 없음')
    expect(item(open, '최대 통신 두절')).toBe('조건 없음')
    expect(item(EXAMPLE, '최대 지형 경사')).toBe('10° (적용되지 않음)')
    expect(
      item({ ...EXAMPLE, max_terrain_slope_degrees: null }, '최대 지형 경사'),
    ).toBe('지정하지 않음')
  })

  it('shows ground level when the observer height is null', () => {
    expect(item(EXAMPLE, '관측·장비 높이')).toBe('지표면 (0 m)')
    expect(item({ ...EXAMPLE, observer_height_m: 2.5 }, '관측·장비 높이')).toBe(
      '2.5 m',
    )
  })
})

it('labels a slope limit as applied only when the saved run enforced it', () => {
  const items = missionSummaryItems(EXAMPLE, {
    min_sun_fraction: null,
    max_sun_dark_hours: 24,
    min_earth_fraction: null,
    max_earth_blackout_hours: 6,
    max_terrain_slope_degrees: 10,
  })
  expect(items.find((item) => item.label === '최대 지형 경사')?.value).toBe(
    '10° 이하 (250 m 지역 P95)',
  )
})
