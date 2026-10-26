import { integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const providers = sqliteTable('providers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  protocol: text('protocol').notNull(),
  baseUrl: text('base_url').notNull(),
  apiKeyEnc: text('api_key_enc'),
  extraHeadersJson: text('extra_headers_json').notNull().default('[]'),
  timeoutMs: integer('timeout_ms').notNull().default(120000),
  createdAt: integer('created_at').notNull(),
})

export const models = sqliteTable('models', {
  id: text('id').primaryKey(),
  providerId: text('provider_id')
    .notNull()
    .references(() => providers.id, { onDelete: 'cascade' }),
  modelId: text('model_id').notNull(),
  displayName: text('display_name').notNull(),
  contextWindow: integer('context_window').notNull().default(128000),
  maxOutput: integer('max_output').notNull().default(8192),
  supportsTools: integer('supports_tools').notNull().default(1),
  supportsVision: integer('supports_vision').notNull().default(0),
  enabled: integer('enabled').notNull().default(1),
})

export const roles = sqliteTable('roles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  systemPrompt: text('system_prompt').notNull().default(''),
  modelId: text('model_id').references(() => models.id, { onDelete: 'set null' }),
  temperature: real('temperature').notNull().default(0.7),
  toolsJson: text('tools_json').notNull().default('[]'),
  permission: text('permission').notNull().default('write'),
  shellMode: text('shell_mode').notNull().default('off'),
  color: text('color').notNull().default('#8B8BF5'),
  createdAt: integer('created_at').notNull(),
})

export const orchestras = sqliteTable('orchestras', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  strategy: text('strategy').notNull().default('conductor'),
  conductorRoleId: text('conductor_role_id'),
  verifierRoleId: text('verifier_role_id'),
  fixerRoleId: text('fixer_role_id'),
  maxRounds: integer('max_rounds').notNull().default(6),
  budgetTokens: integer('budget_tokens').notNull().default(500000),
  approvalMode: text('approval_mode').notNull().default('auto'),
  configJson: text('config_json').notNull().default('{}'),
  createdAt: integer('created_at').notNull(),
})

export const orchestraMembers = sqliteTable(
  'orchestra_members',
  {
    orchestraId: text('orchestra_id')
      .notNull()
      .references(() => orchestras.id, { onDelete: 'cascade' }),
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.orchestraId, t.roleId] })],
)

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  rootPath: text('root_path').notNull(),
  createdAt: integer('created_at').notNull(),
})

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  orchestraId: text('orchestra_id')
    .notNull()
    .references(() => orchestras.id, { onDelete: 'cascade' }),
  title: text('title').notNull().default(''),
  status: text('status').notNull().default('idle'),
  tokensIn: integer('tokens_in').notNull().default(0),
  tokensOut: integer('tokens_out').notNull().default(0),
  cost: real('cost').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  roleId: text('role_id'),
  kind: text('kind').notNull(),
  toRoleId: text('to_role_id'),
  content: text('content').notNull(),
  tokensIn: integer('tokens_in').notNull().default(0),
  tokensOut: integer('tokens_out').notNull().default(0),
  createdAt: integer('created_at').notNull(),
})

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  parentId: text('parent_id'),
  assignedRoleId: text('assigned_role_id'),
  title: text('title').notNull(),
  payload: text('payload').notNull().default(''),
  status: text('status').notNull().default('pending'),
  dependsOnJson: text('depends_on_json').notNull().default('[]'),
  result: text('result'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  sessionId: text('session_id'),
  type: text('type').notNull(),
  payloadJson: text('payload_json').notNull().default('{}'),
  createdAt: integer('created_at').notNull(),
})

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

export type ProviderRow = typeof providers.$inferSelect
export type ModelRow = typeof models.$inferSelect
export type RoleRow = typeof roles.$inferSelect
export type OrchestraRow = typeof orchestras.$inferSelect
export type SessionRow = typeof sessions.$inferSelect
export type MessageRow = typeof messages.$inferSelect
export type TaskRow = typeof tasks.$inferSelect
export type EventRow = typeof events.$inferSelect
export type ProjectRow = typeof projects.$inferSelect
