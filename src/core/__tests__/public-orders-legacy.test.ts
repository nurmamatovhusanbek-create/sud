import { describe, expect, test } from 'bun:test'
import { compactLegacy, courtTypeOfCase, isOrderFileId, legacyRows, legacySearchPath, orderFilePath } from '../public-orders'

// rows copied (shortened) from the live pre-2024 lists, Nov 2026
const CIVIL = { id: '67bd4a45ee3ec578cdc680f0', claimId: 4563365, dbName: 'Чирчиқ туманлараро суди', category: 'Низолар', judge: 'Каюмов Х.', caseNumber: '2-1102-2318/6433', instance: 1, result: 'PARTIALLY_FULFILLED', fileData: { id: 113352548, name: 'мерос.pdf', size: 246404, contentType: 'application/pdf' }, hasFile: false }
const ADMIN = { id: 4730187, claimId: 3153177, instance: 3, dbName: 'Навоий суди', caseNumber: '3-2110-1901/3277', claimCategory: 'Маъмурий', judge: 'Rahimov A.', result: 'CASSATION_REJECTED', fileId: null }
const ECON = { id: 1221154, claimId: 3651441, publicationType: { id: 4, name: 'Ҳал қилув қарори' }, attachmentsList: [{ id: 1243043, fileData: { id: 90852676, name: '53831.pdf', size: 129942 } }], dbName: 'Тошкент иқтисодий суди', category: 'Ижара', judge: 'Байзақова', caseNumber: '4-1001-2320/53831', instance: 1, result: 'PARTIALLY_FULFILLED' }
const CRIM = { id: 515590, alteredId: 519323, claimId: 3309164, instance: 1, dbName: 'Чортоқ туман суди', caseNumber: '1-1610-2601/382', claimArticles: ['Ўғрилик'], judge: 'Sadirov', claimDocumentType: ['Айблов ҳукми'] }

describe('pre-2024 ids and file paths', () => {
  test('the file path is a pure function of the id; the paths are the ones the browser calls', () => {
    expect(orderFilePath('86db779e-9ba9-41c3-8d1a-15e9ef0a5dfb')).toBe('/public/onStream/86db779e-9ba9-41c3-8d1a-15e9ef0a5dfb')
    expect(orderFilePath('old-economic-90852676')).toBe('/publication-proxy/api/file/download/90852676/')
    expect(orderFilePath('old-civil-4563365')).toBe('/publication-proxy/api/file/civil/4563365/')
    expect(orderFilePath('old-administrative-3152957-17')).toBe('/publication-proxy/api/file/administrative/3152957/17')
    expect(orderFilePath('old-criminal-3309164')).toBe('/publication-proxy/api/file/criminal/3309164/')
  })
  test('nothing else is accepted (no path tricks, no other kinds, no huge numbers)', () => {
    for (const bad of ['', '../etc/passwd', 'old-civil-', 'old-civil-1/../2', 'old-other-1', 'old-civil-1234567890123', 'old-civil-5-12345', 'OLD-civil-1 ', 'old-civil-1?x=1']) {
      expect(isOrderFileId(bad)).toBe(false)
      expect(orderFilePath(bad)).toBeNull()
    }
    expect(isOrderFileId('old-civil-4563365')).toBe(true)
  })
})

describe('compactLegacy (real shapes)', () => {
  test('civil: the file key is the claimId (that is what the site downloads), name and size come from fileData', () => {
    expect(compactLegacy(CIVIL, 'CIVIL')).toEqual({ id: 'old-civil-67bd4a45ee3ec578cdc680f0', caseNumber: '2-1102-2318/6433', instance: 'FIRST', result: 'PARTIALLY_FULFILLED', court: 'Чирчиқ туманлараро суди', judge: 'Каюмов Х.', category: 'Низолар', pdfId: 'old-civil-4563365', pdfName: 'мерос.pdf', pdfSize: 246404, courtType: 'CIVIL' })
  })
  test('administrative: claimId + document type 17; instance 3 = cassation', () => {
    const o = compactLegacy(ADMIN, 'ADMINISTRATIVE')!
    expect(o.pdfId).toBe('old-administrative-3153177-17')
    expect(o.instance).toBe('CASSATION')
    expect(o.category).toBe('Маъмурий')
    expect(orderFilePath(o.pdfId)).toBe('/publication-proxy/api/file/administrative/3153177/17')
  })
  test('economic: the file id is inside the attachment (not the claimId); the publication type names the document', () => {
    const o = compactLegacy(ECON, 'ECONOMIC')!
    expect(o.pdfId).toBe('old-economic-90852676')
    expect(o.pdfName).toBe('53831.pdf')
    expect(o.category).toBe('Ҳал қилув қарори')
    expect(o.id).toBe('old-economic-1221154')
  })
  test('criminal: claimId, and the document kind (not the articles or anyone) is the category', () => {
    const o = compactLegacy(CRIM, 'CRIMINAL')!
    expect(o.pdfId).toBe('old-criminal-3309164')
    expect(o.category).toBe('Айблов ҳукми')
    expect(JSON.stringify(o)).not.toContain('Ўғрилик')
  })
  test('unusable rows: no case number, no id, or no way to a file (kept without a PDF)', () => {
    expect(compactLegacy({ ...CIVIL, caseNumber: '' }, 'CIVIL')).toBeNull()
    expect(compactLegacy({ ...CIVIL, id: undefined }, 'CIVIL')).toBeNull()
    expect(compactLegacy({ ...ECON, attachmentsList: [] }, 'ECONOMIC')!.pdfId).toBe('')
    expect(compactLegacy({ ...CIVIL, instance: 9 }, 'CIVIL')!.instance).toBe('')
  })
})

describe('legacy search plumbing', () => {
  test('search paths carry the caseNumber filter and the type each list needs', () => {
    expect(legacySearchPath('ECONOMIC', '4-1001-2320/53831')).toBe('/publication-proxy/unauthorized/publications?caseNumber=4-1001-2320%2F53831&size=30&page=0&court_type=ECONOMIC')
    expect(legacySearchPath('ADMINISTRATIVE', ' 3-2110-1901/3277 ')).toContain('conflict?type=17&caseNumber=3-2110-1901%2F3277')
    expect(legacySearchPath('CRIMINAL', '1-1610-2601/382')).toContain('/criminal/findAll?caseNumber=')
    expect(legacySearchPath('CIVIL', '2-1/1')).toContain('/api/civil/publication/page?')
  })
  test('rows come out of {data: [...]}, a JSON-string data (criminal) and {data: {content}}; garbage gives none', () => {
    expect(legacyRows({ data: [CIVIL] })).toHaveLength(1)
    expect(legacyRows({ data: JSON.stringify({ content: [CRIM, CRIM] }) })).toHaveLength(2)
    expect(legacyRows({ data: { content: [ECON] } })).toHaveLength(1)
    expect(legacyRows({ data: 'not json' })).toEqual([])
    expect(legacyRows(null)).toEqual([])
    expect(legacyRows({ data: [1, 'x', null, CIVIL] })).toHaveLength(1)
  })
  test('the court of a case number, from its first digit', () => {
    expect(courtTypeOfCase('1-1610-2601/382')).toBe('CRIMINAL')
    expect(courtTypeOfCase('2-1003-2113/20027')).toBe('CIVIL')
    expect(courtTypeOfCase('5-2001-2102/901')).toBe('ADMINISTRATIVE')
    expect(courtTypeOfCase('3-2110-1901/3277')).toBe('ADMINISTRATIVE')
    expect(courtTypeOfCase('4-1001-2218/44965')).toBe('ECONOMIC')
    expect(courtTypeOfCase('9-1/1')).toBeNull()
  })
})
