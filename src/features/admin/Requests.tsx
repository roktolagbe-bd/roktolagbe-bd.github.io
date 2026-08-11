import { useCallback, useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Select } from '@/components/form/Field'
import { useI18n } from '@/lib/i18n'
import { callFunction } from '@/lib/functions'
import { Badge, MiniButton, Panel, TableWrap, Td, Th } from './ui'

type RequestRow = {
  id: string
  requester_name: string
  requester_phone: string
  blood_group: string
  units_needed: number
  urgency: string
  hospital_name_free_text: string | null
  status: string
  match_radius_km: number | null
  needed_by: string | null
  created_at: string
}

type Recipient = {
  recipient_id: string
  donor_name: string
  donor_phone: string
  donor_email: string | null
  blood_group: string
  distance_km: number | null
  email_status: string
  response: string
  sent_at: string | null
  responded_at: string | null
}

const EMAIL_TONE: Record<string, 'good' | 'warn' | 'bad' | 'quiet'> = {
  sent: 'good',
  queued: 'warn',
  skipped: 'quiet',
  failed: 'bad',
}
const RESPONSE_TONE: Record<string, 'good' | 'warn' | 'bad' | 'quiet'> = {
  accepted: 'good',
  pending: 'quiet',
  declined: 'warn',
}

export function Requests({ client }: { client: SupabaseClient }) {
  const { t, n, lang } = useI18n()
  const [rows, setRows] = useState<RequestRow[]>([])
  const [status, setStatus] = useState('open')
  const [open, setOpen] = useState<string | null>(null)
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    let q = client
      .from('blood_requests')
      .select(
        'id, requester_name, requester_phone, blood_group, units_needed, urgency, hospital_name_free_text, status, match_radius_km, needed_by, created_at',
      )
      .order('created_at', { ascending: false })
      .limit(100)

    if (status === 'open') q = q.in('status', ['open', 'matched'])
    else if (status !== 'all') q = q.eq('status', status)

    const { data } = await q
    setRows((data ?? []) as RequestRow[])
    setLoading(false)
  }, [client, status])

  useEffect(() => {
    void load()
  }, [load])

  const openRecipients = async (id: string) => {
    if (open === id) {
      setOpen(null)
      return
    }
    setOpen(id)
    const { data } = await client.rpc('admin_request_recipients', { in_request_id: id })
    setRecipients((data ?? []) as Recipient[])
  }

  const setStatusOf = async (id: string, next: string) => {
    setBusy(true)
    await client.rpc('admin_update_request', { in_request_id: id, in_status: next })
    setBusy(false)
    await load()
  }

  /* Re-running the sender is safe: matching never contacts the same donor
     twice, and the queue has a unique index per recipient. Use it after
     turning the master switch on, or when new donors have registered nearby. */
  const resend = async (id: string) => {
    setBusy(true)
    await callFunction('send-request-emails', { request_id: id })
    setBusy(false)
    if (open === id) await openRecipients(id)
    await load()
  }

  const when = (value: string | null) =>
    value
      ? new Date(value).toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-GB', {
          day: 'numeric',
          month: 'short',
          hour: 'numeric',
          minute: '2-digit',
        })
      : '—'

  return (
    <Panel
      title={t('admin.nav.requests')}
      action={
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('admin.filterStatus')} className="max-w-44">
          <option value="open">{t('admin.filter.openRequests')}</option>
          <option value="fulfilled">{t('admin.status.fulfilled')}</option>
          <option value="expired">{t('admin.status.expired')}</option>
          <option value="cancelled">{t('admin.status.cancelled')}</option>
          <option value="all">{t('admin.filter.all')}</option>
        </Select>
      }
    >
      {loading ? (
        <p role="status">{t('common.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="text-muted">{t('admin.noRows')}</p>
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <Th>{t('form.bloodGroup')}</Th>
              <Th>{t('request.yourName')}</Th>
              <Th>{t('request.hospital')}</Th>
              <Th>{t('admin.col.state')}</Th>
              <Th>{t('admin.col.actions')}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <>
                <tr key={r.id}>
                  <Td className="font-extrabold">
                    {r.blood_group}
                    <span className="block text-xs font-normal text-muted">
                      {n(r.units_needed)} &middot; {r.urgency}
                    </span>
                  </Td>
                  <Td>
                    {r.requester_name}
                    <span className="block text-xs text-muted tabular-nums">{r.requester_phone}</span>
                  </Td>
                  <Td>
                    {r.hospital_name_free_text ?? '—'}
                    <span className="block text-xs text-muted">{when(r.created_at)}</span>
                  </Td>
                  <Td>
                    <Badge tone={r.status === 'fulfilled' ? 'good' : r.status === 'open' ? 'warn' : 'quiet'}>
                      {r.status}
                    </Badge>
                    {r.match_radius_km != null && (
                      <span className="block text-xs text-muted">
                        {t('search.withinKm', { km: n(r.match_radius_km) })}
                      </span>
                    )}
                  </Td>
                  <Td>
                    <span className="flex flex-wrap gap-1">
                      <MiniButton onClick={() => void openRecipients(r.id)}>
                        {open === r.id ? t('admin.action.hide') : t('admin.action.whoWasTold')}
                      </MiniButton>
                      <MiniButton onClick={() => void resend(r.id)} disabled={busy}>
                        {t('admin.action.resend')}
                      </MiniButton>
                      <MiniButton onClick={() => void setStatusOf(r.id, 'fulfilled')} disabled={busy}>
                        {t('admin.action.fulfilled')}
                      </MiniButton>
                      <MiniButton onClick={() => void setStatusOf(r.id, 'cancelled')} disabled={busy} tone="bad">
                        {t('admin.action.close')}
                      </MiniButton>
                    </span>
                  </Td>
                </tr>

                {open === r.id && (
                  <tr key={`${r.id}-recipients`}>
                    <Td className="bg-sunk"> </Td>
                    <td colSpan={4} className="border-b border-line-soft bg-sunk px-3 py-2">
                      {recipients.length === 0 ? (
                        <p className="text-sm text-muted">{t('admin.noRecipients')}</p>
                      ) : (
                        <ul className="grid gap-1.5 text-sm">
                          {recipients.map((p) => (
                            <li key={p.recipient_id} className="flex flex-wrap items-center gap-2">
                              <span className="font-bold">{p.donor_name}</span>
                              <span className="tabular-nums text-muted">{p.donor_phone}</span>
                              {p.distance_km != null && (
                                <span className="text-muted">{t('search.away', { km: n(p.distance_km) })}</span>
                              )}
                              <Badge tone={EMAIL_TONE[p.email_status] ?? 'quiet'}>{p.email_status}</Badge>
                              <Badge tone={RESPONSE_TONE[p.response] ?? 'quiet'}>{p.response}</Badge>
                              <span className="text-xs text-muted">{when(p.sent_at)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </TableWrap>
      )}
    </Panel>
  )
}
