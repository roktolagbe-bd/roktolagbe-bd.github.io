import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import App from './App'
import { I18nProvider } from '@/lib/i18n'
import { ThemeProvider } from '@/lib/theme'
import { MotionProvider } from '@/lib/motion'
import './styles/globals.css'

const container = document.getElementById('root')
if (!container) throw new Error('#root is missing from index.html')

createRoot(container).render(
  <StrictMode>
    {/* BrowserRouter, not HashRouter. Tokenised links go out by email and a
        URL with a # in it looks like spam. GitHub Pages is made to cooperate
        by scripts/postbuild.mjs, which copies index.html to 404.html. */}
    <BrowserRouter>
      <ThemeProvider>
        <I18nProvider>
          <MotionProvider>
            <App />
          </MotionProvider>
        </I18nProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
