import type { Link } from '../../shared/schemas/link'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyMigrationPlan,
  buildMigrationPlan,
} from '../../scripts/normalize-vibemuse-utm.ts'
import {
  normalizeVibemuseLink,
  normalizeVibemuseUrl,
} from '../../shared/utils/vibemuse-utm.ts'
import { deleteStoredLink, getStoredLink, postJson, putJson } from '../utils.ts'

describe('vibemuse UTM normalization', () => {
  it('normalizes account links and preserves unrelated query params', () => {
    const result = normalizeVibemuseLink({
      slug: 'sprr9t',
      url: 'https://vibemuse.app/?ref=instagram-bio&utm_source=instagram&utm_medium=social&utm_campaign=launch_202606&utm_content=row06_instagram_travel_sprr9t',
      comment: '账号管理 row 06 | Instagram | art_visit_guide | 官网 | utm_content=row06_instagram_travel_sprr9t',
    })

    expect('reason' in result).toBe(false)
    if ('reason' in result)
      throw new Error(result.reason)

    expect(result.term).toBe('account')
    expect(result.utmContent).toBe('instagram_art_visit_guide_sprr9t')
    expect(result.normalizedUrl).toContain('utm_term=account')
    expect(result.normalizedUrl).toContain('utm_content=instagram_art_visit_guide_sprr9t')
    expect(result.normalizedUrl).toContain('ref=instagram-bio')
    expect(result.normalizedUrl).not.toContain('row06')
    expect(result.normalizedComment).toContain('utm_term=account')
    expect(result.normalizedComment).toContain('utm_content=instagram_art_visit_guide_sprr9t')
  })

  it('normalizes content links to utm_term=content', () => {
    const result = normalizeVibemuseLink({
      slug: 'ab12cd',
      url: normalizeVibemuseUrl('https://vibemuse.app/?foo=bar', {
        source: 'instagram',
        campaign: 'ai_playground_20260701',
        term: 'account',
        identifier: 'placeholder',
        slug: 'ab12cd',
      }),
      comment: '内容管理 row 01 | Instagram | museum_walkthrough | 官网 | utm_content=instagram_placeholder_ab12cd',
    })

    expect('reason' in result).toBe(false)
    if ('reason' in result)
      throw new Error(result.reason)

    expect(result.term).toBe('content')
    expect(result.utmContent).toBe('instagram_museum_walkthrough_ab12cd')
    expect(result.normalizedUrl).toContain('utm_campaign=ai_playground_20260701')
    expect(result.normalizedUrl).toContain('utm_term=content')
  })
})

describe.sequential('vibemuse UTM migration plan', () => {
  it('reports changed and unchanged links', () => {
    const links: Link[] = [
      {
        id: 'changed-link',
        slug: 'sprr9t',
        url: 'https://vibemuse.app/?utm_source=instagram&utm_medium=social&utm_campaign=launch_202606&utm_content=row06_instagram_travel_sprr9t',
        comment: '账号管理 row 06 | Instagram | art_visit_guide | 官网 | utm_content=row06_instagram_travel_sprr9t',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'unchanged-link',
        slug: '4jwgt7',
        url: 'https://vibemuse.app/?utm_source=instagram&utm_medium=social&utm_campaign=launch_202606&utm_term=account&utm_content=instagram_vibemuseapp2026_4jwgt7',
        comment: '账号管理 row 04 | Instagram | vibemuseapp2026 | 官网 | utm_term=account | utm_content=instagram_vibemuseapp2026_4jwgt7',
        createdAt: 1,
        updatedAt: 1,
      },
    ]

    const plan = buildMigrationPlan(links)
    expect(plan.candidates).toBe(2)
    expect(plan.changed).toHaveLength(1)
    expect(plan.unchanged).toEqual(['4jwgt7'])
  })

  it('fails fast when apply mode backup is missing', async () => {
    await expect(applyMigrationPlan([], [], join(tmpdir(), `missing-backup-${crypto.randomUUID()}.json`), async () => {}))
      .rejects
      .toThrow('Backup file not found')
  })

  it('applies planned updates through the edit API while preserving optional fields', async () => {
    const slug = `vibemuse-${crypto.randomUUID()}`
    const createResponse = await postJson('/api/link/create', {
      slug,
      url: 'https://vibemuse.app/?utm_source=instagram&utm_medium=social&utm_campaign=launch_202606&utm_content=row06_instagram_travel_placeholder',
      comment: '账号管理 row 06 | Instagram | art_visit_guide | 官网 | utm_content=row06_instagram_travel_placeholder',
      apple: 'https://apps.apple.com/us/app/vibemuse-museum-guide/id6761079723',
    })
    expect(createResponse.status).toBe(201)

    const created = await getStoredLink(slug)
    if (!created)
      throw new Error('Expected stored link to exist')

    const plan = buildMigrationPlan([created])
    expect(plan.changed).toHaveLength(1)

    const tempDir = join(tmpdir(), `sink-vibemuse-${crypto.randomUUID()}`)
    mkdirSync(tempDir, { recursive: true })
    const backupPath = join(tempDir, 'backup.json')
    writeFileSync(backupPath, JSON.stringify({ links: [created] }), 'utf8')

    await applyMigrationPlan([created], plan.changed, backupPath, async (payload) => {
      const response = await putJson('/api/link/edit', payload)
      expect(response.status).toBe(201)
    })

    const stored = await getStoredLink(slug)
    expect(stored?.url).toContain('utm_term=account')
    expect(stored?.url).toContain(`utm_content=instagram_art_visit_guide_${slug}`)
    expect(stored?.comment).toContain('utm_term=account')
    expect(stored?.comment).toContain(`utm_content=instagram_art_visit_guide_${slug}`)
    expect(stored?.apple).toBe('https://apps.apple.com/us/app/vibemuse-museum-guide/id6761079723')

    rmSync(tempDir, { recursive: true, force: true })
    await deleteStoredLink(slug)
  })
})
