import { Buffer } from 'node:buffer'

/**
 * Parses raw file content into readable text for AI analysis.
 * Handles plain text, Markdown, CSV, JSON, and extracts clean text strings
 * from binary formats like DOCX/PDF when native format decoders are not present.
 */
export function extractTextFromBuffer(name: string, buffer: Buffer): string {
  const ext = (name.split('.').pop() || '').toLowerCase()

  // 1. Plain text, markdown, json, csv, code files
  if (['txt', 'md', 'markdown', 'json', 'csv', 'yaml', 'yml', 'tsv', 'xml', 'html'].includes(ext)) {
    return buffer.toString('utf-8').trim()
  }

  // 2. Binary documents (DOCX, PDF, RTF): extract clean UTF-8 text strings
  // Strip null bytes and non-printable control characters while preserving words and paragraphs
  const raw = buffer.toString('utf-8')
  const printable = raw.replace(/[^\x20-\x7E\r\n\t]/g, ' ')
  const chunks = printable
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !/^[0-9a-fA-F]{16,}$/.test(w))

  const cleanText = chunks.join(' ').replace(/\s{2,}/g, ' ').trim()
  if (cleanText.length > 50) {
    return cleanText.slice(0, 50000)
  }

  return `[Extracted Document: ${name} (${buffer.length} bytes)]`
}

