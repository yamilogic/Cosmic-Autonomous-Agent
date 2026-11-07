import { describe, expect, it } from 'vitest'
import { modKeyFor, modShiftFor } from '../../src/renderer/src/lib/shortcut-label'
import { sidebarToastFor } from '../../src/renderer/src/lib/sidebar-toast'

describe('shortcut labels', () => {
  it('uses the command glyph on macOS', () => {
    expect(modKeyFor('MacIntel')).toBe('⌘')
    expect(modShiftFor('MacIntel')).toBe('⌘⇧')
  })

  it('uses Ctrl elsewhere', () => {
    expect(modKeyFor('Win32')).toBe('Ctrl+')
    expect(modKeyFor('Linux x86_64')).toBe('Ctrl+')
    expect(modShiftFor('Win32')).toBe('Ctrl+Shift+')
  })
})

describe('sidebar toast', () => {
  it('fires only on a visible to hidden transition', () => {
    expect(sidebarToastFor(false, true, 'Ctrl+')).toContain('Ctrl+B')
    expect(sidebarToastFor(false, true, '⌘')).toContain('⌘B')
  })

  it('does not fire when the sidebar is already hidden', () => {
    expect(sidebarToastFor(true, true, '⌘')).toBeNull()
  })

  it('does not fire when expanding or staying visible', () => {
    expect(sidebarToastFor(true, false, '⌘')).toBeNull()
    expect(sidebarToastFor(false, false, '⌘')).toBeNull()
  })
})
