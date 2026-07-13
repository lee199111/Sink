import type { Link } from '../schemas/link'

export const VIBEMUSE_UTM_CAMPAIGNS = [
  'launch_202606',
  'ai_playground_20260701',
] as const

export const VIBEMUSE_UTM_TERMS = [
  'account',
  'content',
] as const

export const VIBEMUSE_SOCIAL_SOURCES = [
  'instagram',
  'threads',
  'tiktok',
] as const

export type VibemuseUtmCampaign = (typeof VIBEMUSE_UTM_CAMPAIGNS)[number]
export type VibemuseUtmTerm = (typeof VIBEMUSE_UTM_TERMS)[number]
export type VibemuseSocialSource = (typeof VIBEMUSE_SOCIAL_SOURCES)[number]

export interface VibemuseUtmQuery {
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_term?: string
  utm_content?: string
}

export interface VibemuseNormalizationInput {
  slug: string
  url: string
  comment?: string
}

export interface VibemuseNormalizedLink {
  normalizedUrl: string
  normalizedComment: string
  source: VibemuseSocialSource
  campaign: VibemuseUtmCampaign
  term: VibemuseUtmTerm
  identifier: string
  utmContent: string
}

export interface VibemuseNormalizationFailure {
  reason: string
}

const VIBEMUSE_HOSTS = new Set([
  'vibemuse.app',
  'www.vibemuse.app',
])

const DISPLAY_SOURCE_TO_CANONICAL: Record<string, VibemuseSocialSource> = {
  instagram: 'instagram',
  thread: 'threads',
  threads: 'threads',
  tiktok: 'tiktok',
}

const CANONICAL_TO_DISPLAY_SOURCE: Record<VibemuseSocialSource, string> = {
  instagram: 'Instagram',
  threads: 'Threads',
  tiktok: 'TikTok',
}

export function isVibemuseCampaign(value: string): value is VibemuseUtmCampaign {
  return (VIBEMUSE_UTM_CAMPAIGNS as readonly string[]).includes(value)
}

export function isVibemuseTerm(value: string): value is VibemuseUtmTerm {
  return (VIBEMUSE_UTM_TERMS as readonly string[]).includes(value)
}

export function isVibemuseSocialSource(value: string): value is VibemuseSocialSource {
  return (VIBEMUSE_SOCIAL_SOURCES as readonly string[]).includes(value)
}

export function parseVibemuseUtmQuery(url: string): VibemuseUtmQuery | null {
  try {
    const parsed = new URL(url)
    return {
      utm_source: parsed.searchParams.get('utm_source') ?? undefined,
      utm_medium: parsed.searchParams.get('utm_medium') ?? undefined,
      utm_campaign: parsed.searchParams.get('utm_campaign') ?? undefined,
      utm_term: parsed.searchParams.get('utm_term') ?? undefined,
      utm_content: parsed.searchParams.get('utm_content') ?? undefined,
    }
  }
  catch {
    return null
  }
}

export function isVibemuseWebsiteSocialLink(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (!VIBEMUSE_HOSTS.has(parsed.hostname))
      return false

    return isVibemuseSocialSource(parsed.searchParams.get('utm_source') ?? '')
  }
  catch {
    return false
  }
}

export function normalizeVibemuseIdentifier(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export function inferVibemuseTerm(comment?: string, currentTerm?: string): VibemuseUtmTerm {
  if (currentTerm && isVibemuseTerm(currentTerm))
    return currentTerm

  const normalizedComment = comment?.trim() ?? ''
  if (normalizedComment.includes('内容') || normalizedComment.includes('"content_id"'))
    return 'content'

  return 'account'
}

export function extractVibemuseIdentifier(input: VibemuseNormalizationInput, source: VibemuseSocialSource): string | null {
  const fromComment = extractIdentifierFromComment(input.comment, source)
  if (fromComment)
    return fromComment

  const query = parseVibemuseUtmQuery(input.url)
  const fromContent = extractIdentifierFromUtmContent(query?.utm_content, source, input.slug)
  if (fromContent)
    return fromContent

  return null
}

export function normalizeVibemuseUrl(
  url: string,
  options: {
    source: VibemuseSocialSource
    campaign: VibemuseUtmCampaign
    term: VibemuseUtmTerm
    identifier: string
    slug: string
  },
): string {
  const parsed = new URL(url)
  const normalizedIdentifier = normalizeVibemuseIdentifier(options.identifier)
  const utmContent = `${options.source}_${normalizedIdentifier}_${options.slug}`

  parsed.searchParams.set('utm_source', options.source)
  parsed.searchParams.set('utm_medium', 'social')
  parsed.searchParams.set('utm_campaign', options.campaign)
  parsed.searchParams.set('utm_term', options.term)
  parsed.searchParams.set('utm_content', utmContent)

  return parsed.toString()
}

export function normalizeVibemuseComment(
  comment: string | undefined,
  options: {
    source: VibemuseSocialSource
    term: VibemuseUtmTerm
    identifier: string
    slug: string
  },
): string {
  const normalizedIdentifier = normalizeVibemuseIdentifier(options.identifier)
  const utmContent = `${options.source}_${normalizedIdentifier}_${options.slug}`

  const segments = (comment ?? '')
    .split('|')
    .map(segment => segment.trim())
    .filter(Boolean)
    .filter(segment => !segment.startsWith('utm_term=') && !segment.startsWith('utm_content='))

  if (segments.length === 0) {
    segments.push(CANONICAL_TO_DISPLAY_SOURCE[options.source], normalizedIdentifier, '官网')
  }

  return [
    ...segments,
    `utm_term=${options.term}`,
    `utm_content=${utmContent}`,
  ].join(' | ')
}

export function normalizeVibemuseLink(
  input: VibemuseNormalizationInput,
): VibemuseNormalizedLink | VibemuseNormalizationFailure {
  if (!isVibemuseWebsiteSocialLink(input.url))
    return { reason: 'not a Vibemuse website social link' }

  const query = parseVibemuseUtmQuery(input.url)
  if (!query?.utm_source || !isVibemuseSocialSource(query.utm_source))
    return { reason: 'missing supported utm_source' }

  if (!query.utm_campaign || !isVibemuseCampaign(query.utm_campaign))
    return { reason: 'missing supported utm_campaign' }

  const identifier = extractVibemuseIdentifier(input, query.utm_source)
  if (!identifier)
    return { reason: 'unable to infer identifier' }

  const term = inferVibemuseTerm(input.comment, query.utm_term)
  const normalizedUrl = normalizeVibemuseUrl(input.url, {
    source: query.utm_source,
    campaign: query.utm_campaign,
    term,
    identifier,
    slug: input.slug,
  })
  const normalizedComment = normalizeVibemuseComment(input.comment, {
    source: query.utm_source,
    term,
    identifier,
    slug: input.slug,
  })

  return {
    normalizedUrl,
    normalizedComment,
    source: query.utm_source,
    campaign: query.utm_campaign,
    term,
    identifier,
    utmContent: `${query.utm_source}_${normalizeVibemuseIdentifier(identifier)}_${input.slug}`,
  }
}

export function toEditableLinkPayload(link: Link, overrides: Pick<Link, 'url'> & { comment?: string }): Omit<Link, 'password'> {
  const { password: _password, ...payload } = link
  return {
    ...payload,
    ...overrides,
  }
}

function extractIdentifierFromComment(comment: string | undefined, source: VibemuseSocialSource): string | null {
  if (!comment)
    return null

  const fromJson = extractIdentifierFromJsonComment(comment)
  if (fromJson)
    return fromJson

  const segments = comment
    .split('|')
    .map(segment => segment.trim())
    .filter(Boolean)

  const sourceIndex = segments.findIndex(segment => normalizeSourceSegment(segment) === source)
  const candidateSegments = (sourceIndex >= 0 ? segments.slice(sourceIndex + 1) : segments)
    .filter(segment => segment !== '官网')
    .filter(segment => !segment.startsWith('utm_'))
    .filter(segment => !segment.includes('管理 row'))
    .filter(segment => !isSourceAlias(segment))
    .filter(segment => !segment.startsWith('账号链接 '))
    .filter(segment => !looksLikeUrl(segment))

  const identifier = candidateSegments.at(0)
  if (!identifier)
    return null

  const normalized = normalizeVibemuseIdentifier(identifier)
  return normalized || null
}

function extractIdentifierFromUtmContent(content: string | undefined, source: VibemuseSocialSource, slug: string): string | null {
  if (!content)
    return null

  let normalized = normalizeVibemuseIdentifier(content)
  normalized = normalized.replace(/^row\d+_/, '')
  normalized = normalized.replace(new RegExp(`^${source}_`), '')
  normalized = normalized.replace(new RegExp(`_${slug}$`), '')

  if (!normalized)
    return null

  return normalized
}

function normalizeSourceSegment(segment: string): VibemuseSocialSource | null {
  return DISPLAY_SOURCE_TO_CANONICAL[segment.trim().toLowerCase()] ?? null
}

function isSourceAlias(segment: string): boolean {
  return normalizeSourceSegment(segment) !== null
}

function extractIdentifierFromJsonComment(comment: string): string | null {
  const normalized = comment.trim()
  if (!normalized.startsWith('{'))
    return null

  try {
    const parsed = JSON.parse(normalized) as { content_id?: unknown }
    if (typeof parsed.content_id !== 'string')
      return null

    const identifier = normalizeVibemuseIdentifier(parsed.content_id)
    return identifier || null
  }
  catch {
    return null
  }
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}
