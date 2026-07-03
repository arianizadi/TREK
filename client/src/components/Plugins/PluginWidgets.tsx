import PluginFrame from './PluginFrame'
import type { ActivePlugin } from '../../store/pluginStore'

/**
 * Renders active `widget` plugins as dashboard cards (#plugins, M8). Each is a
 * sandboxed PluginFrame; the widget talks to TREK only over the bridge.
 */
export default function PluginWidgets({ plugins, tripId = null }: { plugins: ActivePlugin[]; tripId?: string | null }) {
  if (plugins.length === 0) return null
  return (
    <>
      {plugins.map((p) => (
        <div key={p.id} className="bg-surface-card border border-edge rounded-xl overflow-hidden">
          <div className="px-3 py-2 text-xs font-medium text-content-muted border-b border-edge-secondary flex items-center gap-1.5">
            {p.name}
          </div>
          <div style={{ height: 180 }}>
            <PluginFrame pluginId={p.id} tripId={tripId} title={p.name} className="w-full h-full" />
          </div>
        </div>
      ))}
    </>
  )
}
