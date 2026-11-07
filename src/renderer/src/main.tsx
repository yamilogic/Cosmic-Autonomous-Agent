import './assets/fonts.css'
import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { DEFAULT_APP_SETTINGS } from '../../shared/ipc-contract'
import App from './App'
import { applyDocumentTheme, applySidebarWidth } from './lib/workspace-theme'

applyDocumentTheme('dark')
applySidebarWidth(DEFAULT_APP_SETTINGS.sidebarWidth)

const demo = __ORBIT_DEMO__
if (demo === 'sparse' || demo === 'rich') {
  void import('./demo/mount-demo').then(({ mountDemo }) => mountDemo(demo))
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}
