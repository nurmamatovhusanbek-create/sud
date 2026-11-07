import zlib from 'node:zlib'

/**
 * A small arithmetic picture («12 + 7 =») drawn from a built-in 5×7 font and encoded as a PNG with nothing but zlib:
 * the Settings test needs an image whose right answer WE know, to prove that a key and a model can read images.
 * A few faint lines cross it like a real captcha's noise.
 */

const GLYPHS: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '*': ['00000', '10001', '01010', '00100', '01010', '10001', '00000'],
  '=': ['00000', '00000', '11111', '00000', '11111', '00000', '00000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
}

const SCALE = 9
const GAP = 1 // columns between glyphs (before scaling)
const PAD = 5 // padding (in glyph pixels)

/** Render `text` (digits, + - * = and spaces) to a grayscale bitmap; 0 = black, 255 = white. */
export function renderText(text: string): { width: number; height: number; pixels: Uint8Array } {
  const cols = text.length * (5 + GAP) - GAP
  const width = (cols + PAD * 2) * SCALE
  const height = (7 + PAD * 2) * SCALE
  const pixels = new Uint8Array(width * height).fill(255)
  const put = (x: number, y: number, v: number) => {
    if (x >= 0 && y >= 0 && x < width && y < height) pixels[y * width + x] = v
  }
  ;[...text].forEach((ch, gi) => {
    const g = GLYPHS[ch] ?? GLYPHS[' ']
    for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) {
      if (g[r][c] !== '1') continue
      for (let dy = 0; dy < SCALE; dy++) for (let dx = 0; dx < SCALE; dx++) put((PAD + gi * (5 + GAP) + c) * SCALE + dx, (PAD + r) * SCALE + dy, 20)
    }
  })
  // two faint diagonal lines of noise (light enough to read through)
  for (let i = 0; i < width; i++) {
    put(i, Math.floor((i * height) / width / 1.3) + 6, 200)
    put(i, height - 8 - Math.floor((i * height) / width / 1.6), 215)
  }
  return { width, height, pixels }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

export function encodePng(width: number, height: number, gray: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 0 // grayscale
  const raw = Buffer.alloc((width + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0 // filter: none
    raw.set(gray.subarray(y * width, (y + 1) * width), y * (width + 1) + 1)
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', new Uint8Array(0))])
}

export interface MathImage {
  pngBase64: string
  /** what the picture says, e.g. «12 + 7 =» */
  expression: string
  answer: number
}

export function mathImage(a: number, op: '+' | '-' | '*', b: number): MathImage {
  const expression = `${a} ${op} ${b} =`
  const { width, height, pixels } = renderText(expression)
  return { pngBase64: encodePng(width, height, pixels).toString('base64'), expression, answer: op === '+' ? a + b : op === '-' ? a - b : a * b }
}
