import { useCallback, useEffect, useState } from 'react'

export const THEME_STORAGE_KEY = 'jev-theme'

export type ThemePreference = 'light' | 'dark'

export const systemTheme = (): ThemePreference => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export const readStoredTheme = (): ThemePreference | undefined => {
  if (typeof window === 'undefined') return undefined
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (value === 'light' || value === 'dark') return value
  } catch {
    /* Ignore private-mode / blocked storage. */
  }
  return undefined
}

export const writeStoredTheme = (theme: ThemePreference): void => {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    /* Ignore private-mode / blocked storage. */
  }
}

export const resolveTheme = (stored: ThemePreference | undefined, system: ThemePreference): ThemePreference => (
  stored ?? system
)

export const applyTheme = (theme: ThemePreference, stored?: ThemePreference): void => {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  if (stored) root.dataset.theme = stored
  else delete root.dataset.theme
  root.style.colorScheme = theme
}

export const useTheme = () => {
  const [theme, setTheme] = useState<ThemePreference>(() => resolveTheme(readStoredTheme(), systemTheme()))
  const stored = readStoredTheme()

  useEffect(() => {
    applyTheme(theme, readStoredTheme())
  }, [theme])

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if (readStoredTheme()) return
      setTheme(systemTheme())
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const toggleTheme = useCallback(() => {
    const next: ThemePreference = theme === 'dark' ? 'light' : 'dark'
    writeStoredTheme(next)
    applyTheme(next, next)
    setTheme(next)
  }, [theme])

  return { theme, stored, toggleTheme }
}
