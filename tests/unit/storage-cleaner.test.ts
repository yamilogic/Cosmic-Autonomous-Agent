import { describe, expect, it } from 'vitest'
import { getDirectorySize } from '../../src/main/storage/storage-cleaner'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('storage-cleaner unit tests', () => {
  it('correctly calculates directory size and filters subdirectories', async () => {
    const testDir = join(tmpdir(), `orbit-storage-test-${Date.now()}`)
    await mkdir(join(testDir, 'Cache'), { recursive: true })
    await mkdir(join(testDir, 'Storage'), { recursive: true })

    await writeFile(join(testDir, 'Cache', 'data.bin'), Buffer.alloc(1024))
    await writeFile(join(testDir, 'Storage', 'cookie.sqlite'), Buffer.alloc(2048))

    const fullSize = await getDirectorySize(testDir)
    expect(fullSize).toBe(3072)

    const cacheOnlySize = await getDirectorySize(testDir, (name) => name === 'Cache')
    expect(cacheOnlySize).toBe(1024)

    await rm(testDir, { recursive: true, force: true })
  })
})

