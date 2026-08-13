import { Link } from 'react-router-dom'
import { useI18n } from '@/lib/i18n'
import { Brand } from './Brand'

const REPO = 'https://github.com/roktolagbe-bd/roktolagbe-bd.github.io'
const CONTACT_EMAIL = 'roktolagbebd@gmail.com'

export function Footer() {
  const { t } = useI18n()

  return (
    <footer className="mt-16 border-t-2 border-line bg-raise">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2">
        <div>
          <Brand asLink={false} />
          <p className="mt-3 max-w-sm text-sm text-muted">{t('footer.about')}</p>
        </div>

        <nav aria-label={t('nav.menu')}>
          <ul className="grid gap-2 text-sm font-bold sm:justify-end">
            <li>
              <Link to="/privacy" className="text-nil underline underline-offset-4">
                {t('footer.privacy')}
              </Link>
            </li>
            <li>
              <a
                href={`${REPO}/blob/main/CONTRIBUTING.md`}
                className="text-nil underline underline-offset-4"
                rel="noreferrer noopener"
                target="_blank"
              >
                {t('footer.contribute')}
              </a>
            </li>
            <li>
              <a
                href={REPO}
                className="text-nil underline underline-offset-4"
                rel="noreferrer noopener"
                target="_blank"
              >
                {t('footer.source')}
              </a>
            </li>
            <li>
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="text-nil underline underline-offset-4"
              >
                {CONTACT_EMAIL}
              </a>
            </li>
          </ul>
        </nav>
      </div>

      {/* This has to be said plainly and it has to be the last thing on the
          page. People arrive here in an emergency. */}
      <div className="border-t-2 border-line">
        <p className="mx-auto max-w-6xl px-4 py-4 text-sm font-bold">{t('footer.emergency')}</p>
      </div>
    </footer>
  )
}
