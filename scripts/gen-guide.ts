// Writes docs/QOLLANMA.md from src/core/setup-guide.ts (the same text the app shows in Settings › Telegram).  bun run guide
import fs from 'node:fs'
import { guideMarkdown } from '../src/core/setup-guide'

fs.writeFileSync(new URL('../docs/QOLLANMA.md', import.meta.url), guideMarkdown())
console.log('docs/QOLLANMA.md yozildi')
