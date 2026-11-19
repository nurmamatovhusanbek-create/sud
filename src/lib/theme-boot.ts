/**
 * The inline script that puts the saved theme on <html data-theme> before the first paint (no flash of the other
 * theme). It lives in its own module, not in lib/theme.ts: that one is a client module, and a server component
 * (the root layout) importing a constant from a client module gets a client reference, not the string.
 */

export const THEME_KEY = 'theme'

export const THEME_BOOT_SCRIPT =
  "try{var d=document.documentElement,t=localStorage.getItem('" + THEME_KEY + "')==='dark'?'dark':'light';" +
  "d.setAttribute('data-theme',t);d.style.colorScheme=t}catch(e){}"

/**
 * Motion: «auto» (follow the system), «on» (animate even if the system asks for reduced motion) or «off». Only «on» / «off»
 * are written on <html data-motion>; no attribute = auto. Its own script so the theme script and its tests stay as they are.
 */
export const MOTION_KEY = 'motion'

export const MOTION_BOOT_SCRIPT =
  "try{var m=localStorage.getItem('" + MOTION_KEY + "');if(m==='on'||m==='off')document.documentElement.setAttribute('data-motion',m)}catch(e){}"

/**
 * Look (the whole visual treatment, apart from light/dark): «premium» (black and near-white) or «navy» (the original navy and indigo). Always put on <html data-look>; no saved choice = premium. Same screens, same markup: a look is a
 * set of tokens and a CSS layer (look-premium.css), never a second copy of a screen (that was tried and reverted).
 */
export const LOOK_KEY = 'look'

export const LOOK_BOOT_SCRIPT =
  "try{document.documentElement.setAttribute('data-look',localStorage.getItem('" + LOOK_KEY + "')==='navy'?'navy':'premium')}catch(e){document.documentElement.setAttribute('data-look','premium')}"
