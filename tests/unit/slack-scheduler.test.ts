import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RunLogStore, type RunLogEntry } from '../../src/main/dashboard/run-log-store'

describe('Scheduler & Run Log Store (SLK-3)', () => {
  let dir: string
  let logStore: RunLogStore

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'orbit-run-logs-'))
    logStore = new RunLogStore({ rootDir: dir })
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('appends and reads back run log entries in reverse chronological order', async () => {
    const entry1: RunLogEntry = {
      runId: 'run-1',
      ts: new Date(Date.now() - 60000).toISOString(),
      startedAt: new Date(Date.now() - 60000).toISOString(),
      trigger: 'scheduled',
      projectId: 'proj_1',
      projectName: 'Project 1',
      sourceId: 'src_1',
      sourceKind: 'browser',
      workspaceId: 'T123',
      workspaceName: 'Acme',
      channelsRead: 2,
      newMessages: 5,
      durationMs: 1200,
      llmCalls: 1,
      window: { startTs: '0', endTs: '1', backfillHours: 6 },
      channels: [],
      people: [],
      filters: { includeKinds: ['public'] },
      status: 'success'
    }

    const entry2: RunLogEntry = {
      runId: 'run-2',
      ts: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      trigger: 'manual',
      projectId: 'proj_1',
      projectName: 'Project 1',
      sourceId: 'src_1',
      sourceKind: 'browser',
      workspaceId: 'T123',
      workspaceName: 'Acme',
      channelsRead: 2,
      newMessages: 0,
      durationMs: 400,
      llmCalls: 0,
      window: { startTs: '0', endTs: '1', backfillHours: 6 },
      channels: [],
      people: [],
      filters: { includeKinds: ['public'] },
      status: 'success'
    }

    await logStore.append(entry1)
    await logStore.append(entry2)

    const logs = await logStore.read('proj_1')
    expect(logs).toHaveLength(2)
    expect(logs[0]!.runId).toBe('run-2')
    expect(logs[1]!.runId).toBe('run-1')
    expect(logs[0]!.llmCalls).toBe(0)
    expect(logs[0]!.status).toBe('success')
  })

  it('readMany filters across cards by status, trigger, and limit', async () => {
    const base: RunLogEntry = {
      runId: 'run-a',
      ts: new Date(Date.now() - 60000).toISOString(),
      startedAt: new Date(Date.now() - 60000).toISOString(),
      trigger: 'manual',
      projectId: 'proj_1',
      projectName: 'Project 1',
      sourceId: 'src_1',
      sourceKind: 'browser',
      workspaceId: 'T1',
      workspaceName: 'Acme',
      channelsRead: 1,
      newMessages: 0,
      window: { startTs: '0', endTs: '1', backfillHours: 6 },
      channels: [],
      people: [],
      filters: { includeKinds: ['public'] },
      durationMs: 100,
      llmCalls: 0,
      status: 'error',
      error: 'boom'
    }
    await logStore.append(base)
    await logStore.append({
      ...base,
      runId: 'run-b',
      ts: new Date().toISOString(),
      trigger: 'scheduled',
      projectId: 'proj_2',
      status: 'success',
      error: undefined
    })

    const errors = await logStore.readMany(['proj_1', 'proj_2'], { status: 'error' })
    expect(errors.map((entry) => entry.runId)).toEqual(['run-a'])

    const scheduled = await logStore.readMany(['proj_1', 'proj_2'], {
      trigger: 'scheduled'
    })
    expect(scheduled.map((entry) => entry.runId)).toEqual(['run-b'])

    const limited = await logStore.readMany(['proj_1', 'proj_2'], { limit: 1 })
    expect(limited).toHaveLength(1)
    expect(limited[0]!.runId).toBe('run-b')
  })

  it('returns empty array when no log exists for project', async () => {
    const logs = await logStore.read('proj_nonexistent')
    expect(logs).toEqual([])
  })
})
