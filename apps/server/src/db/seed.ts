import { listRoles, createRole } from './repo/roles'
import { getAllSettings, setSettings } from './repo/settings'
import { PRESET_ROLES } from '../orchestra/prompts'
import { logger } from '../lib/logger'

export function seedDefaults(): void {
  try {
    if (listRoles().length === 0) {
      for (const preset of PRESET_ROLES) {
        createRole({
          name: preset.name,
          description: preset.description,
          system_prompt: preset.system_prompt,
          temperature: preset.temperature,
          tools: preset.tools,
          permission: preset.permission,
          shell_mode: preset.shell_mode,
          color: preset.color,
        })
      }
      logger.info(`Seeded ${PRESET_ROLES.length} preset roles`)
    }

    const settings = getAllSettings()
    const defaults: Record<string, unknown> = {}
    if (settings.locale === undefined) defaults.locale = 'ru'
    if (settings.hide_gitignored === undefined) defaults.hide_gitignored = false
    if (settings.auto_scroll === undefined) defaults.auto_scroll = true
    if (Object.keys(defaults).length > 0) setSettings(defaults)
  } catch (error) {
    logger.error('Seeding failed', { error: String(error) })
  }
}
