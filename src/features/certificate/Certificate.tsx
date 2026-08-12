import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/Button'
import { useI18n } from '@/lib/i18n'
import { type BloodGroup } from '@/lib/blood'
import {
  CERT_HEIGHT,
  CERT_WIDTH,
  certificateBlob,
  drawCertificate,
  type CertificateData,
  type CertificateStrings,
} from './draw'

const SITE_URL = 'https://roktolagbe-bd.github.io'

export type CertificateRow = {
  full_name: string
  display_name: string | null
  blood_group: BloodGroup
  area_name: string | null
  district_en: string | null
  district_bn: string | null
  total_donations: number
  verified: boolean
  joined_month: string | null
}

/**
 * The certificate: shown on screen, saved as a PNG, posted anywhere.
 *
 * The same canvas is both the preview and the export, so what somebody sees is
 * exactly the file they get. Rendering it twice, once in HTML and once for
 * download, is how the two drift apart.
 */
export function Certificate({ row, shareUrl }: { row: CertificateRow; shareUrl?: string }) {
  const { t, n, lang } = useI18n()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const joined = row.joined_month
    ? new Date(`${row.joined_month}-01`).toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', {
        month: 'long',
        year: 'numeric',
      })
    : '—'

  const data: CertificateData = {
    fullName: row.full_name,
    bloodGroup: row.blood_group,
    areaName: row.area_name,
    districtName: lang === 'bn' ? row.district_bn : row.district_en,
    totalDonations: row.total_donations,
    donationsText: n(row.total_donations),
    verified: row.verified,
    joinedLabel: joined,
  }

  const strings: CertificateStrings = {
    title: t('certificate.title'),
    subtitle: t('certificate.subtitle'),
    groupLabel: t('form.bloodGroup'),
    sinceLabel: t('certificate.since'),
    donationsLabel: t('certificate.donations'),
    verifiedLabel: t('certificate.verified'),
    site: SITE_URL.replace('https://', ''),
    tagline: t('brand.name'),
  }

  // Redraw whenever the language changes: the month name, the district and the
  // labels are all translated, so a stale canvas would be half in one language.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (document.fonts?.ready) await document.fonts.ready
      if (cancelled || !canvasRef.current) return
      drawCertificate(canvasRef.current, data, strings)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, row])

  const fileName = `roktolagbe-${row.blood_group.replace('+', 'pos').replace('-', 'neg')}.png`

  const download = async () => {
    setBusy(true)
    setNote(null)
    try {
      const blob = await certificateBlob(data, strings)
      if (!blob) throw new Error('no blob')
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      link.remove()
      // Revoking immediately can cancel the download on some mobile browsers.
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      setNote(t('certificate.saved'))
    } catch {
      setNote(t('certificate.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const share = async () => {
    setBusy(true)
    setNote(null)
    const text = t('certificate.shareText', { group: row.blood_group })
    try {
      const blob = await certificateBlob(data, strings)
      const file = blob ? new File([blob], fileName, { type: 'image/png' }) : null

      // Sharing the picture itself, where the platform allows it. This is what
      // makes it worth posting rather than a link nobody taps.
      if (file && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text, title: t('brand.name') })
        setBusy(false)
        return
      }
      if (navigator.share) {
        await navigator.share({ title: t('brand.name'), text, url: SITE_URL })
        setBusy(false)
        return
      }
      throw new Error('no share')
    } catch (err) {
      // A user who dismissed the share sheet has not failed at anything, and
      // should not be told they have.
      if (err instanceof DOMException && err.name === 'AbortError') {
        setBusy(false)
        return
      }
      // Everything else falls back to the clipboard, and if that is blocked
      // too, to showing the link so it can be copied by hand. The old version
      // gave up silently here, which is why the button looked broken.
      try {
        await navigator.clipboard.writeText(`${text} ${SITE_URL}`)
        setNote(t('certificate.copied'))
      } catch {
        setNote(t('certificate.copyFailed'))
      }
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4">
      <canvas
        ref={canvasRef}
        width={CERT_WIDTH}
        height={CERT_HEIGHT}
        role="img"
        aria-label={t('certificate.alt', { name: row.full_name, group: row.blood_group })}
        className="mx-auto h-auto w-full max-w-sm rounded-md border-2 border-line shadow-ink-2"
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <Button onClick={share} disabled={busy} size="lg" block>
          {t('certificate.share')}
        </Button>
        <Button onClick={download} disabled={busy} variant="secondary" size="lg" block>
          {t('certificate.download')}
        </Button>
      </div>

      {note && (
        <p role="status" className="rounded-md border-2 border-line bg-jol-fill px-3 py-2 text-center text-sm font-bold text-tile-ink">
          {note}
        </p>
      )}

      {shareUrl && (
        <div className="rounded-md border-2 border-line bg-sunk p-4 text-sm">
          <h2 className="font-extrabold">{t('certificate.keepLink.title')}</h2>
          <p className="mt-1 text-muted">{t('certificate.keepLink.body')}</p>
          <p className="mt-2 rounded-sm border-2 border-line-soft bg-raise px-2 py-1 font-mono text-xs break-all">
            {shareUrl}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void navigator.clipboard
                .writeText(shareUrl)
                .then(() => setNote(t('certificate.linkCopied')))
                .catch(() => setNote(t('certificate.copyFailed')))
            }}
          >
            {t('certificate.keepLink.copy')}
          </Button>
          <p className="mt-3 text-xs text-muted">{t('certificate.keepLink.privacy')}</p>
        </div>
      )}
    </div>
  )
}
