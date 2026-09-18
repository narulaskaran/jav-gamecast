import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyTheme,
  readStoredTheme,
  resolveTheme,
  THEME_STORAGE_KEY,
  useTheme,
  writeStoredTheme,
} from './theme'

const stubScheme = (dark: boolean) => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: dark && query.includes('prefers-color-scheme: dark'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null,
  }))
}

afterEach(() => {
  window.localStorage.clear()
  document.documentElement.classList.remove('dark')
  delete document.documentElement.dataset.theme
  document.documentElement.style.colorScheme = ''
  vi.unstubAllGlobals()
})

describe('theme preference', () => {
  it('follows the system scheme until a toggle is stored', () => {
    expect(resolveTheme(undefined, 'dark')).toBe('dark')
    expect(resolveTheme('light', 'dark')).toBe('light')
    writeStoredTheme('dark')
    expect(readStoredTheme()).toBe('dark')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
  })

  it('applies zinc dark class and color-scheme on the root', () => {
    applyTheme('dark', 'dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    applyTheme('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.dataset.theme).toBeUndefined()
    expect(document.documentElement.style.colorScheme).toBe('light')
  })
})

describe('useTheme', () => {
  it('persists a header toggle over the system scheme', () => {
    stubScheme(true)
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('dark')
    act(() => { result.current.toggleTheme() })
    expect(result.current.theme).toBe('light')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})
