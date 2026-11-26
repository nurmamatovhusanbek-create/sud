// The page's one bridge to the Telegram client (see telegram-core.js for what it does and why there is no external script).
import { createTelegram } from './telegram-core.js'

let storage = null
try { storage = window.localStorage } catch { /* blocked: the choice is not remembered */ }

export const telegram = createTelegram({ win: window, hash: location.hash, storage: storage || { getItem: () => null, setItem: () => {} }, doc: document })
