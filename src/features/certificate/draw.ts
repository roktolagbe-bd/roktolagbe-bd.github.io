import { splitGroup, type BloodGroup } from '@/lib/blood'

/**
 * Painting the certificate onto a canvas.
 *
 * Canvas rather than a screenshot library. html2canvas and friends cost more
 * than the whole rest of the bundle, and they render Bangla badly: the shaping
 * engine they reimplement is not the browser's, so conjuncts break apart. The
 * canvas API uses the real text stack, so ক্ত stays ক্ত.
 *
 * The palette is hard-coded to the light theme instead of being read from CSS
 * variables. A certificate is going to end up on somebody's timeline next to
 * other people's, and it should look the same whichever theme they happened to
 * have on when they saved it.
 */

const INK = '#141310'
const SURFACE = '#f3f4f0'
const RAISE = '#ffffff'
const MUTED = '#63625b'
const SHINDUR = '#c62828'
const TILE_INK = '#141310'

const TILE: Record<string, string> = {
  'A+': '#b9c5f7',
  'A-': '#8b9ce8',
  'B+': '#93ebe4',
  'B-': '#4fcfc6',
  'AB+': '#ffd475',
  'AB-': '#f5ac26',
  'O+': '#ffb0a6',
  'O-': '#fa8071',
}

/** 4:5, which is the largest portrait an Instagram or Facebook feed will show. */
export const CERT_WIDTH = 1080
export const CERT_HEIGHT = 1350

export type CertificateData = {
  fullName: string
  bloodGroup: BloodGroup
  areaName: string | null
  districtName: string | null
  totalDonations: number
  /** Preformatted, so Bangla readers get ৩ and not 3. */
  donationsText: string
  verified: boolean
  joinedLabel: string
}

export type CertificateStrings = {
  title: string
  subtitle: string
  groupLabel: string
  sinceLabel: string
  donationsLabel: string
  verifiedLabel: string
  site: string
  tagline: string
}

/** A rounded rectangle with a hard offset shadow, the way the site draws them. */
function block(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  fill: string,
  offset = 10,
) {
  ctx.fillStyle = INK
  ctx.beginPath()
  ctx.roundRect(x + offset, y + offset, w, h, radius)
  ctx.fill()

  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, radius)
  ctx.fill()

  ctx.strokeStyle = INK
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, radius)
  ctx.stroke()
}

/**
 * Shrinks the type until the line fits, rather than letting a long Bangla name
 * run off the edge of the card.
 */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  startSize: number,
  weight = '800',
) {
  let size = startSize
  do {
    ctx.font = `${weight} ${size}px 'Anek Bangla', 'Anek Latin', sans-serif`
    if (ctx.measureText(text).width <= maxWidth) break
    size -= 4
  } while (size > 24)
  return size
}

export function drawCertificate(
  canvas: HTMLCanvasElement,
  data: CertificateData,
  s: CertificateStrings,
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  canvas.width = CERT_WIDTH
  canvas.height = CERT_HEIGHT

  // ---- Ground ------------------------------------------------------------
  ctx.fillStyle = SURFACE
  ctx.fillRect(0, 0, CERT_WIDTH, CERT_HEIGHT)

  // A thick ink frame, like the edge of an enamel sign.
  ctx.strokeStyle = INK
  ctx.lineWidth = 16
  ctx.strokeRect(28, 28, CERT_WIDTH - 56, CERT_HEIGHT - 56)

  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  const mid = CERT_WIDTH / 2

  // ---- Heading -----------------------------------------------------------
  ctx.fillStyle = SHINDUR
  ctx.font = `800 46px 'Anek Bangla', 'Anek Latin', sans-serif`
  ctx.fillText(s.title, mid, 150)

  ctx.fillStyle = MUTED
  ctx.font = `500 30px 'Anek Bangla', 'Anek Latin', sans-serif`
  ctx.fillText(s.subtitle, mid, 200)

  // ---- The blood group tile ---------------------------------------------
  const { letters, sign } = splitGroup(data.bloodGroup)
  const tileSize = 300
  const tileX = mid - tileSize / 2
  const tileY = 250
  block(ctx, tileX, tileY, tileSize, tileSize, 40, TILE[data.bloodGroup] ?? '#ffb0a6', 12)

  ctx.fillStyle = TILE_INK
  ctx.font = `800 ${letters.length > 1 ? 120 : 150}px 'Anek Latin', sans-serif`
  ctx.fillText(letters, mid, tileY + 175)

  // The sign sits in an inverted chip, same as the tiles on the site.
  const chipW = 74
  const chipH = 60
  ctx.fillStyle = TILE_INK
  ctx.beginPath()
  ctx.roundRect(mid - chipW / 2, tileY + 200, chipW, chipH, 12)
  ctx.fill()
  ctx.fillStyle = TILE[data.bloodGroup] ?? '#ffb0a6'
  ctx.font = `800 46px 'Anek Latin', sans-serif`
  ctx.fillText(sign === '+' ? '+' : '−', mid, tileY + 244)

  // ---- Name --------------------------------------------------------------
  const nameSize = fitText(ctx, data.fullName, CERT_WIDTH - 220, 68)
  ctx.fillStyle = INK
  ctx.font = `800 ${nameSize}px 'Anek Bangla', 'Anek Latin', sans-serif`
  ctx.fillText(data.fullName, mid, 660)

  const place = [data.areaName, data.districtName].filter(Boolean).join(', ')
  if (place) {
    const placeSize = fitText(ctx, place, CERT_WIDTH - 240, 36, '500')
    ctx.fillStyle = MUTED
    ctx.font = `500 ${placeSize}px 'Anek Bangla', 'Anek Latin', sans-serif`
    ctx.fillText(place, mid, 715)
  }

  // ---- Facts -------------------------------------------------------------
  // Two panels when there is a donation count worth showing, one otherwise, so
  // a brand new donor's card does not read as mostly zeroes.
  const showDonations = data.totalDonations > 0
  const panelY = 790
  const panelH = 190
  const gap = 30
  const panelW = showDonations ? (CERT_WIDTH - 200 - gap) / 2 : CERT_WIDTH - 200

  const drawPanel = (x: number, w: number, label: string, value: string) => {
    block(ctx, x, panelY, w, panelH, 28, RAISE, 10)
    ctx.fillStyle = MUTED
    ctx.font = `600 28px 'Anek Bangla', 'Anek Latin', sans-serif`
    ctx.fillText(label, x + w / 2, panelY + 66)
    const valueSize = fitText(ctx, value, w - 50, 56)
    ctx.fillStyle = INK
    ctx.font = `800 ${valueSize}px 'Anek Bangla', 'Anek Latin', sans-serif`
    ctx.fillText(value, x + w / 2, panelY + 135)
  }

  drawPanel(100, panelW, s.sinceLabel, data.joinedLabel)
  if (showDonations) {
    drawPanel(100 + panelW + gap, panelW, s.donationsLabel, data.donationsText)
  }

  // ---- Verified ----------------------------------------------------------
  if (data.verified) {
    const badgeW = 340
    block(ctx, mid - badgeW / 2, 1010, badgeW, 76, 20, '#7ce8e0', 8)
    ctx.fillStyle = INK
    ctx.font = `800 34px 'Anek Bangla', 'Anek Latin', sans-serif`
    ctx.fillText(s.verifiedLabel, mid, 1060)
  }

  // ---- Footer ------------------------------------------------------------
  ctx.fillStyle = INK
  ctx.font = `800 40px 'Anek Bangla', 'Anek Latin', sans-serif`
  ctx.fillText(s.tagline, mid, data.verified ? 1170 : 1140)

  ctx.fillStyle = MUTED
  ctx.font = `600 32px 'Anek Latin', sans-serif`
  ctx.fillText(s.site, mid, data.verified ? 1225 : 1195)
}

/** The drawn canvas as a PNG blob, once the webfonts are actually available. */
export async function certificateBlob(
  data: CertificateData,
  strings: CertificateStrings,
): Promise<Blob | null> {
  // Without this the first draw can land before Anek Bangla has loaded, and
  // the canvas silently falls back to a system font that cannot shape Bangla.
  if (document.fonts?.ready) await document.fonts.ready

  const canvas = document.createElement('canvas')
  drawCertificate(canvas, data, strings)
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'))
}
