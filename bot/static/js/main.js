// Bootstrap: theme, shell, routes, first route. Nothing else lives here.
import { launched, launchRoute, themeName } from './core/auth.js'
import { waitForBackup } from './core/api.js'
import { telegram } from './core/telegram.js'
import { splashDone, splashFail, splashText } from './core/boot.js'
import { mountDebug } from './core/debug.js'
import { register, start } from './core/router.js'
import { mountShell, syncSearchBox } from './shell.js'
import { h } from './ui/h.js'
import { Empty } from './ui/components.js'
import { home } from './screens/home.js'
import { search } from './screens/search.js'
import { caseScreen } from './screens/case.js'
import { bill } from './screens/bill.js'
import { company } from './screens/company.js'
import { orderScreen } from './screens/order.js'

document.documentElement.dataset.theme = themeName()
const head = document.getElementById('head')
const main = document.getElementById('main')

async function boot() {
  if (!launched) {
    main.replaceChildren(h('div', { class: 'screen' }, Empty('Bu sahifa Telegram ichida, botning «Qidiruv» tugmasi orqali ochilishi kerak.')))
    splashDone()
    return
  }
  // tell Telegram the page is up (its own placeholder goes), ask for fullscreen, follow the safe areas; our loading screen is what the person sees now
  telegram.start()
  mountDebug()
  // a bot that has just woken is still reading the backup: wait for it here, with a line that says so, instead of opening a screen that can only fail
  const backup = await waitForBackup({ onStatus: splashText })
  if (!backup.ready && backup.error) {
    splashFail(backup.error, () => location.reload())
    return
  }
  mountShell(head)
  register('home', home)
  register('search', search)
  register('case', caseScreen)
  register('bill', bill)
  register('company', company)
  register('order', orderScreen)
  window.addEventListener('popstate', syncSearchBox)
  await start(main, launchRoute())
  splashDone()
}

boot()
