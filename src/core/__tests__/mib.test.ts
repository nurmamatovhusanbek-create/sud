import { describe, it, expect } from 'bun:test'
import { parseMibHtml } from '../../lib/mib'

// Fixtures mirror the documented mib.uz field layout (MIB-FULL-REVERSE-ENGINEERING.md).
const NO_DEBT = `<ul class="feedbackPanel"><li class="feedbackPanelWARNING"><span>302678824 СТИР рақамли юридик шахсда қарздорлик аниқланмади</span></li></ul>`

const DEBT_LIST = `
<li class="feedbackPanelINFO"><span>302678824 СТИР рақамли юридик шахсда қарздорлик мавжуд!</span></li>
<div>Умумий қарздорлик: <b>10 230 000.00</b></div>
<div>Жорий қарздорлик: <b>10 210 467,75</b></div>
<div class="row">
  <p>Ижро иши рақами</p><p>10072617684501</p>
  <p>Ҳужжат ҳолати</p><p>Жараёнда</p>
  <p>И/Ҳ мазмуни</p><p>Карз ундириш</p>
  <p>Ҳужжат иш юритувида</p><p>Чилонзор тумани</p>
  <p>Ундирувчи</p><p>"**R B**" AK***IK JA***TI</p>
  <p>Қарздорлик миқдори</p><p>10 210 467,75</p>
</div>
<div class="row">
  <p>Ижро иши рақами</p><p>10072617684502</p>
  <p>Ҳужжат ҳолати</p><p>Жараёнда</p>
  <p>И/Ҳ мазмуни</p><p>Карз ундириш</p>
  <p>Ҳужжат иш юритувида</p><p>Яшнобод тумани</p>
  <p>Ундирувчи</p><p>"**X Y**" BB***II</p>
  <p>Қарздорлик миқдори</p><p>19 532.25</p>
</div>`

describe('parseMibHtml', () => {
  it('reports a clean result', () => {
    const r = parseMibHtml(NO_DEBT, '302678824')
    expect(r.hasDebt).toBe(false)
    expect(r.status).toBe('clean')
  })

  it('parses a debt-check list (Service 1)', () => {
    const r = parseMibHtml(DEBT_LIST, '302678824')
    expect(r.status).toBe('debt')
    expect(r.hasDebt).toBe(true)
    expect(r.totalDebt).toBeCloseTo(10230000, 2)
    expect(r.currentDebt).toBeCloseTo(10210467.75, 2)
    expect(r.debts?.length).toBe(2)
    const d = r.debts![0]
    expect(d.enforcementCaseNumber).toBe('10072617684501')
    expect(d.status).toBe('Жараёнда')
    expect(d.subject).toBe('Карз ундириш')
    expect(d.department).toBe('Чилонзор тумани')
    expect(d.collector).toContain('AK***IK')
    expect(d.amount).toBeCloseTo(10210467.75, 2)
  })

  it('rejects unrelated HTML', () => {
    const r = parseMibHtml('<html><body>Salom dunyo</body></html>', '302678824')
    expect(r.status).toBe('error')
    expect(r.hasDebt).toBe(false)
  })
})
