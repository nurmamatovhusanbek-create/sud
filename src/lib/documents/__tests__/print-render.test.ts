import { describe, expect, test } from 'bun:test'
import { printSheet } from '../print-render'

describe('printSheet', () => {
  test('A4, no own margins, one rendered page per printed page, no screen chrome', () => {
    const html = printSheet('Sud majlisini qoldirish', '<div class="docx-wrapper"><section class="docx">x</section></div>')
    expect(html).toContain('@page { size: A4; margin: 0; }')
    expect(html).toContain('break-after: page')
    expect(html).toContain('box-shadow: none')
    expect(html).toContain('<section class="docx">x</section>')
  })
  test('the title is escaped', () => {
    expect(printSheet('<b>"x"&', '')).toContain('<title>&lt;b&gt;&quot;x&quot;&amp;</title>')
  })
})
