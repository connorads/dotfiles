import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { readFile } from "fs/promises"
import { homedir } from "os"
import { join } from "path"
import { Buffer } from "node:buffer"

type JsonRecord = Record<string, unknown>

type OpenAIAuthData = {
  type: string
  access?: string
  expires?: number
}

type RateLimitWindow = {
  usedPercent: number
  limitWindowSeconds: number
  resetAfterSeconds: number
}

type UsageRateLimit = {
  limitReached: boolean
  primaryWindow: RateLimitWindow
  secondaryWindow?: RateLimitWindow
}

type UsageResponse = {
  planType: string
  rateLimit: UsageRateLimit | null
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

const AUTH_PATH = join(homedir(), ".local/share/opencode/auth.json")
const OPENAI_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage"
const REQUEST_TIMEOUT_MS = 10_000
const CACHE_TTL_MS = 60_000

let cache: { at: number; output: string } | null = null

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isString = (value: unknown): value is string => typeof value === "string"

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value)

const isBoolean = (value: unknown): value is boolean => typeof value === "boolean"

const clampPercent = (value: number): number => Math.max(0, Math.min(100, Math.round(value)))

const readAuthData = async (): Promise<Result<JsonRecord>> => {
  try {
    const content = await readFile(AUTH_PATH, "utf-8")
    const parsed: unknown = JSON.parse(content)
    if (!isRecord(parsed)) {
      return { ok: false, error: "Invalid auth.json format." }
    }
    return { ok: true, value: parsed }
  } catch (error) {
    return { ok: false, error: `Failed to read auth.json: ${String(error)}` }
  }
}

const getOpenAIAuthData = (data: JsonRecord): OpenAIAuthData | null => {
  const openai = data["openai"]
  if (!isRecord(openai)) return null

  const type = isString(openai["type"]) ? openai["type"] : ""
  const access = isString(openai["access"]) ? openai["access"] : undefined
  const expires = isNumber(openai["expires"]) ? openai["expires"] : undefined

  if (!type) return null
  return { type, access, expires }
}

const base64UrlDecode = (input: string): string | null => {
  try {
    const base64 = input.replace(/-/g, "+").replace(/_/g, "/")
    const padLen = (4 - (base64.length % 4)) % 4
    const padded = base64 + "=".repeat(padLen)
    return Buffer.from(padded, "base64").toString("utf8")
  } catch {
    return null
  }
}

const parseJwtPayload = (token: string): JsonRecord | null => {
  const parts = token.split(".")
  if (parts.length !== 3) return null
  const payloadJson = base64UrlDecode(parts[1])
  if (!payloadJson) return null
  try {
    const parsed: unknown = JSON.parse(payloadJson)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

const getEmailFromJwt = (token: string): string | null => {
  const payload = parseJwtPayload(token)
  if (!payload) return null
  const profile = payload["https://api.openai.com/profile"]
  if (!isRecord(profile)) return null
  const email = profile["email"]
  return isString(email) ? email : null
}

const getAccountIdFromJwt = (token: string): string | null => {
  const payload = parseJwtPayload(token)
  if (!payload) return null
  const auth = payload["https://api.openai.com/auth"]
  if (!isRecord(auth)) return null
  const accountId = auth["chatgpt_account_id"]
  return isString(accountId) ? accountId : null
}

const fetchWithTimeout = async (url: string, options: RequestInit): Promise<Response> => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

const parseRateLimitWindow = (value: unknown): RateLimitWindow | null => {
  if (!isRecord(value)) return null

  const usedPercent = value["used_percent"]
  const limitWindowSeconds = value["limit_window_seconds"]
  const resetAfterSeconds = value["reset_after_seconds"]

  if (!isNumber(usedPercent) || !isNumber(limitWindowSeconds) || !isNumber(resetAfterSeconds)) {
    return null
  }

  return {
    usedPercent,
    limitWindowSeconds,
    resetAfterSeconds,
  }
}

const parseRateLimit = (value: unknown): UsageRateLimit | null => {
  if (value === null) return null
  if (!isRecord(value)) return null

  const limitReachedValue = value["limit_reached"]
  const limitReached = isBoolean(limitReachedValue) ? limitReachedValue : false

  const primaryWindow = parseRateLimitWindow(value["primary_window"])
  if (!primaryWindow) return null

  const secondaryWindow = parseRateLimitWindow(value["secondary_window"])

  return {
    limitReached,
    primaryWindow,
    secondaryWindow: secondaryWindow ?? undefined,
  }
}

const parseUsageResponse = (value: unknown): UsageResponse | null => {
  if (!isRecord(value)) return null

  const planType = isString(value["plan_type"]) ? value["plan_type"] : "unknown"
  const rateLimit = parseRateLimit(value["rate_limit"])

  return {
    planType,
    rateLimit,
  }
}

const fetchOpenAIUsage = async (accessToken: string): Promise<Result<UsageResponse>> => {
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "OpenCode-Codex-Status/1.0",
    }

    const accountId = getAccountIdFromJwt(accessToken)
    if (accountId) {
      headers["ChatGPT-Account-Id"] = accountId
    }

    const response = await fetchWithTimeout(OPENAI_USAGE_URL, { headers })

    if (!response.ok) {
      const errorText = await response.text()
      return {
        ok: false,
        error: `OpenAI usage API error (${response.status}): ${errorText}`,
      }
    }

    const data: unknown = await response.json()
    const parsed = parseUsageResponse(data)
    if (!parsed) {
      return { ok: false, error: "Unexpected OpenAI usage response format." }
    }

    return { ok: true, value: parsed }
  } catch (error) {
    return { ok: false, error: `Failed to fetch OpenAI usage: ${String(error)}` }
  }
}

const formatDuration = (seconds: number): string => {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  const days = Math.floor(safeSeconds / 86400)
  const hours = Math.floor((safeSeconds % 86400) / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

const formatWindowName = (seconds: number): string => {
  const hours = Math.max(1, Math.round(seconds / 3600))
  if (hours >= 24) {
    const days = Math.round(hours / 24)
    return `${days}-day limit`
  }
  return `${hours}-hour limit`
}

const createProgressBar = (usedPercent: number, width: number = 24): string => {
  const safePercent = clampPercent(usedPercent)
  const filled = Math.round((safePercent / 100) * width)
  const empty = width - filled
  return `[${"#".repeat(filled)}${"-".repeat(empty)}]`
}

const formatWindow = (window: RateLimitWindow): string[] => {
  const usedPercent = clampPercent(window.usedPercent)
  const remainingPercent = clampPercent(100 - usedPercent)
  const bar = createProgressBar(usedPercent)
  const resetTime = formatDuration(window.resetAfterSeconds)

  return [
    formatWindowName(window.limitWindowSeconds),
    `${bar} ${usedPercent}% used, ${remainingPercent}% remaining`,
    `Resets in: ${resetTime}`,
  ]
}

const formatUsage = (data: UsageResponse, email: string | null): string => {
  const lines: string[] = []
  const accountLabel = email ?? "unknown"

  lines.push("Codex usage")
  lines.push("")
  lines.push(`Account: ${accountLabel} (${data.planType})`)

  if (!data.rateLimit) {
    lines.push("")
    lines.push("No rate limit data available.")
    return lines.join("\n")
  }

  lines.push("")
  lines.push(...formatWindow(data.rateLimit.primaryWindow))

  if (data.rateLimit.secondaryWindow) {
    lines.push("")
    lines.push(...formatWindow(data.rateLimit.secondaryWindow))
  }

  if (data.rateLimit.limitReached) {
    lines.push("")
    lines.push("Limit reached.")
  }

  return lines.join("\n")
}

export const CodexStatusPlugin: Plugin = async () => {
  return {
    tool: {
      codexstatus: tool({
        description:
          "Query Codex (ChatGPT OAuth) usage limits and show remaining quota with a progress bar.",
        args: {},
        async execute() {
          if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
            return cache.output
          }

          const authResult = await readAuthData()
          if (!authResult.ok) return authResult.error

          const openai = getOpenAIAuthData(authResult.value)
          if (!openai || openai.type !== "oauth" || !openai.access) {
            return "OpenAI OAuth token not found. Run: opencode auth login openai"
          }

          if (openai.expires && openai.expires < Date.now()) {
            return "OpenAI OAuth token expired. Run: opencode auth login openai"
          }

          const usageResult = await fetchOpenAIUsage(openai.access)
          if (!usageResult.ok) return usageResult.error

          const email = getEmailFromJwt(openai.access)
          const output = formatUsage(usageResult.value, email)

          cache = { at: Date.now(), output }
          return output
        },
      }),
    },
  }
}
