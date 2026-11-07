import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectChatService } from '../../src/main/dashboard/project-chat-service'
import type {
  DashboardProject,
  DashboardProjectChatMessage,
  DashboardProjectChatStartResult
} from '../../src/shared/dashboard-contract'

const dirs: string[] = []
let rootDir: string

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), 'chat-members-'))
  dirs.push(rootDir)
})

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

function project(id: string): DashboardProject {
  return {
    id,
    name: 'Acme',
    clientName: 'Acme',
    profileId: 'pf1',
    teamId: 'T1',
    appId: 'slack',
    tokenSource: 'oauth',
    monitors: [{ channelId: 'C1', channelName: 'client-dev' }],
    createdAt: '2026-01-01T00:00:00.000Z'
  }
}

function buildService(knownIds: string[]): ProjectChatService {
  const projects = knownIds.map(project)
  return new ProjectChatService({
    rootDir,
    monitorStore: { listProjects: async () => projects },
    configService: { resolveSettings: async () => undefined as never },
    insightEngine: { existingInsight: async () => null },
    retriever: { retrieve: async () => ({ recent: [], matches: [] }) }
  })
}

const SINK = { chunk: () => {}, done: () => {}, error: () => {} }

function appendMessage(
  service: ProjectChatService,
  projectId: string,
  message: DashboardProjectChatMessage
): Promise<void> {
  return (
    service as unknown as {
      appendMessage: (projectId: string, message: DashboardProjectChatMessage) => Promise<void>
    }
  ).appendMessage(projectId, message)
}

const QUESTION_MESSAGE: DashboardProjectChatMessage = {
  role: 'user',
  content: 'hi',
  atIso: '2026-01-01T00:00:00.000Z'
}

describe('ProjectChatService project membership enforcement', () => {
  it('loadHistory rejects a project that is not in the store', async () => {
    const service = buildService(['p1'])
    await expect(service.loadHistory('ghost99')).rejects.toMatchObject({
      code: 'PROJECT_NOT_FOUND'
    })
  })

  it('clearHistory rejects an unknown project and writes no file', async () => {
    const service = buildService(['p1'])
    await expect(service.clearHistory('ghost99')).rejects.toMatchObject({
      code: 'PROJECT_NOT_FOUND'
    })
    await expect(readFile(join(rootDir, 'chat', 'ghost99.json'), 'utf8')).rejects.toThrow()
  })

  it('appendMessage rejects an unknown project', async () => {
    const service = buildService(['p1'])
    await expect(appendMessage(service, 'ghost99', QUESTION_MESSAGE)).rejects.toMatchObject({
      code: 'PROJECT_NOT_FOUND'
    })
  })

  it('start rejects an unknown project and a malformed id', async () => {
    const service = buildService(['p1'])
    const unknown = await service.start({ projectId: 'ghost99', message: 'hi' }, SINK)
    expect(unknown).toMatchObject<Partial<DashboardProjectChatStartResult>>({
      ok: false,
      code: 'PROJECT_NOT_FOUND'
    })
    const malformed = await service.start({ projectId: '../p1', message: 'hi' }, SINK)
    expect(malformed).toMatchObject<Partial<DashboardProjectChatStartResult>>({
      ok: false,
      code: 'PROJECT_NOT_FOUND'
    })
  })

  it('rejects traversal-shaped ids on every file path', async () => {
    const service = buildService(['p1'])
    await expect(service.loadHistory('../evil')).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' })
    await expect(service.clearHistory('../evil')).rejects.toMatchObject({
      code: 'PROJECT_NOT_FOUND'
    })
    await expect(appendMessage(service, '../evil', QUESTION_MESSAGE)).rejects.toMatchObject({
      code: 'PROJECT_NOT_FOUND'
    })
  })

  it('still serves a known project', async () => {
    const service = buildService(['p1'])
    expect(await service.loadHistory('p1')).toEqual([])
    await appendMessage(service, 'p1', QUESTION_MESSAGE)
    expect(await service.loadHistory('p1')).toEqual([QUESTION_MESSAGE])
    await service.clearHistory('p1')
    expect(await service.loadHistory('p1')).toEqual([])
  })
})
