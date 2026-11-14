import { describe, expect, it } from 'vitest'
import { KIND_COPY, subject } from './kinds'

describe('subject', () => {
  it('attaches 이 after a final consonant and 가 after a vowel', () => {
    expect(subject('태양')).toBe('태양이')
    expect(subject('지구')).toBe('지구가')
  })

  it('works for every label the UI puts in a sentence', () => {
    for (const copy of Object.values(KIND_COPY)) {
      for (const word of [copy.body, copy.windowLabel, copy.darkPeriodLabel]) {
        expect(subject(word)).toMatch(/[이가]$/)
      }
    }
    expect(subject('통신 가능 구간')).toBe('통신 가능 구간이')
    expect(subject('암흑 구간')).toBe('암흑 구간이')
  })

  it('falls back to 이 for non-Hangul endings', () => {
    expect(subject('DTE')).toBe('DTE이')
  })
})
