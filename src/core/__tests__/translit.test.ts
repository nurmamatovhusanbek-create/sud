import { describe, expect, test } from 'bun:test'
import { uzCyrToLat, uzLatToRu } from '../translit'
import { toNewLatin, toOldLatin } from '../uz-alphabet'

describe('uzCyrToLat', () => {
  test('the Uzbek letters the old alphabet writes with two characters', () => {
    expect(uzCyrToLat('Ўзбекистон')).toBe('Oʻzbekiston')
    expect(uzCyrToLat('Ғалаба')).toBe('Gʻalaba')
    expect(uzCyrToLat('Шаҳар')).toBe('Shahar')
    expect(uzCyrToLat('Чой')).toBe('Choy')
  })
  test('«с»+«ҳ» are two letters: they keep the tutuq, so they are NOT read as «ш» later', () => {
    expect(uzCyrToLat('Исҳоқ')).toBe('Isʼhoq')
    expect(uzCyrToLat('ИСҲОҚ')).toBe('ISʼHOQ')
    expect(uzCyrToLat('исҳоқ')).toBe('isʼhoq')
  })
  test('…and survive the new alphabet as two letters; the real ш/ч become ş/ç', () => {
    expect(toNewLatin(uzCyrToLat('Исҳоқ'))).toBe('Isʼhoq')
    expect(toNewLatin(uzCyrToLat('Шаҳар Чой Ўзбек Ғалаба'))).toBe('Şahar Çoy Özbek Ğalaba')
    expect(toOldLatin(toNewLatin(uzCyrToLat('Исҳоқ Шаҳар')))).toBe('Isʼhoq Shahar')
  })
  test('text with no Cyrillic is returned untouched, and the legal form keeps its spelling', () => {
    expect(uzCyrToLat('Shahar choy')).toBe('Shahar choy')
    expect(uzCyrToLat('«Шаҳар» MCHJ')).toBe('«Shahar» MChJ')
  })
})

describe('uzLatToRu understands both alphabets', () => {
  test('the same name gives the same Russian whichever way it was typed', () => {
    for (const [oldName, neuName] of [
      ['Oʻktamov Shuhrat Gʻulomovich', 'Öktamov Şuhrat Ğulomoviç'],
      ['Choriyev Sherzod', 'Çoriyev Şerzod'],
      ['Toshpoʻlatov Gʻayrat', 'Toşpölatov Ğayrat'],
    ]) expect(uzLatToRu(neuName)).toBe(uzLatToRu(oldName))
  })
  test('the Russian is right', () => {
    expect(uzLatToRu('Öktamov Şuhrat Ğulomoviç')).toBe('Уктамов Шухрат Гуломович')
    expect(uzLatToRu('Çoriyev')).toBe('Чориев')
  })
  test('a name with nothing special is unchanged in behaviour', () => {
    expect(uzLatToRu('Turgunov Sherzod Azimjanovich')).toBe('Тургунов Шерзод Азимжанович')
  })
})
