import { describe, expect, it } from 'vitest'
import {
  MAX_POLL_FAILURES,
  PROGRESS_STAGES,
  elapsedSeconds,
  formatElapsed,
  isTerminal,
  pollFailureCount,
  shouldGiveUp,
  stageIndex,
  stagePercent,
} from './progress'

describe('PROGRESS_STAGES', () => {
  it('lists the five stages in the order users see them', () => {
    expect(PROGRESS_STAGES.map((stage) => stage.label)).toEqual([
      '대기',
      '거친 격자 계산',
      '세밀 격자 계산',
      '결과 저장',
      '완료',
    ])
  })

  it('explains every stage in a sentence', () => {
    for (const stage of PROGRESS_STAGES)
      expect(stage.text.length).toBeGreaterThan(10)
  })
})

describe('stageIndex', () => {
  it.each([
    ['queued', 0],
    ['starting', 0],
    ['coarse', 1],
    ['fine', 2],
    ['writing', 3],
    ['done', 4],
  ])('maps stage %s to step %i', (stage, index) => {
    expect(stageIndex(stage, 'running')).toBe(index)
  })

  it('a finished run is always at the last step, whatever the stage text says', () => {
    expect(stageIndex('writing', 'done')).toBe(4)
  })

  it('a failed run stays at the step where it stopped', () => {
    expect(stageIndex('fine', 'failed')).toBe(2)
  })

  it('an unknown stage falls back to the first step instead of crashing', () => {
    expect(stageIndex('something-new', 'running')).toBe(0)
  })
})

describe('stagePercent', () => {
  it('is the share done within the current stage', () => {
    expect(stagePercent(41_200, 119_037)).toBe(35)
    expect(stagePercent(0, 100)).toBe(0)
    expect(stagePercent(100, 100)).toBe(100)
  })

  it('is null when the stage has no total yet (do not invent a percentage)', () => {
    expect(stagePercent(0, 0)).toBeNull()
    expect(stagePercent(5, -1)).toBeNull()
  })

  it('never goes outside 0..100', () => {
    expect(stagePercent(150, 100)).toBe(100)
    expect(stagePercent(-5, 100)).toBe(0)
  })
})

describe('formatElapsed', () => {
  it.each([
    [0, '0초'],
    [7, '7초'],
    [65, '1분 05초'],
    [600, '10분 00초'],
    [3725, '1시간 02분'],
  ])('%i seconds -> %s', (seconds, text) => {
    expect(formatElapsed(seconds)).toBe(text)
  })

  it('treats negative or fractional input sanely', () => {
    expect(formatElapsed(-4)).toBe('0초')
    expect(formatElapsed(7.9)).toBe('7초')
  })
})

describe('elapsedSeconds', () => {
  it('uses the server start time when there is one', () => {
    const now = Date.parse('2026-11-14T21:05:12+00:00')

    expect(elapsedSeconds('2026-11-14T21:03:10+00:00', 0, now)).toBe(122)
  })

  it('falls back to when the screen started following the run', () => {
    expect(elapsedSeconds(null, 1_000, 6_500)).toBe(5)
  })

  it('never goes negative (clock skew)', () => {
    const now = Date.parse('2026-11-14T21:00:00+00:00')

    expect(elapsedSeconds('2026-11-14T21:03:10+00:00', 0, now)).toBe(0)
  })
})

describe('polling failures', () => {
  it('counts consecutive failures and resets on success', () => {
    let count = 0
    count = pollFailureCount(count, false)
    count = pollFailureCount(count, false)
    expect(count).toBe(2)
    expect(shouldGiveUp(count)).toBe(false)

    expect(pollFailureCount(count, true)).toBe(0)
  })

  it('gives up after a few failures in a row, not on the first blip', () => {
    expect(MAX_POLL_FAILURES).toBeGreaterThanOrEqual(3)
    expect(shouldGiveUp(MAX_POLL_FAILURES - 1)).toBe(false)
    expect(shouldGiveUp(MAX_POLL_FAILURES)).toBe(true)
  })
})

describe('isTerminal', () => {
  it('done and failed stop the polling; queued and running keep it going', () => {
    expect(isTerminal('done')).toBe(true)
    expect(isTerminal('failed')).toBe(true)
    expect(isTerminal('queued')).toBe(false)
    expect(isTerminal('running')).toBe(false)
  })
})
