import type { ReportInput } from '../model'

export const NOW = new Date(2026, 8, 29, 12, 0)

export const mkCase = (n: number, cls: 'win' | 'lose' | 'pending' | 'neutral', result: string, regDate: string, role: 'plaintiff' | 'defendant' = 'plaintiff', courtType: 'economic' | 'civil' | 'administrative' = 'economic') => ({
  caseNumber: `4-1001-2609/0${n}`, courtType, regDate, result, classification: cls, role, court: 'Toshkent tumanlararo iqtisodiy sud', category: ['Shartnoma', 'Undiruv', 'Soliq'][n % 3], counterparty: `"KONTRAGENT ${n}" MCHJ`,
})

export const CASES = [
  mkCase(1, 'win', 'Daʼvo toʻliq qanoatlantirilsin', '02.09.2026'),
  mkCase(2, 'win', 'Daʼvo toʻliq qanoatlantirilsin', '15.06.2026'),
  mkCase(3, 'lose', 'Daʼvo rad etilsin', '10.01.2026', 'defendant'),
  mkCase(4, 'pending', '', '28.09.2026', 'plaintiff', 'civil'),
  mkCase(5, 'neutral', 'Qaytarilsin', '12.12.2025', 'defendant', 'administrative'),
  mkCase(6, 'lose', 'Daʼvo rad etilsin', '05.03.2026'),
]

export const FULL: ReportInput = {
  stir: '302121267',
  generatedAt: NOW,
  info: {
    company: {
      tin: '302121267', officialName: '"PROCAB" MAS\'ULIYATI CHEKLANGAN JAMIYAT', shortName: 'PROCAB', registeredDate: '18.10.2011', status: 'Faoliyat yuritmoqda',
      address: 'Toshkent sh., Sergeli t.', director: 'Kamildjanov A.A.', phone: '+998933577755', email: 'note@mail.ru', charterCapital: '428 914 468 778,14',
      registeringAuthority: 'Hokimlik', thsht: 'MChJ', dbibt: '08374', ifut: '24440', sustainabilityRating: 'Yuqori', largeTaxpayer: 'Ha', orgInfoUrl: 'https://orginfo.uz/x',
      founders: [{ name: 'B', share: '10,2%' }, { name: 'A', share: '44.9%' }, { name: 'C', share: '44.9 %' }],
    },
    rating: { score: 94, category: 'AA', taxpayerType: 'SDT', region: 'Toshkent sh.', district: 'Sergeli', okedCode: '24440', okedName: 'Misni ishlab chiqarish', okedNameRu: null, okedSection: null, okedShortName: null, employeeLimitMf: null, employeeLimitLf: null },
  },
  stats: {
    company: { name: 'PROCAB', tin: '302121267' },
    cases: CASES,
    summary: { total: 6, win: 2, lose: 2, neutral: 1, pending: 1, asPlaintiff: 4, asDefendant: 2 },
    errors: [], rating: { score: 94, category: 'AA' },
  } as never,
  cases: [
    { caseNumber: '4-1001-2609/01', claimAmount: '272 628 881,58' }, { caseNumber: '4-1001-2609/02', claimAmount: '1000000' },
    { caseNumber: '4-1001-2609/02', claimAmount: '9999999' }, // duplicate case number: counted once
    { caseNumber: '4-1001-2609/03', claimAmount: '-' },
  ] as never,
  hearings: [{ isoDate: '2026-10-02', hearingTime: '10:30', courtName: 'Iqtisodiy sud', caseNumber: '4-1001-2609/04', judge: 'Karimov B.', courtType: 'civil', courtTypeLabel: 'Civil' }] as never,
  bills: { billCount: 12, paidCount: 9, paidTotal: 150000000, overdueTotal: 20000000, billsLoadedAt: NOW.getTime() },
}

