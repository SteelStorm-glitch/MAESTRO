import crypto from 'node:crypto'
import type { ApprovalRequest, ChatMessage, MessageKind, Project, Role, Session, Task, Usage } from '@maestro/shared'
import { bus } from '../events/bus'
import { getOrchestra } from '../db/repo/orchestras'
import { getProject } from '../db/repo/projects'
import { getRole, listRoles } from '../db/repo/roles'
import { getSession, addSessionUsage, updateSession } from '../db/repo/sessions'
import { createMessage, listMessages } from '../db/repo/messages'
import { createTask, listTasks, setTaskDependencies, updateTask } from '../db/repo/tasks'
import { resolveModel, estimateCost, type ResolvedModel } from '../providers/registry'
import { logger } from '../lib/logger'
import { estimateTokens, truncateToTokens } from '../lib/tokens'
import { ContextManager } from './context'
import { teamRoster } from './prompts'
import { runAgent, RunAbortedError, BudgetExceededError, type AgentRuntime } from './executor'
import { requestPlan, requestRefine, requestReview, type PlanTask, type Verdict } from './conductor'

const MAX_PARALLEL = 4
const MAX_FIX_CYCLES = 3

export class OrchestraRun implements AgentRuntime {
  readonly sessionId: string
  readonly session: Session
  readonly project: Project
  readonly orchestra: NonNullable<ReturnType<typeof getOrchestra>>
  readonly root: string
  readonly context: ContextManager
  readonly roster: string
  readonly signal: AbortSignal

  private readonly controller = new AbortController()
  private roles: Map<string, Role>
  private models = new Map<string, ResolvedModel>()
  private modelErrors = new Map<string, string>()
  private paused = false
  private resumeWaiters: Array<() => void> = []
  private pendingApprovals = new Map<string, (allowed: boolean) => void>()
  private agentChanges = new Map<string, 'created' | 'modified' | 'deleted' | 'moved'>()
  private queue: Array<{ text: string; toRoleId: string | null; deliveredTo: Set<string> }> = []
  private approvalRequests = new Map<string, ApprovalRequest>()
  private tokensIn = 0
  private tokensOut = 0
  private cost = 0
  private finished = false
  private finishedResolve!: () => void
  readonly finishedPromise = new Promise<void>((resolve) => {
    this.finishedResolve = resolve
  })
  private userInput = ''

  constructor(sessionId: string) {
    const session = getSession(sessionId)
    if (!session) throw new Error('Сессия не найдена')
    const project = getProject(session.project_id)
    if (!project) throw new Error('Проект не найден')
    const orchestra = getOrchestra(session.orchestra_id)
    if (!orchestra) throw new Error('Оркестр не найден')

    this.sessionId = sessionId
    this.session = session
    this.project = project
    this.orchestra = orchestra
    this.root = project.root_path
    this.context = new ContextManager(project.root_path)
    this.signal = this.controller.signal
    this.tokensIn = session.tokens_in
    this.tokensOut = session.tokens_out
    this.cost = session.cost

    const allRoles = listRoles()
    const memberIds = new Set(orchestra.members.map((m) => m.role_id))
    this.roles = new Map(allRoles.filter((role) => memberIds.has(role.id)).map((role) => [role.id, role]))
    this.roster = teamRoster([...this.roles.values()])

    for (const role of this.roles.values()) {
      if (!role.model_id) {
        this.modelErrors.set(role.id, `У роли «${role.name}» не выбрана модель`)
        continue
      }
      try {
        this.models.set(role.id, resolveModel(role.model_id))
      } catch (error) {
        this.modelErrors.set(role.id, error instanceof Error ? error.message : String(error))
      }
    }
  }

  get abortSignal(): AbortSignal {
    return this.signal
  }

  get isFinished(): boolean {
    return this.finished
  }

  // ────────────────────────────── public control ──────────────────────────────

  async start(input: string): Promise<void> {
    this.userInput = input
    const trimmedTitle = input.replace(/\s+/g, ' ').trim().slice(0, 70)
    if (this.session.title === 'Новый запуск' && trimmedTitle) {
      updateSession(this.sessionId, { title: trimmedTitle })
    }

    const userMessage = createMessage({
      session_id: this.sessionId,
      kind: 'user',
      content: input,
      tokens_in: estimateTokens(input),
    })
    bus.emit(this.sessionId, 'agent.message', {
      message_id: userMessage.id,
      role_id: null,
      kind: 'user',
      content: input,
      tokens_in: userMessage.tokens_in,
    })

    this.setStatus('running')
    bus.emit(this.sessionId, 'run.start', {
      session_id: this.sessionId,
      project_id: this.project.id,
      orchestra_id: this.orchestra.id,
      strategy: this.orchestra.strategy,
    })
    logger.info(`Run started ${this.sessionId}`, { strategy: this.orchestra.strategy })

    let finalText = ''
    try {
      if (this.orchestra.strategy === 'pipeline') {
        finalText = await this.runPipeline(input)
      } else if (this.orchestra.strategy === 'council') {
        finalText = await this.runCouncil(input)
      } else {
        finalText = await this.runConductor(input)
      }
      this.finish('done', finalText)
    } catch (error) {
      if (error instanceof RunAbortedError || this.signal.aborted) {
        this.finish('cancelled', 'Запуск отменён пользователем.')
      } else if (error instanceof BudgetExceededError) {
        this.finish('done', `Остановлено: ${error.message}. Потрачено ≈${this.tokensIn + this.tokensOut} токенов.`)
      } else {
        const message = error instanceof Error ? error.message : String(error)
        logger.error(`Run failed ${this.sessionId}`, { message })
        bus.emit(this.sessionId, 'error', {
          code: (error as Error & { code?: string }).code ?? 'run_failed',
          message,
        })
        this.finish('error', `Ошибка выполнения: ${message}`)
      }
    } finally {
      this.registryCleanup()
      this.finishedResolve()
    }
  }

  cancel(): void {
    this.controller.abort()
    for (const [, resolve] of this.pendingApprovals) resolve(false)
    this.pendingApprovals.clear()
    this.approvalRequests.clear()
    this.wakeResume()
  }

  async stop(): Promise<void> {
    this.cancel()
    await this.finishedPromise
  }

  pause(): void {
    if (this.finished || this.paused) return
    this.paused = true
    this.setStatus('paused')
    bus.emit(this.sessionId, 'warn', { code: 'paused', message: 'Запуск приостановлен' })
  }

  resume(): void {
    if (!this.paused) return
    this.paused = false
    this.setStatus('running')
    this.wakeResume()
  }

  approve(approvalId: string, allow: boolean): boolean {
    const resolve = this.pendingApprovals.get(approvalId)
    if (!resolve) return false
    this.pendingApprovals.delete(approvalId)
    this.approvalRequests.delete(approvalId)
    bus.emit(this.sessionId, 'approval.resolved', { approval_id: approvalId, allowed: allow })
    resolve(allow)
    return true
  }

  /** Approvals still waiting for the user (survives a page reload for this run). */
  pendingApprovalList(): ApprovalRequest[] {
    return [...this.approvalRequests.values()]
  }

  enqueue(text: string, toRoleId: string | null): void {
    this.queue.push({ text, toRoleId, deliveredTo: new Set() })
  }

  // ─────────────────────────────── AgentRuntime ──────────────────────────────

  async checkpoint(): Promise<void> {
    if (this.signal.aborted) throw new RunAbortedError()
    if (this.paused) {
      await new Promise<void>((resolve) => this.resumeWaiters.push(resolve))
      if (this.signal.aborted) throw new RunAbortedError()
    }
  }

  assertBudget(): void {
    const spent = this.tokensIn + this.tokensOut
    if (spent >= this.orchestra.budget_tokens) {
      throw new BudgetExceededError(
        `Исчерпан лимит токенов оркестра (${this.orchestra.budget_tokens.toLocaleString('ru-RU')})`,
      )
    }
  }

  addUsage(role: Role, model: ResolvedModel, usage: Usage, _messageId: string | null): void {
    this.tokensIn += usage.input_tokens
    this.tokensOut += usage.output_tokens
    const cost = estimateCost(model.modelId, usage.input_tokens, usage.output_tokens)
    this.cost += cost
    const session = addSessionUsage(this.sessionId, usage.input_tokens, usage.output_tokens, cost)
    bus.emitTransient(this.sessionId, 'usage', {
      role_id: role.id,
      role_name: role.name,
      tokens_in: usage.input_tokens,
      tokens_out: usage.output_tokens,
      total_in: this.tokensIn,
      total_out: this.tokensOut,
      cost,
    })
    if (session) bus.sessionState(session)
  }

  setAgentStatus(role: Role, status: 'idle' | 'thinking' | 'tool' | 'done' | 'error', detail?: string): void {
    bus.emitTransient(this.sessionId, 'agent.status', {
      session_id: this.sessionId,
      role_id: role.id,
      status,
      detail,
    })
  }

  async requestApproval(role: Role, tool: string, args: Record<string, unknown>): Promise<boolean> {
    if (this.orchestra.approval_mode === 'deny') {
      bus.emit(this.sessionId, 'warn', {
        code: 'approval_denied',
        message: `Оркестр запрещает выполнение ${tool} (approval_mode=deny)`,
        role_id: role.id,
        role_name: role.name,
      })
      return false
    }
    const needsPrompt = role.shell_mode === 'confirm' || this.orchestra.approval_mode === 'confirm'
    if (!needsPrompt) return true

    const approvalId = crypto.randomUUID()
    const request = {
      id: approvalId,
      session_id: this.sessionId,
      role_id: role.id,
      role_name: role.name,
      tool,
      args,
      created_at: Date.now(),
    }
    this.approvalRequests.set(approvalId, request)
    bus.emit(this.sessionId, 'approval.request', { request })
    return new Promise<boolean>((resolve) => {
      this.pendingApprovals.set(approvalId, resolve)
    })
  }

  onFileTouched(path: string, kind: 'created' | 'modified' | 'deleted' | 'moved'): void {
    const previous = this.agentChanges.get(path)
    if (previous === 'created' && kind === 'modified') return
    this.agentChanges.set(path, kind)
    this.context.noteFile(path, { created: 'создан', modified: 'изменён', deleted: 'удалён', moved: 'перемещён' }[kind])
  }

  cheapestModel(): ResolvedModel | null {
    const models = [...this.models.values()]
    if (models.length === 0) return null
    return models.reduce((cheapest, candidate) => {
      const a = estimateCost(cheapest.modelId, 1_000_000, 0)
      const b = estimateCost(candidate.modelId, 1_000_000, 0)
      return b < a ? candidate : cheapest
    })
  }

  // ─────────────────────────────── strategies ────────────────────────────────

  private async runConductor(input: string): Promise<string> {
    const conductorRole = this.conductorRole()
    const conductorModel = this.requireModel(conductorRole)
    const projectBrief = this.context.projectBrief()
    const history = this.priorHistory()
    let outcomesCarry = ''
    let lastOutcomes = ''
    let finalText = ''

    for (let round = 1; round <= this.orchestra.max_rounds; round++) {
      await this.checkpoint()
      this.assertBudget()

      const plan = await this.phase(conductorRole, 'plan', null, () =>
        requestPlan(this, conductorRole, conductorModel, `${input}${this.queuedContext(conductorRole.id)}`, projectBrief, outcomesCarry, history),
      )
      if (plan.tasks.length === 0) {
        finalText =
          'Дирижёр решил, что дополнительные действия не требуются. Результаты предыдущих раундов приведены выше.'
        return finalText
      }

      const createdTasks = this.savePlan(plan.tasks, round)
      await this.executeRound(createdTasks)
      if (this.signal.aborted) throw new RunAbortedError()

      lastOutcomes = this.buildOutcomes()
      let verdict = await this.review(conductorRole, input, lastOutcomes)
      let fixCycles = 0
      while (verdict && verdict.verdict === 'issues' && this.orchestra.fixer_role_id && fixCycles < MAX_FIX_CYCLES) {
        fixCycles++
        await this.runFixer(input, verdict, fixCycles)
        lastOutcomes = this.buildOutcomes()
        verdict = await this.review(conductorRole, input, lastOutcomes)
      }
      if (verdict && verdict.verdict === 'issues') {
        lastOutcomes += `\n\n⚠ Замечания аудитора остались после ${fixCycles} циклов исправлений:\n${verdict.issues
          .map((issue) => `- ${issue.title}${issue.file ? ` (${issue.file})` : ''}`)
          .join('\n')}`
      }

      const refine = await this.phase(conductorRole, 'refine', null, () =>
        requestRefine(
          this,
          conductorRole,
          conductorModel,
          `${input}${this.queuedContext(conductorRole.id)}`,
          lastOutcomes,
          round,
          this.orchestra.max_rounds,
          projectBrief,
        ),
      )

      if (refine.type === 'final') {
        finalText = refine.text
        return finalText
      }

      outcomesCarry = lastOutcomes
      if (round === this.orchestra.max_rounds) {
        return `Достигнут лимит раундов (${this.orchestra.max_rounds}).\n\n${lastOutcomes}`
      }
    }

    return finalText || lastOutcomes
  }

  private async runPipeline(input: string): Promise<string> {
    const members = this.membersInOrder()
    if (members.length === 0) throw new Error('В оркестре нет участников')
    let current = input
    for (const role of members) {
      await this.checkpoint()
      this.assertBudget()
      const model = this.requireModel(role)
      const prompt = `Задача:\n${current}\n\n${this.context.projectBrief()}${this.queuedContext(role.id)}\n\nВыполни свою часть и передай результат дальше.`
      const result = await this.phase(role, 'pipeline', null, () =>
        runAgent({
          runtime: this,
          role,
          model,
          phase: 'pipeline',
          kind: 'result',
          userPrompt: prompt,
          maxSteps: 16,
        }),
      )
      current = result.text
    }
    return current
  }

  private async runCouncil(input: string): Promise<string> {
    const members = this.membersInOrder()
    if (members.length === 0) throw new Error('В оркестре нет участников')
    const answers = await Promise.all(
      members.slice(0, MAX_PARALLEL).map(async (role) => {
        await this.checkpoint()
        const model = this.requireModel(role)
        const result = await this.phase(role, 'council', null, () =>
          runAgent({
            runtime: this,
            role,
            model,
            phase: 'council',
            kind: 'result',
            userPrompt: `Ответь на задачу самостоятельно и по существу:\n${input}\n\n${this.context.projectBrief()}${this.queuedContext(role.id)}`,
            maxSteps: 12,
          }),
        )
        return { role, text: result.text }
      }),
    )

    const conductor = this.orchestra.conductor_role_id ? this.roles.get(this.orchestra.conductor_role_id) : null
    if (!conductor) return answers[0]!.text
    const model = this.requireModel(conductor)
    const combined = answers
      .map((answer) => `### ${answer.role.name}\n${truncateToTokens(answer.text, 2500)}`)
      .join('\n\n')
    const result = await this.phase(conductor, 'synthesis', null, () =>
      runAgent({
        runtime: this,
        role: conductor,
        model,
        phase: 'synthesis',
        kind: 'final',
        userPrompt: `Вопрос пользователя:\n${input}\n\nОтветы участников:\n${combined}${this.queuedContext(conductor.id)}\n\nСинтезируй лучший финальный ответ. Кратко, по делу, на русском.`,
        maxSteps: 4,
      }),
    )
    return result.text
  }

  // ─────────────────────────────── round / tasks ─────────────────────────────

  private savePlan(planTasks: PlanTask[], round: number): Task[] {
    const idMap = new Map<string, string>()
    const created: Task[] = []
    for (const planTask of planTasks) {
      const role = this.matchRole(planTask.assignee)
      if (!role) {
        bus.emit(this.sessionId, 'warn', {
          code: 'unknown_assignee',
          message: `Неизвестный исполнитель «${planTask.assignee ?? '—'}» — задача назначена первому участнику`,
        })
      }
      const task = createTask({
        session_id: this.sessionId,
        assigned_role_id: role?.id ?? this.fallbackExecutor()?.id ?? null,
        title: planTask.title,
        payload: `[раунд ${round}] ${planTask.description}`,
        depends_on: [],
      })
      idMap.set(planTask.id, task.id)
      created.push(task)
    }
    for (let i = 0; i < created.length; i++) {
      const planTask = planTasks[i]!
      const deps = planTask.depends_on.map((ref) => idMap.get(ref)).filter((id): id is string => Boolean(id))
      if (deps.length > 0) setTaskDependencies(created[i]!.id, deps)
    }
    const fresh = listTasks(this.sessionId).filter((task) => created.some((c) => c.id === task.id))
    bus.emit(this.sessionId, 'plan.created', {
      round,
      tasks: fresh.map((task) => ({
        id: task.id,
        title: task.title,
        assignee: this.roleName(task.assigned_role_id),
      })),
    })
    bus.tasks(this.sessionId, listTasks(this.sessionId))
    for (const task of fresh) {
      bus.emit(this.sessionId, 'task.created', {
        task_id: task.id,
        title: task.title,
        status: task.status,
        role_id: task.assigned_role_id,
        role_name: this.roleName(task.assigned_role_id),
      })
    }
    return fresh
  }

  private async executeRound(roundTasks: Task[]): Promise<void> {
    const statuses = new Map(listTasks(this.sessionId).map((task) => [task.id, task.status]))
    const pending = new Map(roundTasks.map((task) => [task.id, task]))
    const active = new Map<string, Promise<void>>()

    for (;;) {
      try {
        if (this.signal.aborted) throw new RunAbortedError()
        await this.checkpoint()

        for (const [id, task] of [...pending.entries()]) {
          const deps = task.depends_on
          if (deps.some((dep) => statuses.get(dep) === 'failed' || statuses.get(dep) === 'skipped')) {
            statuses.set(id, 'skipped')
            pending.delete(id)
            this.setTaskStatus(id, 'skipped', 'Пропущено: зависимость не выполнена')
          }
        }

        const ready = [...pending.values()].filter((task) =>
          task.depends_on.every((dep) => !statuses.has(dep) || statuses.get(dep) === 'done'),
        )
        while (ready.length > 0 && active.size < MAX_PARALLEL) {
          const task = ready.shift()!
          pending.delete(task.id)
          statuses.set(task.id, 'running')
          const promise = this.runTask(task)
            .then((status) => {
              statuses.set(task.id, status)
            })
            .finally(() => {
              active.delete(task.id)
            })
          active.set(task.id, promise)
        }

        if (active.size === 0) {
          for (const task of pending.values()) {
            statuses.set(task.id, 'skipped')
            this.setTaskStatus(task.id, 'skipped', 'Пропущено: зависимости не разрешены')
          }
          break
        }
        await Promise.race([...active.values()])
      } catch (error) {
        await this.settleInterruptedRound(active, pending, statuses)
        throw error
      }
    }
    bus.tasks(this.sessionId, listTasks(this.sessionId))
  }

  private async settleInterruptedRound(active: Map<string, Promise<void>>, pending: Map<string, Task>, statuses: Map<string, Task['status']>): Promise<void> {
    // `.finally()` inside each promise removes it from `active`, so snapshot ids first.
    const runningIds = [...active.keys()]
    await Promise.allSettled([...active.values()])
    for (const id of runningIds) {
      if (statuses.get(id) === 'running') this.setTaskStatus(id, 'skipped', 'Прервано вместе с запуском')
    }
    for (const task of pending.values()) {
      if (statuses.get(task.id) !== 'done' && statuses.get(task.id) !== 'failed') {
        this.setTaskStatus(task.id, 'skipped', 'Прервано вместе с запуском')
      }
    }
    bus.tasks(this.sessionId, listTasks(this.sessionId))
  }

  private async runTask(task: Task): Promise<'done' | 'failed'> {
    const role = task.assigned_role_id ? this.roles.get(task.assigned_role_id) : null
    if (!role) {
      this.setTaskStatus(task.id, 'failed', 'Не назначен исполнитель')
      return 'failed'
    }
    let model: ResolvedModel
    try {
      model = this.requireModel(role)
    } catch (error) {
      this.setTaskStatus(task.id, 'failed', error instanceof Error ? error.message : String(error))
      return 'failed'
    }

    this.setTaskStatus(task.id, 'running', null)
    const dependencies = task.depends_on
      .map((depId) => {
        const dep = this.taskById(depId)
        return dep ? `Результат задачи «${dep.title}»:\n${truncateToTokens(dep.result ?? '(нет результата)', 2500)}` : ''
      })
      .filter(Boolean)
      .join('\n\n')

    const queued = this.queuedContext(role.id)
    const prompt = [
      `Твоя задача: ${task.title}`,
      task.payload,
      dependencies ? `\nКонтекст зависимых задач:\n${dependencies}` : '',
      `\n${truncateToTokens(this.context.projectBrief(), 4000)}`,
      queued,
      '\nВыполни задачу с помощью инструментов. В конце дай краткий отчёт о результате.',
    ]
      .filter(Boolean)
      .join('\n')

    try {
      const result = await this.phase(role, 'execute', task.id, () =>
        runAgent({
          runtime: this,
          role,
          model,
          taskId: task.id,
          phase: 'execute',
          kind: 'task',
          userPrompt: prompt,
          maxSteps: 18,
        }),
      )
      const summary = result.text.trim() || (result.stoppedBy ? `Остановлено: ${result.stoppedBy}` : '(пустой ответ)')
      this.setTaskStatus(task.id, 'done', summary)
      bus.emit(this.sessionId, 'task.done', {
        task_id: task.id,
        title: task.title,
        status: 'done',
        role_id: role.id,
        role_name: role.name,
        result: truncateToTokens(summary, 500),
      })
      return 'done'
    } catch (error) {
      if (error instanceof RunAbortedError || error instanceof BudgetExceededError) throw error
      const message = error instanceof Error ? error.message : String(error)
      this.setTaskStatus(task.id, 'failed', `Ошибка: ${message}`)
      bus.emit(this.sessionId, 'error', {
        code: 'task_failed',
        message: `Задача «${task.title}»: ${message}`,
        role_id: role.id,
        role_name: role.name,
      })
      return 'failed'
    }
  }

  private async runFixer(input: string, verdict: Verdict, cycle: number): Promise<void> {
    const fixer = this.orchestra.fixer_role_id ? this.roles.get(this.orchestra.fixer_role_id) : null
    if (!fixer) return
    const model = this.requireModel(fixer)
    const issues = verdict.issues
      .map((issue, index) => `${index + 1}. ${issue.title}${issue.file ? ` [${issue.file}]` : ''}\n   ${issue.description ?? ''}`)
      .join('\n')
    await this.phase(fixer, 'fix', null, () =>
      runAgent({
        runtime: this,
        role: fixer,
        model,
        phase: 'fix',
        kind: 'result',
        userPrompt: `Исходная задача:\n${input}\n\nЗамечания аудитора (цикл ${cycle}):\n${issues}\n\nИсправь проблемы.\n\n${this.context.projectBrief()}`,
        maxSteps: 20,
      }),
    )
  }

  private async review(
    conductorRole: Role,
    input: string,
    outcomes: string,
  ): Promise<Verdict | null> {
    if (!this.orchestra.verifier_role_id) return null
    const verifier = this.roles.get(this.orchestra.verifier_role_id)
    if (!verifier) return null
    let model: ResolvedModel
    try {
      model = this.requireModel(verifier)
    } catch {
      return null
    }
    const changed = [...this.agentChanges.entries()]
      .map(([path, kind]) => `- [${kind}] ${path}`)
      .join('\n')
    void conductorRole
    return this.phase(verifier, 'review', null, () =>
      requestReview(this, verifier, model, input, outcomes, changed),
    )
  }

  // ─────────────────────────────── helpers ───────────────────────────────────

  private async phase<T>(
    role: Role,
    phaseName: string,
    taskId: string | null,
    fn: () => Promise<T>,
  ): Promise<T> {
    bus.emit(this.sessionId, 'agent.start', {
      session_id: this.sessionId,
      role_id: role.id,
      role_name: role.name,
      task_id: taskId ?? undefined,
      phase: phaseName,
    })
    this.setAgentStatus(role, 'thinking', phaseName)
    try {
      const result = await fn()
      this.setAgentStatus(role, 'idle')
      bus.emit(this.sessionId, 'agent.end', {
        session_id: this.sessionId,
        role_id: role.id,
        role_name: role.name,
        task_id: taskId ?? undefined,
        ok: true,
      })
      return result
    } catch (error) {
      this.setAgentStatus(role, 'error', error instanceof Error ? error.message : undefined)
      bus.emit(this.sessionId, 'agent.end', {
        session_id: this.sessionId,
        role_id: role.id,
        role_name: role.name,
        task_id: taskId ?? undefined,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  private conductorRole(): Role {
    const role = this.orchestra.conductor_role_id ? this.roles.get(this.orchestra.conductor_role_id) : null
    if (!role) {
      const fallback = this.membersInOrder()[0]
      if (!fallback) throw new Error('В оркестре нет участников')
      return fallback
    }
    return role
  }

  private fallbackExecutor(): Role | null {
    const members = this.membersInOrder()
    return members.find((role) => role.id !== this.orchestra.conductor_role_id) ?? members[0] ?? null
  }

  private membersInOrder(): Role[] {
    return [...this.orchestra.members]
      .sort((a, b) => a.position - b.position)
      .map((member) => this.roles.get(member.role_id))
      .filter((role): role is Role => Boolean(role))
  }

  private matchRole(name: string | null): Role | null {
    if (!name) return null
    const normalized = name.trim().toLowerCase().replace(/[«»"']/g, '')
    for (const role of this.roles.values()) {
      if (role.name.trim().toLowerCase() === normalized) return role
    }
    for (const role of this.roles.values()) {
      if (role.name.toLowerCase().includes(normalized) || normalized.includes(role.name.toLowerCase())) return role
    }
    return null
  }

  private requireModel(role: Role): ResolvedModel {
    const model = this.models.get(role.id)
    if (!model) {
      throw new Error(this.modelErrors.get(role.id) ?? `Для роли «${role.name}» не настроена модель`)
    }
    return model
  }

  private setTaskStatus(taskId: string, status: Task['status'], result: string | null): void {
    const updated = updateTask(taskId, { status, result })
    if (updated) {
      bus.emit(this.sessionId, 'task.updated', {
        task_id: updated.id,
        title: updated.title,
        status: updated.status,
        role_id: updated.assigned_role_id,
        role_name: this.roleName(updated.assigned_role_id),
      })
      bus.tasks(this.sessionId, listTasks(this.sessionId))
    }
  }

  private taskById(id: string): Task | null {
    return listTasks(this.sessionId).find((task) => task.id === id) ?? null
  }

  private roleName(roleId: string | null): string | null {
    if (!roleId) return null
    return this.roles.get(roleId)?.name ?? getRole(roleId)?.name ?? null
  }

  private consumeQueue(roleId: string): string {
    // Broadcast messages (no addressee) are delivered to every participant exactly once;
    // addressed messages are delivered only to their role.
    const relevant = this.queue.filter(
      (item) => (!item.toRoleId || item.toRoleId === roleId) && !item.deliveredTo.has(roleId),
    )
    if (relevant.length === 0) return ''
    for (const item of relevant) item.deliveredTo.add(roleId)
    const memberIds = [...this.roles.keys()]
    this.queue = this.queue.filter((item) => {
      if (item.toRoleId) return !item.deliveredTo.has(item.toRoleId)
      return !memberIds.every((id) => item.deliveredTo.has(id))
    })
    return relevant.map((item) => item.text).join('\n\n')
  }

  private queuedContext(roleId: string): string {
    const queued = this.consumeQueue(roleId)
    return queued ? `\nСообщения пользователя:\n${queued}` : ''
  }

  private priorHistory(): ChatMessage[] {
    const history = listMessages(this.sessionId)
      .filter((message) => (message.kind === 'user' || message.kind === 'final') && message.content.trim())
      .slice(-6)
      .map((message) => ({
        role: message.kind === 'user' ? ('user' as const) : ('assistant' as const),
        content: truncateToTokens(message.content, 1500),
      }))
    // Drop the just-created user message (it is passed explicitly as the task).
    if (history.length > 0 && history[history.length - 1]?.role === 'user') history.pop()
    const merged: ChatMessage[] = []
    for (const message of history) {
      const last = merged[merged.length - 1]
      if (last && last.role === message.role) last.content += `\n\n${message.content}`
      else merged.push(message)
    }
    return merged
  }

  private buildOutcomes(): string {
    const tasks = listTasks(this.sessionId)
    return tasks
      .map((task) => {
        const assignee = this.roleName(task.assigned_role_id) ?? '—'
        return `### [${task.status}] ${task.title} — ${assignee}\n${truncateToTokens(task.result ?? '(нет результата)', 2500)}`
      })
      .join('\n\n')
  }

  private persistFinal(role: Role, text: string): void {
    if (!text.trim()) return
    const message = createMessage({
      session_id: this.sessionId,
      role_id: role.id,
      kind: 'final',
      content: text,
      tokens_out: estimateTokens(text),
    })
    bus.emit(this.sessionId, 'agent.message', {
      message_id: message.id,
      role_id: role.id,
      kind: 'final',
      content: text,
      tokens_in: message.tokens_in,
      tokens_out: message.tokens_out,
    })
  }

  private finish(status: Session['status'], text: string): void {
    if (this.finished) return
    this.finished = true
    const conductor = this.orchestra.conductor_role_id
      ? this.roles.get(this.orchestra.conductor_role_id)
      : this.fallbackExecutor()
    if (text.trim()) {
      const kind: MessageKind = status === 'error' ? 'error' : 'final'
      const message = createMessage({
        session_id: this.sessionId,
        role_id: conductor?.id ?? null,
        kind,
        content: text,
        tokens_out: estimateTokens(text),
      })
      bus.emit(this.sessionId, 'agent.message', {
        message_id: message.id,
        role_id: conductor?.id ?? null,
        kind,
        content: text,
        tokens_in: 0,
        tokens_out: message.tokens_out,
      })
    }
    for (const role of this.roles.values()) this.setAgentStatus(role, status === 'error' ? 'error' : 'done')
    const session = updateSession(this.sessionId, { status })
    if (session) bus.sessionState(session)
    bus.emit(this.sessionId, 'run.end', {
      session_id: this.sessionId,
      status,
      tokens_in: this.tokensIn,
      tokens_out: this.tokensOut,
    })
    bus.tasks(this.sessionId, listTasks(this.sessionId))
    logger.info(`Run finished ${this.sessionId}`, { status, tokensIn: this.tokensIn, tokensOut: this.tokensOut })
  }

  private setStatus(status: Session['status']): void {
    const session = updateSession(this.sessionId, { status })
    if (session) bus.sessionState(session)
  }

  private wakeResume(): void {
    const waiters = this.resumeWaiters
    this.resumeWaiters = []
    waiters.forEach((resolve) => resolve())
  }

  private registryCleanup(): void {
    if (runs.get(this.sessionId) === this) runs.delete(this.sessionId)
  }
}

// ───────────────────────────── run registry / API ─────────────────────────────

const runs = new Map<string, OrchestraRun>()

export function activeRun(sessionId: string): OrchestraRun | undefined {
  return runs.get(sessionId)
}

export function startRun(sessionId: string, input: string): OrchestraRun {
  const existing = runs.get(sessionId)
  if (existing && !existing.isFinished) throw new Error('Сессия уже выполняется')
  const run = new OrchestraRun(sessionId)
  runs.set(sessionId, run)
  void run.start(input)
  return run
}

export function cancelRun(sessionId: string): boolean {
  const run = runs.get(sessionId)
  if (!run) return false
  run.cancel()
  return true
}

export function pauseRun(sessionId: string): boolean {
  const run = runs.get(sessionId)
  if (!run) return false
  run.pause()
  return true
}

export function resumeRun(sessionId: string): boolean {
  const run = runs.get(sessionId)
  if (!run) return false
  run.resume()
  return true
}

export function approveRun(sessionId: string, approvalId: string, allow: boolean): boolean {
  const run = runs.get(sessionId)
  if (!run) return false
  return run.approve(approvalId, allow)
}

export function enqueueUserMessage(sessionId: string, text: string, toRoleId: string | null): boolean {
  const run = runs.get(sessionId)
  if (!run || run.isFinished) return false
  run.enqueue(text, toRoleId)
  return true
}

export function runningSessionIds(): string[] {
  return [...runs.keys()]
}

export async function stopProjectRuns(projectId: string): Promise<void> {
  const stops = [...runs.values()]
    .filter((run) => run.project.id === projectId && !run.isFinished)
    .map(async (run) => {
      await run.stop()
    })
  await Promise.all(stops)
}

