import { Users, UserRound } from 'lucide-react'
import type { PackingState } from './usePackingListPanel'

/**
 * Top-level switch between the shared group pool ("Gemeinsam") and the traveler's
 * own list ("Meine Liste" — private + items shared to them) — the #858 three-tier
 * model. Existing items live in the Common pool, so that stays the default.
 */
export function PackingViewTabs(S: PackingState) {
  const { view, setView, t, items } = S
  const commonCount = items.filter(i => !i.is_private).length
  const personalCount = items.filter(i => !!i.is_private).length

  const tab = (id: 'common' | 'personal', icon: React.ReactNode, label: string, count: number) => {
    const active = view === id
    return (
      <button onClick={() => setView(id)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 999,
          border: '1px solid', cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 'calc(12.5px * var(--fs-scale-body, 1))', fontWeight: 600,
          background: active ? 'var(--text-primary)' : 'transparent',
          borderColor: active ? 'var(--text-primary)' : 'var(--border-primary)',
          color: active ? 'var(--bg-primary)' : 'var(--text-secondary)',
          transition: 'all 0.12s',
        }}>
        {icon}{label}
        <span style={{
          fontSize: 'calc(10px * var(--fs-scale-caption, 1))', fontWeight: 700, borderRadius: 99, padding: '0 6px',
          background: active ? 'var(--bg-primary)' : 'var(--bg-tertiary)',
          color: active ? 'var(--text-primary)' : 'var(--text-faint)',
        }}>{count}</span>
      </button>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 8, padding: '10px 16px 0', flexShrink: 0 }}>
      {tab('common', <Users size={14} />, t('packing.viewCommon'), commonCount)}
      {tab('personal', <UserRound size={14} />, t('packing.viewPersonal'), personalCount)}
    </div>
  )
}
