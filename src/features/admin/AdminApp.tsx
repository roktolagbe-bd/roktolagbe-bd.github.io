import { Placeholder } from '@/components/Placeholder'

/**
 * Phase 1 stub for the admin panel.
 *
 * This module is the boundary of the admin bundle. Everything admin-only,
 * including Recharts and the whole donor table, must be imported from inside
 * here so that none of it can reach the entry chunk a panicking visitor on a
 * 2G connection has to download.
 */
export default function AdminApp() {
  return <Placeholder titleKey="page.admin.title" />
}
