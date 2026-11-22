// Bootstrap: theme, shell, routes, first route. Nothing else lives here.
import { launched, launchRoute, themeName } from './core/auth.js'
import { register, start } from './core/router.js'
import { mountShell, syncSearchBox } from './shell.js'
import { h } from './ui/h.js'
import { Empty } from './ui/components.js'
import { home } from './screens/home.js'
import { search } from './screens/search.js'
import { caseScreen } from './screens/case.js'
import { bill } from './screens/bill.js'
import { company } from './screens/company.js'

document.documentElement.dataset.theme = themeName()
const head = document.getElementById('head')
const main = document.getElementById('main')

if (!launched) {
  main.replaceChildren(h('div', { class: 'screen' }, Empty('Bu sahifa Telegram ichida, botning «Qidiruv» tugmasi orqali ochilishi kerak.')))
} else {
  mountShell(head)
  register('home', home)
  register('search', search)
  register('case', caseScreen)
  register('bill', bill)
  register('company', company)
  window.addEventListener('popstate', syncSearchBox)
  start(main, launchRoute())
}
