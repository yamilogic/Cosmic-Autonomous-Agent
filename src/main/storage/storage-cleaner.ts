import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { app, session } from 'electron'
import type {
  CleanStoragePayload,
  CleanStorageResult,
  PartitionStorageInfo,
  StorageSummaryResult
} from '../../shared/ipc-contract'
import { log } from '../logging'
import type { MonitorStore } from '../dashboard/monitor-store'
import type { ProfileStore } from '../profiles/profile-store'

const JUNK_SUBDIRS = new Set([
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'blob_storage',
  'Crashpad'
])

export async function getDirectorySize(
  dirPath: string,
  filterSubdir?: (subdirName: string) => boolean
): Promise<number> {
  let total = 0
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name)
      if (entry.isDirectory()) {
        if (filterSubdir && !filterSubdir(entry.name)) continue
        total += await getDirectorySize(fullPath)
      } else if (entry.isFile()) {
        const s = await stat(fullPath)
        total += s.size
      }
    }
  } catch {
    // missing or unreadable directory
  }
  return total
}

export class StorageCleanerService {
  constructor(
    private profileStore: ProfileStore,
    private monitorStore: MonitorStore
  ) {}

  private getPartitionsRootDir(): string {
    return join(app.getPath('userData'), 'Partitions')
  }

  async getStorageSummary(): Promise<StorageSummaryResult> {
    const rootDir = this.getPartitionsRootDir()
    const profiles = await this.profileStore.list()
    const projects = await this.monitorStore.listProjects()

    // Build map of known valid partitions
    const knownPartitions = new Map<
      string,
      { label: string; type: PartitionStorageInfo['type']; ownerName?: string }
    >()

    for (const p of profiles) {
      const pName = p.customName || p.displayName
      const isGlobal = p.isGlobalProfile || p.accountScope === 'global' || p.accountScope === 'both'
      const baseType: PartitionStorageInfo['type'] = isGlobal ? 'global' : 'profile'

      knownPartitions.set(`profile-${p.id}-slack`, {
        label: `${pName} • Slack`,
        type: baseType,
        ownerName: pName
      })
      knownPartitions.set(`profile_${p.id}`, {
        label: `${pName} • Slack (legacy)`,
        type: baseType,
        ownerName: pName
      })
      knownPartitions.set(`profile-${p.id}-teams`, {
        label: `${pName} • Teams`,
        type: baseType,
        ownerName: pName
      })
      knownPartitions.set(`profile-${p.id}-whatsapp`, {
        label: `${pName} • WhatsApp`,
        type: baseType,
        ownerName: pName
      })

      for (const link of p.customLinks ?? []) {
        if (link.partition) {
          const rawPart = link.partition.replace(/^persist:/, '')
          knownPartitions.set(rawPart, {
            label: `${pName} • ${link.name || link.url}`,
            type: 'custom_link',
            ownerName: pName
          })
        }
      }
    }

    for (const proj of projects) {
      knownPartitions.set(`card-${proj.id}-slack`, {
        label: `${proj.name} • Slack Session`,
        type: 'card',
        ownerName: proj.name
      })
    }

    let onDiskDirNames: string[] = []
    try {
      const entries = await readdir(rootDir, { withFileTypes: true })
      onDiskDirNames = entries.filter((e) => e.isDirectory()).map((e) => e.name)
    } catch {
      onDiskDirNames = []
    }

    const partitions: PartitionStorageInfo[] = []
    let totalDiskUsage = 0
    let totalCacheUsage = 0
    let orphanedCount = 0

    for (const dirName of onDiskDirNames) {
      const dirPath = join(rootDir, dirName)
      let totalSize = 0
      let cacheSize = 0
      let hasSession = false

      try {
        const entries = await readdir(dirPath, { withFileTypes: true })
        for (const entry of entries) {
          const entryPath = join(dirPath, entry.name)
          if (entry.isDirectory()) {
            const sz = await getDirectorySize(entryPath)
            totalSize += sz
            if (JUNK_SUBDIRS.has(entry.name)) {
              cacheSize += sz
            } else if (entry.name === 'Service Worker') {
              // Service Worker/CacheStorage is transient cache
              const csPath = join(entryPath, 'CacheStorage')
              const csSize = await getDirectorySize(csPath)
              cacheSize += csSize
            }
          } else if (entry.isFile()) {
            const st = await stat(entryPath)
            totalSize += st.size
            if (entry.name === 'Cookies' && st.size > 0) hasSession = true
          }
        }
      } catch {
        continue
      }

      totalDiskUsage += totalSize
      totalCacheUsage += cacheSize

      const known = knownPartitions.get(dirName)
      if (known) {
        partitions.push({
          id: dirName,
          partitionName: dirName,
          label: known.label,
          type: known.type,
          ownerName: known.ownerName,
          totalSizeBytes: totalSize,
          cacheSizeBytes: cacheSize,
          hasSession
        })
      } else {
        orphanedCount++
        partitions.push({
          id: dirName,
          partitionName: dirName,
          label: `Unlinked Partition (${dirName.slice(0, 24)}…)`,
          type: 'orphaned',
          totalSizeBytes: totalSize,
          cacheSizeBytes: cacheSize,
          hasSession
        })
      }
    }

    // Sort partitions by total size descending
    partitions.sort((a, b) => b.totalSizeBytes - a.totalSizeBytes)

    return {
      totalDiskUsageBytes: totalDiskUsage,
      totalCacheUsageBytes: totalCacheUsage,
      orphanedCount,
      partitions
    }
  }

  async cleanStorage(payload: CleanStoragePayload): Promise<CleanStorageResult> {
    const rootDir = this.getPartitionsRootDir()
    const targetIds = payload.partitionIds && payload.partitionIds.length > 0 ? new Set(payload.partitionIds) : null
    let freedBytes = 0
    let cleanedCount = 0

    // Measure pre-clean size
    const summaryBefore = await this.getStorageSummary()
    const candidates = summaryBefore.partitions.filter((p) => (targetIds ? targetIds.has(p.id) : true))

    for (const p of candidates) {
      const partKey = `persist:${p.partitionName}`
      const ses = session.fromPartition(partKey)

      if (payload.mode === 'full_reset') {
        // Complete wipe
        try {
          await ses.clearStorageData()
          await ses.clearCache()
          cleanedCount++
        } catch (err) {
          log.warn('Failed full reset on partition', { partKey, err })
        }
      } else {
        // Safe clean: HTTP cache, compiled code cache, and Service Worker CacheStorage
        try {
          await ses.clearCache()
          await ses.clearCodeCaches({})
          await ses.clearStorageData({
            storages: ['cachestorage', 'serviceworkers', 'shadercache']
          })
          cleanedCount++
        } catch (err) {
          log.warn('Failed safe clean on partition', { partKey, err })
        }
      }

      // If full reset or it is an orphaned directory and removeOrphaned is requested, delete folder from disk
      if ((payload.mode === 'full_reset' || payload.removeOrphaned) && p.type === 'orphaned') {
        try {
          const dirPath = join(rootDir, p.partitionName)
          await rm(dirPath, { recursive: true, force: true })
          cleanedCount++
        } catch (err) {
          log.warn('Failed to remove orphaned partition folder', { dir: p.partitionName, err })
        }
      }
    }

    // Measure post-clean size
    const summaryAfter = await this.getStorageSummary()
    freedBytes = Math.max(0, summaryBefore.totalDiskUsageBytes - summaryAfter.totalDiskUsageBytes)

    log.info('Storage cleaner finished', {
      mode: payload.mode,
      freedBytes,
      cleanedCount
    })

    return {
      ok: true,
      freedBytes,
      cleanedCount
    }
  }
}
