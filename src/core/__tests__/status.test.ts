import { describe, expect, test } from 'bun:test'
import { detectSearchMode } from '../search-mode'
import {
  billStatusFamily,
  caseClassificationFamily,
  companyStatusFamily,
  hearingStatusFamily,
  ratingBandFamily,
  healthFamily,
} from '../status'

describe('detectSearchMode', () => {
  test('9 digits → STIR', () => {
    expect(detectSearchMode('302678824').mode).toBe('stir')
  })
  test('12 digits → invoice', () => {
    expect(detectSearchMode('123456789012').mode).toBe('invoice')
  })
  test('14 digits → PINFL', () => {
    expect(detectSearchMode('12345678901234').mode).toBe('pinfl')
  })
  test('4-… → case number', () => {
    expect(detectSearchMode('4-2401/2026').mode).toBe('caseNumber')
    expect(detectSearchMode('4-10-2514/671').mode).toBe('caseNumber')
  })
  test('fallback → name', () => {
    expect(detectSearchMode('Artikul Aziya').mode).toBe('unknown')
  })
})

describe('status families (redesign §4.3)', () => {
  test('bills', () => {
    expect(billStatusFamily('PAID')).toBe('positive')
    expect(billStatusFamily('USED')).toBe('positive')
    expect(billStatusFamily('CREATED')).toBe('neutral')
    expect(billStatusFamily('CREATED', 500_000_00)).toBe('negative')
    expect(billStatusFamily('PARTIALLY_PAID')).toBe('warning')
    expect(billStatusFamily('CHECKING')).toBe('warning')
    expect(billStatusFamily('SENT_TO_MIB')).toBe('warning')
    expect(billStatusFamily('CANCELLED')).toBe('negative')
    expect(billStatusFamily('SOMETHING_ELSE')).toBe('neutral')
  })
  test('case classification', () => {
    expect(caseClassificationFamily('win')).toBe('positive')
    expect(caseClassificationFamily('lose')).toBe('negative')
    expect(caseClassificationFamily('pending')).toBe('warning')
    expect(caseClassificationFamily('neutral')).toBe('neutral')
  })
  test('hearings — due ≤7 days is warning', () => {
    expect(hearingStatusFamily('Тайинланган', 3)).toBe('warning')
    expect(hearingStatusFamily('Тайинланган', 30)).toBe('info')
    expect(hearingStatusFamily('Кечиктирилган')).toBe('negative')
    expect(hearingStatusFamily('Ўтказилган')).toBe('neutral')
  })
  test('company status', () => {
    expect(companyStatusFamily('Фаолиятни давом эттирмоқда')).toBe('positive')
    expect(companyStatusFamily('Тугатилган')).toBe('negative')
    expect(companyStatusFamily('Мулақа')).toBe('warning')
    expect(companyStatusFamily('')).toBe('neutral')
  })
  test('rating bands', () => {
    expect(ratingBandFamily('AAA')).toBe('positive')
    expect(ratingBandFamily('A')).toBe('positive')
    expect(ratingBandFamily('BB')).toBe('warning')
    expect(ratingBandFamily('D')).toBe('negative')
    expect(ratingBandFamily(null)).toBe(null)
  })
  test('health', () => {
    expect(healthFamily('healthy')).toBe('positive')
    expect(healthFamily('degraded')).toBe('warning')
    expect(healthFamily('dead')).toBe('negative')
    expect(healthFamily('unknown')).toBe('neutral')
  })
})
