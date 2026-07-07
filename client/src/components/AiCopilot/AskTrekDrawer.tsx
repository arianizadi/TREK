import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AiActionOperation, AiActionPlan, AiActionUndoPlan, AiUsage } from '@trek/shared'
import { AlertTriangle, Bot, Check, Loader2, MessageSquare, RotateCcw, Send, Sparkles, Trash2, Wand2, X } from 'lucide-react'
import { aiApi } from '../../api/client'
import type { BudgetItem, Day, PackingItem, Place, Reservation, Trip } from '../../types'
import { getApiErrorMessage } from '../../types'
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
  { label: 'Check if this is possible', prompt: 'Check if this itinerary is feasible. Look for date conflicts, day density, travel gaps, reservations, weather exposure, and budget pressure.' },
  { label: 'What can go wrong?', prompt: 'Give me a risk radar for this trip with severity, likelihood, and concrete mitigations.' },
  { label: 'Give me alternate plans', prompt: 'Give me three alternate plans with tradeoffs: cheaper, calmer, and maximum sightseeing.' },
  { label: 'Budget sanity check', prompt: 'Check the budget for missing costs, expensive days, currency issues, and practical swaps.' },
  { label: 'Travel chaos mode', prompt: 'Assume something changes during travel. Show what to preserve, what to replan, and who needs updates.' },
]

const PLANNER_ACTIONS: Array<{ label: string; prompt: string }> = [
  { label: 'Fix this day', prompt: 'Draft safe changes that make the selected day more realistic. Keep reservations intact.' },
  { label: 'Make this cheaper', prompt: 'Draft safe trip changes that reduce cost without deleting existing reservations.' },
  { label: 'Make this more relaxed', prompt: 'Draft safe changes that reduce day density and add breathing room.' },
  { label: 'Rainy-day backup', prompt: 'Draft a rainy-day backup using indoor options and notes. Do not replace confirmed reservations.' },
  { label: 'Packing from itinerary', prompt: 'Draft packing list items based on the itinerary, reservations, likely weather exposure, and activities.' },
]

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
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<LocalMessage[]>([])
  const [status, setStatus] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [thinkingMode, setThinkingMode] = useState<ThinkingMode | null>(null)
  const [thinkingText, setThinkingText] = useState('')
  const [thinkingCollapsed, setThinkingCollapsed] = useState(false)
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
  const context = useMemo(() => ({ selectedDayId, activeTab }), [selectedDayId, activeTab])
  const chips = useMemo(() => [
    `Trip: ${trip.title}`,
    `Dates: ${trip.start_date || '?'} to ${trip.end_date || '?'}`,
    `Budget: ${budgetItems.length} item${budgetItems.length === 1 ? '' : 's'}`,
    `Reservations: ${reservations.length}`,
    'Weather: not attached',
    `Packing: ${packingItems.length} item${packingItems.length === 1 ? '' : 's'}`,
    selectedDay ? `Selected day: ${selectedDay.title || `Day ${selectedDay.day_number ?? selectedDay.id}`}` : 'Selected day: none',
  ], [budgetItems.length, packingItems.length, reservations.length, selectedDay, trip.end_date, trip.start_date, trip.title])

  useEffect(() => {
    if (!isOpen) abortRef.current?.abort()
  }, [isOpen])

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
        { tripId, context, messages: [...history, { role: 'user', content: prompt }] },
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
    const nonce = clearNonceRef.current
    setPreviewing(true)
    setThinkingMode('planner')
    setThinkingCollapsed(false)
    setPlan(null)
    try {
      const res = await aiApi.preview({ tripId, prompt, context })
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
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
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
                {message.content || (message.role === 'assistant' && streaming ? <span className="text-content-faint">Answer will stream here...</span> : '')}
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
                            <div className="mt-1 text-xs leading-5 text-content-secondary">{operation.description || describeOperation(operation, dayLabels, placeLabels)}</div>
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

function describeOperation(operation: AiActionOperation, dayLabels: Map<string, string>, placeLabels: Map<string, string>): string {
  switch (operation.type) {
    case 'create_place':
      return `Create place "${operation.data.name}"${operation.assignToDayId ? ` and assign it to ${dayLabel(operation.assignToDayId, dayLabels)}` : ''}.`
    case 'assign_place_to_day':
      return `Assign ${placeLabel(operation.placeId || operation.placeOperationId, placeLabels)} to ${dayLabel(operation.dayId, dayLabels)}.`
    case 'reorder_itinerary':
      return `Reorder ${operation.orderedIds.length} itinerary item${operation.orderedIds.length === 1 ? '' : 's'} on ${dayLabel(operation.dayId, dayLabels)}.`
    case 'add_day_note':
      return `Add day note to ${dayLabel(operation.dayId, dayLabels)}: ${operation.data.text}`
    case 'create_budget_item':
      return `Create budget item "${operation.data.name}".`
    case 'create_packing_item':
      return `Create packing item "${operation.data.name}".`
    case 'create_poll':
      return `Create poll "${operation.data.question}".`
    case 'import_reservation':
      return `Create reservation "${operation.data.title}".`
    default:
      return 'Apply a TREK change.'
  }
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
