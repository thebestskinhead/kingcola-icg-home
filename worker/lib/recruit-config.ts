/**
 * 招新设置的读写（整届状态 + 名称 + 四个 QQ 群号 + 邮件模板）。
 *
 * 存在 D1 `site_config['recruit']`，**刻意不塞进 `runtime`**：
 * runtime 是每个访客都会拉取的公开配置，而群号与模板正文属于管理端数据，
 * 放进 runtime 会让模板正文随 `/api/config/runtime` 下发给所有访问者。
 *
 * 两部分都是「JSON 合并默认值」，所以新增配置项**不需要数据库迁移**。
 * 整届状态（state）也在这里 —— 它是被管理员动作改写的，改一次写一次 KV/D1，量级完全可接受。
 */

import {
  DEFAULT_RECRUIT_CYCLE,
  DEFAULT_RECRUIT_GROUPS,
  DEFAULT_RECRUIT_TEMPLATES,
  RECRUIT_MAIL_KINDS,
  type RecruitCycleConfig,
  type RecruitCycleState,
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
  // groups 是对象：浅合并会把 undefined 带进来，所以按字段单独合并
  merged.groups = { ...DEFAULT_RECRUIT_GROUPS, ...(stored?.groups ?? {}) }
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

/** 只看整届状态（公开接口与签到、报名风控都要用，省得每处都解一遍设置） */
export async function getRecruitState(env: Env): Promise<RecruitCycleState> {
  const { cycle } = await getRecruitSettings(env)
  return cycle.state
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
