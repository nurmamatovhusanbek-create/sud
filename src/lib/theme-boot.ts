/**
 * The inline script that puts the saved theme on <html data-theme> before the first paint (no flash of the other
 * theme). It lives in its own module, not in lib/theme.ts: that one is a client module, and a server component
 * (the root layout) importing a constant from a client module gets a client reference, not the string.
 */

export const THEME_KEY = 'theme'

export const THEME_BOOT_SCRIPT =
  "try{var d=document.documentElement,t=localStorage.getItem('" + THEME_KEY + "')==='dark'?'dark':'light';" +
  "d.setAttribute('data-theme',t);d.style.colorScheme=t}catch(e){}"
