import { Suspense, lazy, useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'

import { useI18n } from '@/lib/i18n'
import { Header } from '@/components/Header'
import { Footer } from '@/components/Footer'
import { ConfigBanner, OfflineBanner } from '@/components/Banners'

import Home from '@/pages/Home'
import Find from '@/pages/Find'
import Request from '@/pages/Request'
import Eligibility from '@/pages/Eligibility'
import Donors from '@/pages/Donors'
import Learn from '@/pages/Learn'
import Privacy from '@/pages/Privacy'
import Respond from '@/pages/Respond'
import NotFound from '@/pages/NotFound'

/* The admin panel is a separate download. Almost nobody who visits this site is
   an admin, and the people who are can afford to wait a second. */
const AdminApp = lazy(() => import('@/features/admin/AdminApp'))

/* The registration wizard carries validation, the district list and the map
   loader. None of that belongs in the download someone gets when they arrive
   on the landing page needing blood in the next thirty seconds. */
const Register = lazy(() => import('@/pages/Register'))

function RouteEffects() {
  const location = useLocation()
  const { lang } = useI18n()

  useEffect(() => {
    // Browsers restore scroll on back/forward, which is right. Only reset on a
    // genuinely new navigation.
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
  }, [location.pathname])

  useEffect(() => {
    document.title = lang === 'bn' ? 'রক্ত লাগবে — Roktolagbe' : 'Roktolagbe — রক্ত লাগবে'
  }, [lang])

  return null
}

function BundleLoading() {
  const { t } = useI18n()
  return (
    <p role="status" className="mx-auto max-w-6xl px-4 py-16 text-muted">
      {t('common.loading')}
    </p>
  )
}

export default function App() {
  const { t } = useI18n()

  return (
    <>
      <a className="skip-link" href="#main">
        {t('nav.skipToContent')}
      </a>

      <RouteEffects />
      <ConfigBanner />
      <OfflineBanner />
      <Header />

      <main id="main" className="min-h-[60vh]">
        <Suspense fallback={<BundleLoading />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/find" element={<Find />} />
            <Route path="/request" element={<Request />} />
            <Route path="/register" element={<Register />} />
            <Route path="/eligibility" element={<Eligibility />} />
            <Route path="/donors" element={<Donors />} />
            <Route path="/learn" element={<Learn />} />
            <Route path="/privacy" element={<Privacy />} />
            {/* Reached only from a tokenised link in an email. No login. */}
            <Route path="/respond/:token" element={<Respond />} />
            <Route path="/admin/*" element={<AdminApp />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>

      <Footer />
    </>
  )
}
