/**
 * 招新设置（周期 + 邮件模板）的读写。
 *
 * 存在 D1 `site_config['recruit']`，**刻意不塞进 `runtime`**：
 * runtime 是每个访客都会拉取的公开配置，而周期时间窗、邮件模板属于管理端数据，
 * 放进 runtime 会让模板正文随 `/api/config/runtime` 下发给所有访问者。
 *
 * 两个部分都是「JSON 合并默认值」，所以新增配置项**不需要数据库迁移**。
 */

import {
  DEFAULT_RECRUIT_CYCLE,
  DEFAULT_RECRUIT_TEMPLATES,
  recruitPhase,
  RECRUIT_MAIL_KINDS,
  type RecruitCycleConfig,
  type RecruitPhase,
  type RecruitTemplates,
} from '../../shared/recruit'
import type { Env } from '../env'
import { getConfigValue, setConfigValue } from './repo'

const RECRUIT_CONFIG_KEY = 'recruit'

export interface RecruitSettings {
  cycle: RecruitCycleConfig
  templates: RecruitTemplates
}

function mergeCycle(stored: Partial<RecruitCycleConfig> | null | undefined): RecruitCycleConfig {
  const merged = { ...DEFAULT_RECRUIT_CYCLE, ...(stored ?? {}) }
  // archives 是数组：缺省时用默认空数组，存在时原样保留（浅合并会把 undefined 带进来）
  merged.archives = Array.isArray(merged.archives) ? merged.archives : []
  merged.absentGraceHours = Number(merged.absentGraceHours) || 0
  return merged
}

function mergeTemplates(stored: Partial<RecruitTemplates> | null | undefined): RecruitTemplates {
  const out = {} as RecruitTemplates
  for (const kind of RECRUIT_MAIL_KINDS) {
    const base = DEFAULT_RECRUIT_TEMPLATES[kind]
    const patch = stored?.[kind]
    out[kind] = {
      subject: patch?.subject ?? base.subject,
      body: patch?.body ?? base.body,
      enabled: patch?.enabled ?? base.enabled,
    }
  }
  return out
}

export async function getRecruitSettings(env: Env): Promise<RecruitSettings> {
  const stored = await getConfigValue<Partial<RecruitSettings>>(env, RECRUIT_CONFIG_KEY)
  return {
    cycle: mergeCycle(stored?.cycle),
    templates: mergeTemplates(stored?.templates),
  }
}

/** 当前周期处于什么阶段（多处要用，单独包一个） */
export async function getRecruitPhase(env: Env, now: Date = new Date()): Promise<RecruitPhase> {
  const { cycle } = await getRecruitSettings(env)
  return recruitPhase(cycle, now)
}

export interface RecruitSettingsPatch {
  cycle?: Partial<RecruitCycleConfig>
  templates?: Partial<RecruitTemplates>
}

export async function saveRecruitSettings(
  env: Env,
  patch: RecruitSettingsPatch,
): Promise<RecruitSettings> {
  const current = await getRecruitSettings(env)
  const next: RecruitSettings = {
    cycle: patch.cycle ? mergeCycle({ ...current.cycle, ...patch.cycle }) : current.cycle,
    templates: patch.templates ? mergeTemplates({ ...current.templates, ...patch.templates }) : current.templates,
  }
  await setConfigValue(env, RECRUIT_CONFIG_KEY, next)
  return next
}

export function isRecruitEmailsEnabled(settings: RecruitSettings): boolean {
  return RECRUIT_MAIL_KINDS.some((kind) => settings.templates[kind].enabled)
}
