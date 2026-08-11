import { useSearchParams } from 'react-router-dom'
import { slugToGroup } from '@/lib/blood'
import { Placeholder } from '@/components/Placeholder'

/**
 * Phase 1 stub. It reads the group off the query string so the handoff from a
 * blood group tile is verifiable end to end before the search itself exists.
 */
export default function Find() {
  const [params] = useSearchParams()
  const group = slugToGroup(params.get('g'))

  return (
    <Placeholder titleKey="page.find.title">
      {group && (
        <p className="mt-4 inline-flex items-center gap-2 rounded-md border-2 border-line bg-raise px-3 py-2 font-bold shadow-ink-1">
          <span className="rounded-sm border-2 border-line bg-gada-fill px-2 text-tile-ink">
            {group}
          </span>
        </p>
      )}
    </Placeholder>
  )
}
