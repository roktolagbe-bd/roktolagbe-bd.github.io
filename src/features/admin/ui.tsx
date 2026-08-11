import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/* Shared pieces for the admin screens. Deliberately plain: this is a working
   tool for two or three volunteers, not a place to spend design budget. All
   the boldness in this project belongs to the blood grid. */

export function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-md border-2 border-line bg-raise p-4 shadow-ink-1">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-extrabold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warn' | 'bad' | 'good' }) {
  return (
    <div className="rounded-md border-2 border-line bg-raise px-3 py-3 shadow-ink-1">
      <p className="text-xs font-bold text-muted">{label}</p>
      <p
        className={cn(
          'mt-1 text-2xl font-extrabold tabular-nums',
          tone === 'bad' && 'text-shindur',
          tone === 'warn' && 'text-gada',
          tone === 'good' && 'text-pata',
        )}
      >
        {value}
      </p>
    </div>
  )
}

/** Tables scroll inside their own box; the page itself never scrolls sideways. */
export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border-2 border-line">
      <table className="w-full min-w-[44rem] border-collapse text-sm">{children}</table>
    </div>
  )
}

export function Th({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cn('border-b-2 border-line bg-sunk px-3 py-2 text-left font-extrabold', className)}
    >
      {children}
    </th>
  )
}

export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cn('border-b border-line-soft px-3 py-2 align-top', className)}>{children}</td>
}

/* State is a word plus a colour, never a colour alone. */
const BADGE: Record<string, string> = {
  good: 'bg-jol-fill text-tile-ink',
  warn: 'bg-gada-fill text-tile-ink',
  bad: 'bg-shindur-fill text-tile-ink',
  quiet: 'bg-sunk text-ink',
}

export function Badge({ children, tone = 'quiet' }: { children: ReactNode; tone?: keyof typeof BADGE }) {
  return (
    <span className={cn('inline-block rounded-sm border-2 border-line px-1.5 text-xs font-bold', BADGE[tone])}>
      {children}
    </span>
  )
}

export function MiniButton({
  children,
  onClick,
  tone = 'quiet',
  disabled,
}: {
  children: ReactNode
  onClick: () => void
  tone?: 'quiet' | 'bad'
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'ink-press min-h-9 rounded-md border-2 border-line px-2.5 text-xs font-bold shadow-ink-1 disabled:opacity-40',
        tone === 'bad' ? 'bg-shindur-fill text-tile-ink' : 'bg-raise text-ink',
      )}
    >
      {children}
    </button>
  )
}

/** Downloads a CSV without a server. Quoting is real, not hopeful. */
export function downloadCsv(filename: string, rows: Array<Record<string, unknown>>) {
  const first = rows[0]
  if (!first) return
  const headers = Object.keys(first)
  const escape = (value: unknown): string => {
    const text = value == null ? '' : String(value)
    // A leading =, +, - or @ makes Excel treat a cell as a formula. Donor data
    // must never execute in someone's spreadsheet.
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text
    return `"${safe.replaceAll('"', '""')}"`
  }

  const csv = [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(',')),
  ].join('\n')

  // The BOM makes Excel open Bangla correctly instead of as mojibake.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
