'use client'

/**
 * Registry reactivity — a version counter that bumps whenever the localStorage
 * registry changes in this tab (sud:registry-changed) or another (storage).
 * Components read registry selectors during render; the version keeps them
 * honest. Starts at 0 on the server pass — hydrate-gated listings stay
 * consistent (see views).
 */

import { useEffect, useState } from 'react'

export function useRegistryVersion(): number {
  const [v, setV] = useState(0)
  useEffect(() => {
    const bump = () => setV((x) => x + 1)
    window.addEventListener('sud:registry-changed', bump)
    window.addEventListener('storage', bump)
    return () => {
      window.removeEventListener('sud:registry-changed', bump)
      window.removeEventListener('storage', bump)
    }
  }, [])
  return v
}
