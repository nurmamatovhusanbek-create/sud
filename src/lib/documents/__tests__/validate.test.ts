import { describe, expect, test } from 'bun:test'
import { FIELDS } from '../registry'
import { checkDoc, validateField, VALIDATED_KEYS } from '../validate'

const lvl = (k: string, v: string) => validateField(k, v)?.level ?? null

describe('field checks', () => {
  test('empty is never «invalid» (it is reported separately)', () => {
    expect(validateField('dob', '  ')).toBeNull()
  })
  test('dates: real calendar dates only, in the app\'s formats', () => {
    expect(lvl('dob', '09.10.1990')).toBeNull()
    expect(lvl('dob', '1990-10-09')).toBeNull()
    expect(lvl('dob', '31.02.2026')).toBe('error')
    expect(lvl('dob', 'ertaga')).toBe('error')
    expect(lvl('dob', '09.10.1790')).toBe('warn') // a real date, an implausible year
  })
  test('time', () => {
    expect(lvl('hearing_time', '10:30')).toBeNull()
    expect(lvl('hearing_time', '9:05')).toBeNull()
    expect(lvl('hearing_time', '25:00')).toBe('error')
    expect(lvl('hearing_time', '10.30')).toBe('error')
  })
  test('e-mail', () => {
    expect(lvl('sc_email', 'info@artikul.uz')).toBeNull()
    expect(lvl('sc_email', 'info@artikul')).toBe('error')
  })
  test('STIR and PINFL count digits, ignoring spaces', () => {
    expect(lvl('sc_tin', '302 678 824')).toBeNull()
    expect(lvl('sc_tin', '30267882')).toBe('warn')
    expect(lvl('emp_pinfl', '12345678901234')).toBeNull()
    expect(lvl('emp_pinfl', '1234')).toBe('warn')
  })
  test('uzbek passport shape; a visa applicant\'s foreign passport is only checked loosely', () => {
    expect(lvl('emp_passport', 'AD 1234567')).toBeNull()
    expect(lvl('emp_passport', 'AD1234567')).toBeNull()
    expect(lvl('emp_passport', 'A1234')).toBe('warn')
    expect(lvl('passport', 'E12345678')).toBeNull()
    expect(lvl('passport', '12')).toBe('warn')
  })
  test('phones: 9 digits or 998 + 9', () => {
    expect(lvl('phone', '+998 90 123 45 67')).toBeNull()
    expect(lvl('phone', '90 123 45 67')).toBeNull()
    expect(lvl('phone', '123')).toBe('warn')
  })
  test('case and order numbers', () => {
    expect(lvl('case_number', '4-1001-2609/42935')).toBeNull()
    expect(lvl('order_number', '2-0301-2610/00123')).toBeNull()
    expect(lvl('case_number', '42935')).toBe('warn')
  })
  test('amounts and counts', () => {
    expect(lvl('amount', '12 500 000')).toBeNull()
    expect(lvl('amount', '12 mln')).toBe('warn')
    expect(lvl('conf_years', '3')).toBeNull()
    expect(lvl('conf_years', 'uch')).toBe('warn')
  })
  test('script: Latin field vs Cyrillic field', () => {
    expect(lvl('emp_name', 'Aliyev Ali')).toBeNull()
    expect(lvl('emp_name', 'Алиев Али')).toBe('warn')
    expect(lvl('emp_name_ru', 'Алиев Али')).toBeNull()
    expect(lvl('emp_name_ru', 'Aliyev Ali')).toBe('warn')
  })
  test('a field without rules is never flagged', () => {
    expect(validateField('court', '???')).toBeNull()
  })
})

test('every checked key is a real form field (no typo silently disables a check)', () => {
  for (const k of VALIDATED_KEYS) expect(Object.keys(FIELDS)).toContain(k)
})

describe('checkDoc', () => {
  test('periods: the end before the start is an error on the end', () => {
    const c = checkDoc(['stay_from', 'stay_to'], { stay_from: '10.10.2026', stay_to: '01.10.2026' })
    expect(c.issues).toEqual([{ key: 'stay_to', level: 'error', msg: 'Tugash sanasi boshlanish sanasidan oldin' }])
  })
  test('a period in order, or with one end missing, is fine', () => {
    expect(checkDoc(['stay_from', 'stay_to'], { stay_from: '01.10.2026', stay_to: '10.10.2026' }).issues).toEqual([])
    expect(checkDoc(['stay_from', 'stay_to'], { stay_from: '01.10.2026', stay_to: '' }).issues).toEqual([])
  })
  test('an invalid end date is reported once (not again as a period problem)', () => {
    const c = checkDoc(['stay_from', 'stay_to'], { stay_from: '01.10.2026', stay_to: '31.02.2026' })
    expect(c.issues.length).toBe(1)
  })
  test('errors come before warnings; empty fields are listed apart', () => {
    const c = checkDoc(['phone', 'dob', 'court'], { phone: '1', dob: '31.02.2026', court: '' })
    expect(c.issues.map((i) => [i.key, i.level])).toEqual([['dob', 'error'], ['phone', 'warn']])
    expect(c.empty).toEqual(['court'])
  })
  test('only the document\'s own fields are checked', () => {
    expect(checkDoc(['court'], { phone: '1' }).issues).toEqual([])
  })
})
