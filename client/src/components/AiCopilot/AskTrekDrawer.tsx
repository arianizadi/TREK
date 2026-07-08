import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import rehypeSanitize from 'rehype-sanitize'
import type { AiActionOperation, AiActionPlan, AiActionUndoPlan, AiDiscoveredPlace, AiUsage } from '@trek/shared'
import { AlertTriangle, Bot, Check, Loader2, MapPin, MessageSquare, RotateCcw, Search, Send, Sparkles, Trash2, Wand2, X } from 'lucide-react'
import { aiApi, mapsApi } from '../../api/client'
import type { BudgetItem, Day, PackingItem, Place, Reservation, Trip } from '../../types'
import { getApiErrorMessage } from '../../types'
import { useAuthStore } from '../../store/authStore'
import { useToast } from '../shared/Toast'

interface AskTrekDrawerProps {
  isOpen: boolean
  onClose: () => void
  tripId: number
  trip: Trip
  days: Day[]
  places: Place[]
  reservations: Reservation[]
  budgetItems: BudgetItem[]
  packingItems: PackingItem[]
  selectedDayId: number | null
  activeTab: string
  onApplied?: () => Promise<void> | void
}

interface LocalMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  usage?: AiUsage
}

interface ApplySummary {
  id: string
  success: boolean
  applied: number
  skipped: number
  undo?: AiActionUndoPlan
  undoing?: boolean
  undone?: boolean
}

type ThinkingMode = 'question' | 'planner'
type ReasoningEffort = 'low' | 'medium' | 'high'
type LocationBias = { lat: number; lng: number; radius?: number }
type AreaBias = { lat: number; lng: number; radius: number; label: string }
type DiscoveryPlace = AiDiscoveredPlace & { key: string }
type BiasSource = 'area' | 'trip' | 'tripArea' | null

const THINKING_WORDS: Record<ThinkingMode, string[]> = {
  question: [
    'Reading', 'trip', 'context.', 'Checking', 'dates,', 'reservations,', 'places,', 'packing,', 'and', 'budget.',
    'Preparing', 'a', 'clear', 'answer.',
  ],
  planner: [
    'Reading', 'trip', 'context.', 'Checking', 'safe', 'operations,', 'permissions,', 'reservations,', 'and', 'risk.',
    'Drafting', 'confirmable', 'changes.',
  ],
}

const QUESTION_ACTIONS: Array<{ label: string; prompt: string }> = [
  { label: 'Trip health check', prompt: 'Run a full trip health check: unassigned places, empty or overloaded days, missing accommodation or transport, reservations that conflict with day timing, budget items missing prices, packing gaps, and weather risks. Rank issues by severity and give a concrete fix for each.' },
  { label: 'Check if this is possible', prompt: 'Check if this itinerary is feasible. Look for date conflicts, day density, travel gaps, reservations, weather exposure, and budget pressure.' },
  { label: 'Weather outlook', prompt: 'Summarize the weather forecast attached to the trip days and what it means for the planned activities. Call out the days where plans should change.' },
  { label: 'What can go wrong?', prompt: 'Give me a risk radar for this trip with severity, likelihood, and concrete mitigations.' },
  { label: 'Give me alternate plans', prompt: 'Give me three alternate plans with tradeoffs: cheaper, calmer, and maximum sightseeing.' },
  { label: 'Budget sanity check', prompt: 'Check the budget for missing costs, expensive days, currency issues, and practical swaps.' },
  { label: 'Travel chaos mode', prompt: 'Assume something changes during travel. Show what to preserve, what to replan, and who needs updates.' },
]

const PLANNER_ACTIONS: Array<{ label: string; prompt: string }> = [
  { label: 'Fix this day', prompt: 'Draft safe changes that make the selected day more realistic. Keep reservations intact.' },
  { label: 'Optimize day route', prompt: 'Reorder the selected day\'s itinerary to minimize backtracking between locations, using the place coordinates in context. Use reorder_itinerary, and set realistic visit times with set_assignment_time where it clearly helps. Explain the route logic briefly in the plan summary.' },
  { label: 'Weather-proof my plan', prompt: 'Use the per-day weather in context to move weather-sensitive outdoor activities to drier days and keep indoor options on wet days. Prefer move_assignment over deleting anything, and add warnings where the forecast is uncertain.' },
  { label: 'Make this cheaper', prompt: 'Draft safe trip changes that reduce cost without deleting existing reservations.' },
  { label: 'Make this more relaxed', prompt: 'Draft safe changes that reduce day density and add breathing room. Prefer moving activities to lighter days over removing them.' },
  { label: 'Rainy-day backup', prompt: 'Draft a rainy-day backup using indoor options and notes. Do not replace confirmed reservations.' },
  { label: 'Packing from itinerary', prompt: 'Draft packing list items based on the itinerary, reservations, the weather forecast in context, and activities. Use the traveler count for quantities, and update existing packing items instead of duplicating them.' },
  { label: 'Clean up trip data', prompt: 'Find inconsistencies in this trip: duplicate places, places missing coordinates or addresses, stale notes, budget items missing prices or person counts, and packing quantities that do not match the traveler count. Draft only clearly safe fixes using update operations; list anything uncertain as warnings instead of changing it.' },
]

const REASONING_OPTIONS: Array<{ value: ReasoningEffort; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Normal' },
  { value: 'high', label: 'High' },
]

const DISCOVERY_QUICK_SEARCHES = ['top sights', 'hikes', 'rainy day activities', 'restaurants']

export default function AskTrekDrawer({
  isOpen,
  onClose,
  tripId,
  trip,
  days,
  places,
  reservations,
  budgetItems,
  packingItems,
  selectedDayId,
  activeTab,
  onApplied,
}: AskTrekDrawerProps) {
  const toast = useToast()
  const isAdmin = useAuthStore(s => s.user?.role === 'admin')
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<LocalMessage[]>([])
  const [status, setStatus] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [thinkingMode, setThinkingMode] = useState<ThinkingMode | null>(null)
  const [thinkingText, setThinkingText] = useState('')
  const [thinkingCollapsed, setThinkingCollapsed] = useState(false)
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('medium')
  const [discoverQuery, setDiscoverQuery] = useState('')
  const [areaBias, setAreaBias] = useState<AreaBias | null>(() => loadAreaBias(tripId))
  const [autoTripAreaBias, setAutoTripAreaBias] = useState<AreaBias | null>(null)
  const [areaQuery, setAreaQuery] = useState('')
  const [settingArea, setSettingArea] = useState(false)
  const [discovering, setDiscovering] = useState(false)
  const [discoverResults, setDiscoverResults] = useState<DiscoveryPlace[]>([])
  const [selectedDiscoveryKeys, setSelectedDiscoveryKeys] = useState<Set<string>>(new Set())
  const [plan, setPlan] = useState<AiActionPlan | null>(null)
  const [selectedOps, setSelectedOps] = useState<Set<string>>(new Set())
  const [applyEvents, setApplyEvents] = useState<ApplySummary[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const scrollEndRef = useRef<HTMLDivElement | null>(null)
  const clearNonceRef = useRef(0)

  const selectedDay = useMemo(
    () => days.find(d => selectedDayId != null && d.id === selectedDayId) ?? null,
    [days, selectedDayId],
  )
  const dayLabels = useMemo(() => new Map(days.map((day, index) => [String(day.id), formatDayLabel(day, index)])), [days])
  const placeLabels = useMemo(() => new Map(places.map(place => [String(place.id), place.name])), [places])
  const operationLabels: OperationLabels = useMemo(() => ({
    dayLabels,
    placeLabels,
    budgetLabels: new Map(budgetItems.map(item => [String(item.id), item.name])),
    packingLabels: new Map(packingItems.map(item => [String(item.id), item.name])),
    reservationLabels: new Map(reservations.map(reservation => [String(reservation.id), reservation.title])),
    assignmentLabels: new Map(days.flatMap((day, index) =>
      (day.assignments || []).map(assignment => [
        String(assignment.id),
        { placeName: assignment.place?.name || 'this activity', dayLabel: formatDayLabel(day, index) },
      ] as const),
    )),
  }), [budgetItems, dayLabels, days, packingItems, placeLabels, reservations])
  const tripBias = useMemo(() => computeLocationBias(selectedDay, places, reservations), [places, reservations, selectedDay])
  const tripAreaLabel = useMemo(() => inferTripAreaLabel(trip), [trip.description, trip.title])
  // A user-set area wins over trip-derived bias: on an empty trip there is nothing
  // to derive from, and provider defaults would bias results to the user's own region.
  const locationBias: LocationBias | undefined = areaBias ?? tripBias ?? autoTripAreaBias ?? undefined
  const biasSource: BiasSource = areaBias ? 'area' : tripBias ? 'trip' : autoTripAreaBias ? 'tripArea' : null
  const hasLiveWeather = useMemo(() => {
    if (!locationBias) return false
    const todayIso = isoDateLocal(new Date())
    const horizonIso = isoDateLocal(new Date(Date.now() + 15 * 86_400_000))
    return days.some(day => typeof day.date === 'string' && day.date.slice(0, 10) >= todayIso && day.date.slice(0, 10) <= horizonIso)
  }, [days, locationBias])
  const selectedDiscoveredPlaces = useMemo(
    () => discoverResults.filter(place => selectedDiscoveryKeys.has(place.key)).slice(0, 20).map(toAiDiscoveredPlace),
    [discoverResults, selectedDiscoveryKeys],
  )
  const context = useMemo(
    () => ({ selectedDayId, activeTab, discoveredPlaces: selectedDiscoveredPlaces }),
    [activeTab, selectedDayId, selectedDiscoveredPlaces],
  )
  const chips = useMemo(() => [
    `Trip: ${trip.title}`,
    `Dates: ${trip.start_date || '?'} to ${trip.end_date || '?'}`,
    `Budget: ${budgetItems.length} item${budgetItems.length === 1 ? '' : 's'}`,
    `Reservations: ${reservations.length}`,
    hasLiveWeather ? 'Weather: forecast attached' : 'Weather: outside forecast range',
    `Packing: ${packingItems.length} item${packingItems.length === 1 ? '' : 's'}`,
    selectedDay ? `Selected day: ${selectedDay.title || `Day ${selectedDay.day_number ?? selectedDay.id}`}` : 'Selected day: none',
    selectedDiscoveredPlaces.length ? `Discovered: ${selectedDiscoveredPlaces.length} selected` : null,
  ].filter(Boolean) as string[], [budgetItems.length, hasLiveWeather, packingItems.length, reservations.length, selectedDay, selectedDiscoveredPlaces.length, trip.end_date, trip.start_date, trip.title])

  useEffect(() => {
    if (!isOpen) abortRef.current?.abort()
  }, [isOpen])

  useEffect(() => {
    setAreaBias(loadAreaBias(tripId))
    setAutoTripAreaBias(null)
    setAreaQuery('')
  }, [tripId])

  useEffect(() => () => abortRef.current?.abort(), [])

  useEffect(() => {
    if (!thinkingMode || thinkingCollapsed) return
    setThinkingText('')
    let index = 0
    const words = THINKING_WORDS[thinkingMode]
    const timer = window.setInterval(() => {
      const word = words[index % words.length]
      setThinkingText(prev => {
        const prefix = index > 0 && index % words.length === 0 ? ' Still working.' : ''
        const next = `${prev}${prefix}${prev || prefix ? ' ' : ''}${word}`.trimStart()
        return next.length > 360 ? next.slice(next.length - 360).replace(/^\S+\s*/, '') : next
      })
      index += 1
    }, 135)
    return () => window.clearInterval(timer)
  }, [thinkingCollapsed, thinkingMode])

  const messageContentSize = messages.map(message => message.content.length).join(':')
  useEffect(() => {
    if (!isOpen) return
    const id = window.requestAnimationFrame(() => {
      scrollEndRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
    })
    return () => window.cancelAnimationFrame(id)
  }, [applyEvents.length, isOpen, messageContentSize, plan?.id, previewing, status, streaming])

  if (!isOpen) return null

  const sendChat = async (prompt = input.trim()) => {
    if (!prompt || streaming || previewing || applying) return
    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller
    setStatus('Connecting to TREK AI...')
    setStreaming(true)
    setThinkingMode('question')
    setThinkingCollapsed(false)
    setPlan(null)
    setInput('')

    const assistantId = randomId()
    const userMsg: LocalMessage = { id: randomId(), role: 'user', content: prompt }
    const assistantMsg: LocalMessage = { id: assistantId, role: 'assistant', content: '' }
    const history = messages
      .filter(m => m.content.trim())
      .slice(-12)
      .map(m => ({ role: m.role, content: m.content }))

    setMessages(prev => [...prev, userMsg, assistantMsg])
    try {
      await aiApi.chatStream(
        { tripId, context, messages: [...history, { role: 'user', content: prompt }], ...(isAdmin ? { reasoningEffort } : {}) },
        {
          signal: controller.signal,
          onStatus: setStatus,
          onToken: token => {
            setThinkingCollapsed(true)
            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: m.content + token } : m))
          },
          onUsage: usage => {
            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, usage } : m))
          },
          onError: message => {
            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: m.content || message } : m))
            toast.error(message)
          },
          onDone: () => setStatus(''),
        },
      )
    } catch (err) {
      if (!controller.signal.aborted) {
        const message = getApiErrorMessage(err, 'AI chat failed')
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: m.content || message } : m))
        toast.error(message)
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setStreaming(false)
      setThinkingMode(null)
      setStatus('')
    }
  }

  const draftPlan = async (prompt = input.trim()) => {
    if (!prompt || streaming || previewing || applying) return
    // Don't burn an LLM round on a prompt about discovered places when none are
    // selected — the model can only answer "nothing to add".
    if (/discovered places/i.test(prompt) && selectedDiscoveredPlaces.length === 0) {
      toast.error('Select discovered places first — search above and tick the ones you want')
      return
    }
    const nonce = clearNonceRef.current
    setPreviewing(true)
    setThinkingMode('planner')
    setThinkingCollapsed(false)
    setPlan(null)
    try {
      const res = await aiApi.preview({ tripId, prompt, context, ...(isAdmin ? { reasoningEffort } : {}) })
      if (nonce !== clearNonceRef.current) return
      setThinkingCollapsed(true)
      setPlan(res.plan)
      setSelectedOps(new Set(res.plan.operations.map(operationId)))
      setInput('')
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not draft AI changes'))
    } finally {
      setPreviewing(false)
      setThinkingMode(null)
    }
  }

  const applySelected = async () => {
    if (!plan || applying) return
    const confirmedOperationIds = plan.operations.map(operationId).filter(id => selectedOps.has(id))
    if (!confirmedOperationIds.length) {
      toast.error('Select at least one change to apply')
      return
    }
    setApplying(true)
    try {
      const result = await aiApi.apply({ tripId, plan, confirmedOperationIds })
      const summary: ApplySummary = {
        id: randomId(),
        success: result.success,
        applied: result.applied.length,
        skipped: result.skipped.length,
        undo: result.undo,
      }
      setApplyEvents(prev => [...prev, summary])
      if (result.applied.length) await onApplied?.()
      if (result.skipped.length) toast.error(`${result.skipped.length} AI change${result.skipped.length === 1 ? '' : 's'} could not be applied`)
      else toast.success('AI changes applied')
      setPlan(null)
      setSelectedOps(new Set())
      // Applied discovery candidates are now real trip places; keeping them
      // selected would feed stale context into the next draft.
      setDiscoverResults([])
      setSelectedDiscoveryKeys(new Set())
      setDiscoverQuery('')
      setMessages(prev => [
        ...prev,
        {
          id: randomId(),
          role: 'assistant',
          content: `Planner apply finished. Applied ${summary.applied} change${summary.applied === 1 ? '' : 's'}${summary.skipped ? `; skipped ${summary.skipped}` : ''}.`,
        },
      ])
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not apply AI changes'))
    } finally {
      setApplying(false)
    }
  }

  const undoApply = async (eventId: string) => {
    const event = applyEvents.find(item => item.id === eventId)
    if (!event?.undo || event.undoing || event.undone || streaming || previewing || applying) return
    setApplyEvents(prev => prev.map(item => item.id === eventId ? { ...item, undoing: true } : item))
    try {
      const result = await aiApi.undo({ tripId, undo: event.undo })
      if (result.undone.length) await onApplied?.()
      setApplyEvents(prev => prev.map(item => item.id === eventId ? { ...item, undoing: false, undone: result.success } : item))
      if (result.skipped.length) toast.error(`${result.skipped.length} undo step${result.skipped.length === 1 ? '' : 's'} could not be completed`)
      else toast.success('AI apply undone')
    } catch (err) {
      setApplyEvents(prev => prev.map(item => item.id === eventId ? { ...item, undoing: false } : item))
      toast.error(getApiErrorMessage(err, 'Could not undo AI changes'))
    }
  }

  const clearChat = () => {
    clearNonceRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    setMessages([])
    setPlan(null)
    setSelectedOps(new Set())
    setApplyEvents([])
    setDiscoverQuery('')
    setDiscovering(false)
    setDiscoverResults([])
    setSelectedDiscoveryKeys(new Set())
    setStatus('')
    setInput('')
    setStreaming(false)
    setPreviewing(false)
    setApplying(false)
    setThinkingMode(null)
    setThinkingText('')
    setThinkingCollapsed(false)
  }

  const askQuestion = (prompt = input.trim()) => {
    void sendChat(prompt)
  }

  const draftPlannerChanges = (prompt = input.trim()) => {
    void draftPlan(prompt)
  }

  const runQuestionAction = (action: (typeof QUESTION_ACTIONS)[number]) => {
    setInput(action.prompt)
    askQuestion(action.prompt)
  }

  const runPlannerAction = (action: (typeof PLANNER_ACTIONS)[number]) => {
    setInput(action.prompt)
    draftPlannerChanges(action.prompt)
  }

  const resolveAreaBias = async (query: string): Promise<AreaBias | null> => {
    const clean = query.trim()
    if (!clean) return null
    const result = await mapsApi.search(clean, 'en')
    const match = ((result.places || []) as Record<string, unknown>[])
      .map(normalizeDiscoveryPlace)
      .filter((place): place is DiscoveryPlace => Boolean(place))
      .find(place => place.lat != null && place.lng != null)
    if (!match) return null
    return { lat: match.lat!, lng: match.lng!, radius: 150_000, label: match.name }
  }

  const setDiscoveryArea = async () => {
    const clean = areaQuery.trim()
    if (!clean || settingArea || discovering) return
    setSettingArea(true)
    try {
      const next = await resolveAreaBias(clean)
      if (!next) {
        toast.error('Could not find that area — try a city or region name')
        return
      }
      setAreaBias(next)
      setAutoTripAreaBias(null)
      saveAreaBias(tripId, next)
      setAreaQuery('')
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not set the search area'))
    } finally {
      setSettingArea(false)
    }
  }

  const clearDiscoveryArea = () => {
    setAreaBias(null)
    saveAreaBias(tripId, null)
  }

  const runDiscoverySearch = async (query = discoverQuery.trim()) => {
    const clean = query.trim()
    if (!clean || discovering || streaming || previewing || applying) return
    setDiscoverQuery(clean)
    setDiscovering(true)
    setSelectedDiscoveryKeys(new Set())
    try {
      let effectiveBias = locationBias
      let effectiveAreaLabel = areaBias?.label ?? autoTripAreaBias?.label ?? null
      if (!effectiveBias && tripAreaLabel) {
        const resolved = await resolveAreaBias(tripAreaLabel)
        if (resolved) {
          setAutoTripAreaBias(resolved)
          effectiveBias = resolved
          effectiveAreaLabel = resolved.label
        }
      }
      if (!effectiveBias) {
        toast.error(tripAreaLabel
          ? `Could not locate ${tripAreaLabel}. Set a search area before discovering places.`
          : 'Set a trip search area first so discovery does not use your current/default location.')
        return
      }
      const scopedQuery = effectiveAreaLabel ? scopeDiscoveryQuery(clean, effectiveAreaLabel) : clean
      const result = await mapsApi.search(scopedQuery, 'en', effectiveBias)
      const normalized = ((result.places || []) as Record<string, unknown>[])
        .map(normalizeDiscoveryPlace)
        .filter((place): place is DiscoveryPlace => Boolean(place))
        .slice(0, 8)
      setDiscoverResults(normalized)
      if (!normalized.length) toast.error('No places found for that search')
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Place discovery failed'))
    } finally {
      setDiscovering(false)
    }
  }

  const toggleDiscoveryPlace = (key: string) => {
    setSelectedDiscoveryKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else if (next.size < 20) next.add(key)
      return next
    })
  }

  const askAboutDiscoveredPlaces = () => {
    if (!selectedDiscoveredPlaces.length) return
    const prompt = `Compare the selected discovered places for this trip. Explain which fit best, what the risks are, and where they might belong without drafting changes yet.`
    setInput(prompt)
    askQuestion(prompt)
  }

  const draftDiscoveredPlaces = () => {
    if (!selectedDiscoveredPlaces.length) return
    const selectedDayText = selectedDay ? ` Prefer the selected day (${formatDayLabel(selectedDay, days.findIndex(day => day.id === selectedDay.id))}) when the timing is plausible.` : ''
    const prompt = `Add the selected discovered places to this trip. Preserve their Google/Maps provider ids, coordinates, addresses, websites, and phone numbers. Assign each place to a concrete, sensible day via assignToDayId — group nearby places on the same day and avoid arrival/departure days for time-consuming activities. Only leave a place unplanned if no day plausibly fits, and say why.${selectedDayText}`
    setInput(prompt)
    draftPlannerChanges(prompt)
  }

  return (
    <div className="fixed inset-0 z-[10000] flex justify-end bg-[rgba(0,0,0,0.28)]" onClick={onClose}>
      <div
        className="flex h-full min-h-0 w-full max-w-[520px] flex-col border-l border-edge bg-surface-card text-content shadow-2xl"
        style={{ minWidth: 0 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-edge-secondary px-4 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-text">
            <Sparkles size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">Ask TREK</div>
            <div className="truncate text-xs text-content-faint">OpenRouter Qwen · admin-configured reasoning</div>
          </div>
          <button
            type="button"
            title="Clear chat"
            onClick={clearChat}
            disabled={!messages.length && !plan && !applyEvents.length && !input.trim()}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-tertiary text-content transition-opacity hover:opacity-80 disabled:opacity-40"
          >
            <Trash2 size={15} />
          </button>
          <button
            type="button"
            title="Close"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-tertiary text-content transition-opacity hover:opacity-80"
          >
            <X size={16} />
          </button>
        </div>

        <div className="border-b border-edge-secondary px-4 py-3">
          <div className="flex flex-wrap gap-1.5">
            {chips.map(chip => (
              <span key={chip} className="max-w-full truncate rounded-md border border-edge-secondary bg-surface px-2 py-1 text-[11px] text-content-secondary">
                {chip}
              </span>
            ))}
          </div>
          {isAdmin && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-edge-secondary bg-surface px-3 py-2">
              <div className="text-xs font-medium text-content-secondary">Reasoning mode</div>
              <div className="flex rounded-lg border border-edge-secondary bg-surface-card p-0.5">
                {REASONING_OPTIONS.map(option => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setReasoningEffort(option.value)}
                    className={`min-h-8 px-3 text-xs font-medium transition-colors ${reasoningEffort === option.value ? 'rounded-md bg-accent text-accent-text' : 'text-content-muted hover:text-content'}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <DiscoveryPanel
            query={discoverQuery}
            onQueryChange={setDiscoverQuery}
            results={discoverResults}
            selectedKeys={selectedDiscoveryKeys}
            disabled={streaming || previewing || applying}
            searching={discovering}
            biasSource={biasSource}
            areaLabel={areaBias?.label ?? autoTripAreaBias?.label ?? tripAreaLabel}
            areaQuery={areaQuery}
            onAreaQueryChange={setAreaQuery}
            settingArea={settingArea}
            onSetArea={() => void setDiscoveryArea()}
            onClearArea={clearDiscoveryArea}
            onSearch={() => void runDiscoverySearch()}
            onQuickSearch={term => void runDiscoverySearch(term)}
            onToggle={toggleDiscoveryPlace}
            onAsk={askAboutDiscoveredPlaces}
            onDraft={draftDiscoveredPlaces}
          />

          <div className="grid gap-3">
            <ShortcutGroup
              title="Questions only"
              description="Answers stream into chat. No trip changes are drafted."
              icon={<MessageSquare size={14} />}
              actions={QUESTION_ACTIONS}
              disabled={streaming || previewing || applying}
              onRun={runQuestionAction}
            />
            <ShortcutGroup
              title="Planner changes"
              description="Creates a draft plan with checkboxes and a separate confirmation step."
              icon={<Wand2 size={14} />}
              actions={PLANNER_ACTIONS}
              disabled={streaming || previewing || applying}
              onRun={runPlannerAction}
              emphasis
            />
          </div>

          {messages.length === 0 && !plan && applyEvents.length === 0 && (
            <div className="rounded-lg border border-edge-secondary bg-surface p-4 text-sm text-content-secondary">
              No conversation yet.
            </div>
          )}

          {messages.map(message => (
            <div key={message.id} className={`flex gap-2 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {message.role === 'assistant' && (
                <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-tertiary text-content-muted">
                  <Bot size={14} />
                </div>
              )}
              <div className={`max-w-[86%] rounded-lg px-3 py-2 text-sm leading-6 ${message.role === 'user' ? 'bg-accent text-accent-text' : 'bg-surface text-content'}`}>
                {message.role === 'assistant' && message.content
                  ? <AssistantMarkdown content={message.content} />
                  : message.content || (message.role === 'assistant' && streaming ? <span className="text-content-faint">Answer will stream here...</span> : '')}
                {message.usage && (
                  <div className="mt-2 border-t border-edge-secondary pt-1 text-[11px] text-content-faint">
                    {formatUsage(message.usage)}
                  </div>
                )}
              </div>
            </div>
          ))}

          {thinkingMode && (
            <ThinkingTrace collapsed={thinkingCollapsed} text={thinkingText} mode={thinkingMode} />
          )}

          {(status || streaming) && (
            <div className="flex items-center gap-2 text-xs text-content-faint">
              <Loader2 size={13} className="animate-spin" />
              <span>{status || 'Streaming response...'}</span>
            </div>
          )}

          {applyEvents.map(event => (
            <div key={event.id} className={`rounded-lg border p-3 text-sm ${event.success ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">
                    {event.undone ? 'AI apply undone' : `Applied ${event.applied}, skipped ${event.skipped}.`}
                  </div>
                  <div className="mt-1 text-xs opacity-80">
                    {event.undone ? 'The rollback has already run.' : 'The planner draft was cleared after apply.'}
                  </div>
                </div>
                {event.undo && !event.undone && (
                  <button
                    type="button"
                    onClick={() => void undoApply(event.id)}
                    disabled={event.undoing || streaming || previewing || applying}
                    className="flex shrink-0 items-center gap-1.5 rounded-md border border-edge-secondary bg-surface px-2.5 py-1.5 text-xs font-medium text-content transition-opacity disabled:opacity-50"
                  >
                    {event.undoing ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                    Undo
                  </button>
                )}
              </div>
            </div>
          ))}

          {plan && (
            <div className="space-y-3 rounded-lg border border-edge bg-surface p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-tertiary text-content-muted">
                  <Wand2 size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{plan.title}</div>
                  <div className="mt-1 text-sm leading-6 text-content-secondary">{plan.summary}</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className={`rounded-md px-2 py-1 text-[11px] font-medium ${riskClass(plan.riskLevel)}`}>Risk: {plan.riskLevel}</span>
                    {plan.usage && <span className="rounded-md bg-surface-tertiary px-2 py-1 text-[11px] text-content-muted">{formatUsage(plan.usage)}</span>}
                  </div>
                </div>
              </div>

              {(plan.warnings.length > 0 || plan.assumptions.length > 0 || plan.alternatives.length > 0) && (
                <div className="grid gap-2 text-xs text-content-secondary">
                  {plan.warnings.length > 0 && <PlanList icon={<AlertTriangle size={13} />} title="Warnings" items={plan.warnings} />}
                  {plan.assumptions.length > 0 && <PlanList title="Assumptions" items={plan.assumptions} />}
                  {plan.alternatives.length > 0 && <PlanList title="Alternatives" items={plan.alternatives} />}
                </div>
              )}

              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-content-faint">What AI will change</div>
                  <button
                    type="button"
                    onClick={() => setSelectedOps(new Set(plan.operations.map(operationId)))}
                    className="text-xs text-content-muted underline"
                  >
                    Select all
                  </button>
                </div>
                {plan.operations.length === 0 ? (
                  <div className="rounded-lg border border-edge-secondary bg-surface-card p-3 text-sm text-content-muted">No writes were drafted.</div>
                ) : (
                  <div className="space-y-2">
                    {plan.operations.map((operation, index) => {
                      const id = operationId(operation, index)
                      const selected = selectedOps.has(id)
                      return (
                        <label key={id} className="flex gap-3 rounded-lg border border-edge-secondary bg-surface-card p-3">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => setSelectedOps(prev => {
                              const next = new Set(prev)
                              if (next.has(id)) next.delete(id)
                              else next.add(id)
                              return next
                            })}
                            className="mt-1 h-4 w-4 shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium">{operation.title || operationTypeLabel(operation.type)}</div>
                            <div className="mt-1 text-xs leading-5 text-content-secondary">{operation.description || describeOperation(operation, operationLabels)}</div>
                            {operation.warning && <div className="mt-1 text-xs text-amber-600">{operation.warning}</div>}
                          </div>
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>

              <button
                type="button"
                disabled={applying || plan.operations.length === 0 || selectedOps.size === 0}
                onClick={applySelected}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-text transition-opacity disabled:opacity-50"
              >
                {applying ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                Confirm selected changes
              </button>
            </div>
          )}
          <div ref={scrollEndRef} />
        </div>

        <div className="border-t border-edge-secondary p-4">
          <div className="grid gap-3">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void sendChat()
              }}
              placeholder="Type a question or a planner change request..."
              className="min-h-[44px] max-h-32 flex-1 resize-y rounded-lg border border-edge bg-surface px-3 py-2 text-sm text-content placeholder:text-content-faint focus:border-edge focus:outline-none"
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                title="Ask question"
                disabled={!input.trim() || streaming || previewing || applying}
                onClick={() => askQuestion()}
                className="flex min-h-10 items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-text transition-opacity disabled:opacity-50"
              >
                <Send size={16} />
                Ask question
              </button>
              <button
                type="button"
                title="Draft planner changes"
                disabled={!input.trim() || streaming || previewing || applying}
                onClick={() => draftPlannerChanges()}
                className="flex min-h-10 items-center justify-center gap-2 rounded-lg border border-edge-secondary bg-surface px-3 py-2 text-sm font-medium text-content transition-opacity disabled:opacity-50"
              >
                {previewing ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
                Draft planner changes
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ShortcutGroup({
  title,
  description,
  icon,
  actions,
  disabled,
  onRun,
  emphasis,
}: {
  title: string
  description: string
  icon: ReactNode
  actions: Array<{ label: string; prompt: string }>
  disabled: boolean
  onRun: (action: { label: string; prompt: string }) => void
  emphasis?: boolean
}) {
  return (
    <div className={`rounded-lg border p-3 ${emphasis ? 'border-edge bg-surface' : 'border-edge-secondary bg-surface-card'}`}>
      <div className="mb-2 flex items-start gap-2">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-tertiary text-content-muted">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold">{title}</div>
          <div className="text-xs leading-5 text-content-faint">{description}</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {actions.map(action => (
          <button
            key={action.label}
            type="button"
            disabled={disabled}
            onClick={() => onRun(action)}
            className="rounded-md border border-edge-secondary bg-surface px-2.5 py-1.5 text-xs text-content-secondary transition-colors hover:border-edge disabled:opacity-50"
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function DiscoveryPanel({
  query,
  onQueryChange,
  results,
  selectedKeys,
  disabled,
  searching,
  biasSource,
  areaLabel,
  areaQuery,
  onAreaQueryChange,
  settingArea,
  onSetArea,
  onClearArea,
  onSearch,
  onQuickSearch,
  onToggle,
  onAsk,
  onDraft,
}: {
  query: string
  onQueryChange: (value: string) => void
  results: DiscoveryPlace[]
  selectedKeys: Set<string>
  disabled: boolean
  searching: boolean
  biasSource: BiasSource
  areaLabel: string | null
  areaQuery: string
  onAreaQueryChange: (value: string) => void
  settingArea: boolean
  onSetArea: () => void
  onClearArea: () => void
  onSearch: () => void
  onQuickSearch: (term: string) => void
  onToggle: (key: string) => void
  onAsk: () => void
  onDraft: () => void
}) {
  const selectedCount = selectedKeys.size
  const biasText = biasSource === 'area'
    ? `Searching near ${areaLabel}.`
    : biasSource === 'trip'
      ? 'Searching near this trip’s planned places.'
      : biasSource === 'tripArea'
        ? `Searching near ${areaLabel}.`
        : areaLabel
          ? `Will search near ${areaLabel}.`
          : 'No trip location yet — set an area so results match your destination.'
  return (
    <div className="rounded-lg border border-edge bg-surface p-3">
      <div className="mb-2 flex items-start gap-2">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-tertiary text-content-muted">
          <MapPin size={14} />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold">Discover places</div>
          <div className="text-xs leading-5 text-content-faint">{biasText}</div>
        </div>
      </div>

      {biasSource === 'area' ? (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-edge-secondary bg-surface-card px-2 py-1 text-[11px] text-content-secondary">
            <MapPin size={11} />
            <span className="truncate">Area: {areaLabel}</span>
          </span>
          <button
            type="button"
            onClick={onClearArea}
            disabled={disabled || searching}
            className="rounded-md border border-edge-secondary bg-surface-card px-2 py-1 text-[11px] text-content-muted transition-colors hover:border-edge disabled:opacity-50"
          >
            Clear area
          </button>
        </div>
      ) : (
        <form
          className="mb-2 flex gap-2"
          onSubmit={event => {
            event.preventDefault()
            onSetArea()
          }}
        >
          <input
            value={areaQuery}
            onChange={event => onAreaQueryChange(event.target.value)}
            placeholder={biasSource === 'trip' ? 'Override area (city, region, country)...' : 'Trip area, e.g. Costa Rica...'}
            className="min-w-0 flex-1 rounded-lg border border-edge-secondary bg-surface-card px-3 py-1.5 text-xs text-content placeholder:text-content-faint focus:border-edge focus:outline-none"
          />
          <button
            type="submit"
            disabled={disabled || settingArea || !areaQuery.trim()}
            className="flex h-8 shrink-0 items-center justify-center rounded-lg border border-edge-secondary bg-surface-card px-3 text-xs font-medium text-content transition-colors hover:border-edge disabled:opacity-50"
            title="Set search area"
          >
            {settingArea ? <Loader2 size={13} className="animate-spin" /> : 'Set area'}
          </button>
        </form>
      )}

      <form
        className="flex gap-2"
        onSubmit={event => {
          event.preventDefault()
          onSearch()
        }}
      >
        <input
          value={query}
          onChange={event => onQueryChange(event.target.value)}
          placeholder="Search places..."
          className="min-w-0 flex-1 rounded-lg border border-edge-secondary bg-surface-card px-3 py-2 text-sm text-content placeholder:text-content-faint focus:border-edge focus:outline-none"
        />
        <button
          type="submit"
          disabled={disabled || searching || !query.trim()}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-text transition-opacity disabled:opacity-50"
          title="Search places"
        >
          {searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
        </button>
      </form>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {DISCOVERY_QUICK_SEARCHES.map(term => (
          <button
            key={term}
            type="button"
            disabled={disabled || searching}
            onClick={() => onQuickSearch(term)}
            className="rounded-md border border-edge-secondary bg-surface-card px-2.5 py-1.5 text-xs text-content-secondary transition-colors hover:border-edge disabled:opacity-50"
          >
            {term}
          </button>
        ))}
      </div>

      {results.length > 0 && (
        <div className="mt-3 space-y-2">
          {results.map(place => {
            const selected = selectedKeys.has(place.key)
            return (
              <label key={place.key} className="flex gap-3 rounded-lg border border-edge-secondary bg-surface-card p-3">
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={disabled}
                  onChange={() => onToggle(place.key)}
                  className="mt-1 h-4 w-4 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <div className="truncate text-sm font-medium">{place.name}</div>
                    {place.rating != null && (
                      <span className="rounded-md bg-surface-tertiary px-1.5 py-0.5 text-[11px] text-content-muted">{place.rating.toFixed(1)}</span>
                    )}
                  </div>
                  {place.address && <div className="mt-1 line-clamp-2 text-xs leading-5 text-content-secondary">{place.address}</div>}
                  <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-content-faint">
                    {place.source && <span>{place.source}</span>}
                    {formatDiscoveryTypes(place.types) && <span>{formatDiscoveryTypes(place.types)}</span>}
                  </div>
                </div>
              </label>
            )
          })}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              disabled={disabled || searching || selectedCount === 0}
              onClick={onAsk}
              className="flex min-h-9 items-center justify-center gap-2 rounded-lg border border-edge-secondary bg-surface-card px-3 py-2 text-xs font-medium text-content transition-opacity disabled:opacity-50"
            >
              <MessageSquare size={14} />
              Ask about selected
            </button>
            <button
              type="button"
              disabled={disabled || searching || selectedCount === 0}
              onClick={onDraft}
              className="flex min-h-9 items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-accent-text transition-opacity disabled:opacity-50"
            >
              <Wand2 size={14} />
              Draft selected
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Sanitized markdown for AI chat replies. The model output is untrusted (trip
 * context can carry prompt injection), so: react-markdown v10 never parses raw
 * HTML, rehype-sanitize scrubs the tree, react-markdown's default urlTransform
 * drops javascript:/data: URLs, links are forced to noopener new tabs, and
 * images render as plain links so no remote fetch fires automatically.
 */
function AssistantMarkdown({ content }: { content: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      rehypePlugins={[rehypeSanitize]}
      components={{
        h1: ({ children }) => <div className="mb-1 mt-3 text-sm font-bold first:mt-0">{children}</div>,
        h2: ({ children }) => <div className="mb-1 mt-3 text-sm font-bold first:mt-0">{children}</div>,
        h3: ({ children }) => <div className="mb-1 mt-2.5 text-sm font-semibold first:mt-0">{children}</div>,
        h4: ({ children }) => <div className="mb-1 mt-2 text-sm font-semibold first:mt-0">{children}</div>,
        h5: ({ children }) => <div className="mb-1 mt-2 text-sm font-semibold first:mt-0">{children}</div>,
        h6: ({ children }) => <div className="mb-1 mt-2 text-sm font-semibold first:mt-0">{children}</div>,
        p: ({ children }) => <p className="my-1.5 leading-6 first:mt-0 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="my-1.5 list-disc space-y-1 pl-4">{children}</ul>,
        ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-1 pl-4">{children}</ol>,
        li: ({ children }) => <li className="leading-6">{children}</li>,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">
            {children}
          </a>
        ),
        img: ({ src, alt }) => (
          typeof src === 'string' && src
            ? <a href={src} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">{alt || 'image'}</a>
            : <span>{alt || ''}</span>
        ),
        code: ({ className, children }) => {
          const isBlock = (className ?? '').includes('language-')
          if (isBlock) return <code className={className}>{children}</code>
          return <code className="rounded bg-surface-tertiary px-1 py-0.5 font-mono text-[12px]">{children}</code>
        },
        pre: ({ children }) => (
          <pre className="my-2 overflow-x-auto rounded-lg border border-edge-secondary bg-surface-tertiary p-2.5 font-mono text-[12px] leading-relaxed">
            {children}
          </pre>
        ),
        blockquote: ({ children }) => (
          <blockquote className="my-2 border-l-2 border-edge pl-2.5 text-content-secondary">{children}</blockquote>
        ),
        table: ({ children }) => (
          <div className="my-2 overflow-x-auto">
            <table className="w-full border-collapse text-xs">{children}</table>
          </div>
        ),
        th: ({ children }) => <th className="border border-edge-secondary bg-surface-tertiary px-2 py-1 text-left font-semibold">{children}</th>,
        td: ({ children }) => <td className="border border-edge-secondary px-2 py-1">{children}</td>,
        hr: () => <hr className="my-3 border-edge-secondary" />,
      }}
    >
      {content}
    </Markdown>
  )
}

function PlanList({ title, items, icon }: { title: string; items: string[]; icon?: ReactNode }) {
  return (
    <div className="rounded-lg border border-edge-secondary bg-surface-card p-3">
      <div className="mb-1 flex items-center gap-1.5 font-medium text-content-secondary">
        {icon}
        <span>{title}</span>
      </div>
      <ul className="space-y-1">
        {items.slice(0, 5).map((item, index) => <li key={`${title}-${index}`}>{item}</li>)}
      </ul>
    </div>
  )
}

function ThinkingTrace({ collapsed, text, mode }: { collapsed: boolean; text: string; mode: ThinkingMode }) {
  const title = mode === 'planner' ? 'Thinking through safe changes' : 'Thinking through the trip'
  const display = text || 'Starting...'
  return (
    <div className={`overflow-hidden rounded-lg border border-edge-secondary bg-surface-card transition-all ${collapsed ? 'px-3 py-2' : 'p-3'}`}>
      <div className="flex items-center gap-2 text-xs font-medium text-content-secondary">
        <Sparkles size={13} className={collapsed ? '' : 'animate-pulse'} />
        <span>{collapsed ? 'Thinking complete' : title}</span>
      </div>
      {!collapsed && (
        <div className="mt-2 max-h-20 overflow-hidden rounded-md bg-surface px-3 py-2 font-mono text-xs leading-5 text-content-faint">
          {display}
          <span className="ml-0.5 inline-block h-3 w-1 translate-y-0.5 animate-pulse bg-content-faint" />
        </div>
      )}
    </div>
  )
}

function operationId(operation: AiActionOperation, index: number): string {
  return operation.id || `op_${index + 1}`
}

function operationTypeLabel(type: AiActionOperation['type']): string {
  return type.replace(/_/g, ' ')
}

interface OperationLabels {
  dayLabels: Map<string, string>
  placeLabels: Map<string, string>
  budgetLabels: Map<string, string>
  packingLabels: Map<string, string>
  reservationLabels: Map<string, string>
  assignmentLabels: Map<string, { placeName: string; dayLabel: string }>
}

function describeOperation(operation: AiActionOperation, labels: OperationLabels): string {
  const { dayLabels, placeLabels, budgetLabels, packingLabels, reservationLabels, assignmentLabels } = labels
  switch (operation.type) {
    case 'create_place':
      return `Create place "${operation.data.name}"${operation.assignToDayId ? ` and assign it to ${dayLabel(operation.assignToDayId, dayLabels)}` : ''}.`
    case 'update_place':
      return `Update ${placeLabel(operation.placeId, placeLabels)}${changedFields(operation.data)}.`
    case 'delete_place':
      return `Delete ${placeLabel(operation.placeId, placeLabels)} from the trip.`
    case 'assign_place_to_day':
      return `Assign ${placeLabel(operation.placeId || operation.placeOperationId, placeLabels)} to ${dayLabel(operation.dayId, dayLabels)}.`
    case 'unassign_place': {
      const info = assignmentLabels.get(String(operation.assignmentId))
      return info ? `Remove "${info.placeName}" from ${info.dayLabel} (the place stays saved).` : 'Remove an activity from its day (the place stays saved).'
    }
    case 'move_assignment': {
      const info = assignmentLabels.get(String(operation.assignmentId))
      return `Move ${info ? `"${info.placeName}" from ${info.dayLabel}` : 'an activity'} to ${dayLabel(operation.toDayId, dayLabels)}.`
    }
    case 'set_assignment_time': {
      const info = assignmentLabels.get(String(operation.assignmentId))
      const range = [operation.time, operation.endTime].filter(Boolean).join(' - ')
      return `Set the time of ${info ? `"${info.placeName}" on ${info.dayLabel}` : 'an activity'}${range ? ` to ${range}` : ''}.`
    }
    case 'reorder_itinerary':
      return `Reorder ${operation.orderedIds.length} itinerary item${operation.orderedIds.length === 1 ? '' : 's'} on ${dayLabel(operation.dayId, dayLabels)}.`
    case 'add_day_note':
      return `Add day note to ${dayLabel(operation.dayId, dayLabels)}: ${operation.data.text}`
    case 'update_day_note':
      return `Update a note on ${dayLabel(operation.dayId, dayLabels)}${operation.data.text ? `: ${operation.data.text}` : ''}.`
    case 'delete_day_note':
      return `Delete a note on ${dayLabel(operation.dayId, dayLabels)}.`
    case 'update_day':
      return `Update ${dayLabel(operation.dayId, dayLabels)}${changedFields(operation.data)}.`
    case 'create_budget_item':
      return `Create budget item "${operation.data.name}".`
    case 'update_budget_item':
      return `Update budget item ${itemLabel(operation.itemId, budgetLabels)}${changedFields(operation.data)}.`
    case 'delete_budget_item':
      return `Delete budget item ${itemLabel(operation.itemId, budgetLabels)}.`
    case 'create_packing_item':
      return `Create packing item "${operation.data.name}".`
    case 'update_packing_item':
      return `Update packing item ${itemLabel(operation.itemId, packingLabels)}${changedFields(operation.data)}.`
    case 'delete_packing_item':
      return `Delete packing item ${itemLabel(operation.itemId, packingLabels)}.`
    case 'create_poll':
      return `Create poll "${operation.data.question}".`
    case 'import_reservation':
      return `Create reservation "${operation.data.title}".`
    case 'update_reservation':
      return `Update reservation ${itemLabel(operation.reservationId, reservationLabels)}${operation.data.title ? ` to "${operation.data.title}"` : ''}.`
    case 'delete_reservation':
      return `Delete reservation ${itemLabel(operation.reservationId, reservationLabels)}.`
    default:
      return 'Apply a TREK change.'
  }
}

function itemLabel(id: string | number, labels: Map<string, string>): string {
  const label = labels.get(String(id))
  return label ? `"${label}"` : `#${id}`
}

function changedFields(data: Record<string, unknown> | undefined): string {
  const keys = Object.keys(data || {}).filter(key => (data as Record<string, unknown>)[key] !== undefined)
  return keys.length ? ` (${keys.map(key => key.replace(/_/g, ' ')).join(', ')})` : ''
}

function areaBiasStorageKey(tripId: number): string {
  return `trek.ai.discoverArea.${tripId}`
}

function loadAreaBias(tripId: number): AreaBias | null {
  try {
    const raw = localStorage.getItem(areaBiasStorageKey(tripId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AreaBias>
    if (typeof parsed.lat !== 'number' || typeof parsed.lng !== 'number' || typeof parsed.label !== 'string') return null
    if (!coord(parsed.lat, parsed.lng)) return null
    return { lat: parsed.lat, lng: parsed.lng, radius: typeof parsed.radius === 'number' ? parsed.radius : 150_000, label: parsed.label }
  } catch {
    return null
  }
}

function saveAreaBias(tripId: number, bias: AreaBias | null): void {
  try {
    if (bias) localStorage.setItem(areaBiasStorageKey(tripId), JSON.stringify(bias))
    else localStorage.removeItem(areaBiasStorageKey(tripId))
  } catch {
    // Persistence is a convenience; private-mode storage failures are fine.
  }
}

function inferTripAreaLabel(trip: Trip): string | null {
  const candidates = [trip.title, trip.description]
    .map(value => cleanTripAreaCandidate(value))
    .filter((value): value is string => Boolean(value))
  return candidates[0] ?? null
}

function cleanTripAreaCandidate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const firstSentence = value.split(/[.!?\n]/)[0] ?? ''
  const cleaned = firstSentence
    .replace(/^(?:trip|vacation|holiday|itinerary|travel(?:\s+plan)?|adventure)\s+(?:to|for|in)\s+/i, '')
    .replace(/\b(?:trip|vacation|holiday|itinerary|travel(?:\s+plan)?|planner)\b/gi, ' ')
    .replace(/\b20\d{2}\b/g, ' ')
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned || cleaned.length < 3 || isWeakAreaCandidate(cleaned)) return null
  return cleaned.slice(0, 120)
}

function isWeakAreaCandidate(value: string): boolean {
  const normalized = value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!normalized) return true
  const weak = new Set([
    'my',
    'our',
    'family',
    'friends',
    'summer',
    'winter',
    'spring',
    'fall',
    'autumn',
    'birthday',
    'anniversary',
    'honeymoon',
    'weekend',
    'road',
    'road trip',
    'draft',
    'test',
    'new',
    'untitled',
  ])
  return weak.has(normalized)
}

function scopeDiscoveryQuery(query: string, areaLabel: string): string {
  const lowerQuery = query.toLowerCase()
  const areaTokens = areaLabel
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(token => token.length > 2)
  if (areaTokens.some(token => lowerQuery.includes(token))) return query
  return `${query} in ${areaLabel}`
}

function isoDateLocal(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDayLabel(day: Day, index: number): string {
  const label = `Day ${day.day_number ?? index + 1}`
  const details = [day.title, day.date].filter(Boolean)
  return details.length ? `${label} - ${details.join(' - ')}` : label
}

function dayLabel(dayId: string | number, dayLabels: Map<string, string>): string {
  return dayLabels.get(String(dayId)) || `day ${dayId}`
}

function placeLabel(placeId: string | number | undefined, placeLabels: Map<string, string>): string {
  if (placeId == null) return 'the selected place'
  const label = placeLabels.get(String(placeId))
  return label ? `"${label}"` : `place ${placeId}`
}

function riskClass(risk: AiActionPlan['riskLevel']): string {
  if (risk === 'high') return 'bg-rose-100 text-rose-700'
  if (risk === 'medium') return 'bg-amber-100 text-amber-700'
  return 'bg-emerald-100 text-emerald-700'
}

function formatUsage(usage: AiUsage): string {
  const parts: string[] = []
  if (usage.total_tokens != null) parts.push(`${usage.total_tokens} tokens`)
  if (usage.reasoning_tokens != null) parts.push(`${usage.reasoning_tokens} reasoning`)
  if (usage.cost != null) parts.push(`$${usage.cost.toFixed(4)}`)
  return parts.length ? parts.join(' · ') : usage.model || 'usage unavailable'
}

function randomId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)
}

function normalizeDiscoveryPlace(raw: Record<string, unknown>, index: number): DiscoveryPlace | null {
  const name = stringValue(raw.name, 200)
  if (!name) return null
  const lat = numberValue(raw.lat, -90, 90)
  const lng = numberValue(raw.lng, -180, 180)
  const googlePlaceId = stringValue(raw.google_place_id, 200)
  const googleFtid = stringValue(raw.google_ftid, 200)
  const osmId = stringValue(raw.osm_id, 200)
  // Index suffix keeps keys unique even when two results share a name and lack
  // provider ids; selection resets on every search, so index-based keys are stable.
  const key = `${[googlePlaceId, googleFtid, osmId, name].filter(value => value != null && value !== '').join(':') || 'discovery'}#${index}`
  return {
    key,
    name,
    address: stringValue(raw.address, 500) ?? null,
    lat: lat ?? null,
    lng: lng ?? null,
    rating: numberValue(raw.rating, 0, 5) ?? null,
    website: stringValue(raw.website, 500) ?? null,
    phone: stringValue(raw.phone, 80) ?? null,
    google_place_id: googlePlaceId,
    google_ftid: googleFtid,
    osm_id: osmId,
    source: stringValue(raw.source, 40),
    types: Array.isArray(raw.types) ? raw.types.map(value => stringValue(value, 60)).filter((value): value is string => Boolean(value)).slice(0, 12) : [],
  }
}

function toAiDiscoveredPlace(place: DiscoveryPlace): AiDiscoveredPlace {
  const { key: _key, ...rest } = place
  return rest
}

function stringValue(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  // Keep the result within max even with the ellipsis — these values are
  // validated against zod max-length limits when sent to the server.
  return trimmed.length > max ? `${trimmed.slice(0, Math.max(1, max - 3))}...` : trimmed
}

function numberValue(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return undefined
  return value
}

function formatDiscoveryTypes(types: string[] | undefined): string {
  return (types || []).slice(0, 3).map(type => type.replace(/_/g, ' ')).join(' · ')
}

function computeLocationBias(selectedDay: Day | null, places: Place[], reservations: Reservation[]): LocationBias | undefined {
  const selectedCoords = (selectedDay?.assignments || [])
    .map(assignment => coord(assignment.place?.lat, assignment.place?.lng))
    .filter((item): item is { lat: number; lng: number } => Boolean(item))
  const placeCoords = places
    .map(place => coord(place.lat, place.lng))
    .filter((item): item is { lat: number; lng: number } => Boolean(item))
  const reservationCoords = reservations
    .flatMap(reservation => reservation.endpoints || [])
    .map(endpoint => coord(endpoint.lat, endpoint.lng))
    .filter((item): item is { lat: number; lng: number } => Boolean(item))
  const coords = selectedCoords.length ? selectedCoords : placeCoords.length ? placeCoords : reservationCoords
  if (!coords.length) return undefined
  const lat = coords.reduce((sum, item) => sum + item.lat, 0) / coords.length
  const lng = coords.reduce((sum, item) => sum + item.lng, 0) / coords.length
  return { lat, lng, radius: 75000 }
}

function coord(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { lat, lng }
}
