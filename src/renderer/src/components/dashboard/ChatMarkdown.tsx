import React from 'react'

/**
 * A deliberately small Markdown renderer for assistant answers. It never uses
 * dangerouslySetInnerHTML and only links to http(s), so model output can never
 * inject markup or run script.
 */

const SAFE_SCHEME = /^https?:\/\//i

function safeHref(raw: string): string | null {
  const trimmed = raw.trim()
  if (!SAFE_SCHEME.test(trimmed)) return null
  try {
    const url = new URL(trimmed)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

const INLINE_RE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(\[[^\]\n]+\]\([^()\s]+\))/g

function inline(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let last = 0
  let index = 0
  let match: RegExpExecArray | null
  INLINE_RE.lastIndex = 0
  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index))
    const token = match[0]
    const key = `${keyPrefix}-i${index++}`
    if (token.startsWith('`')) {
      out.push(
        <code className="chat-md-code" key={key}>
          {token.slice(1, -1)}
        </code>
      )
    } else if (token.startsWith('**') || token.startsWith('__')) {
      out.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('*') || token.startsWith('_')) {
      out.push(<em key={key}>{token.slice(1, -1)}</em>)
    } else {
      const link = /^\[([^\]]+)\]\(([^()\s]+)\)$/.exec(token)
      const href = link ? safeHref(link[2]) : null
      if (link && href) {
        out.push(
          <a href={href} key={key} rel="noreferrer noopener" target="_blank">
            {link[1]}
          </a>
        )
      } else {
        out.push(token)
      }
    }
    last = match.index + token.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function paragraph(lines: string[], key: string): React.ReactNode {
  const nodes: React.ReactNode[] = []
  lines.forEach((line, index) => {
    if (index > 0) nodes.push(<br key={`${key}-br${index}`} />)
    nodes.push(...inline(line, `${key}-l${index}`))
  })
  return <p key={key}>{nodes}</p>
}

export default function ChatMarkdown({ text }: { text: string }): React.ReactElement {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: React.ReactNode[] = []
  let index = 0
  let key = 0

  while (index < lines.length) {
    const line = lines[index]

    if (/^\s*```/.test(line)) {
      const lang = line.replace(/^\s*```/, '').trim()
      const body: string[] = []
      index++
      while (index < lines.length && !/^\s*```/.test(lines[index])) {
        body.push(lines[index])
        index++
      }
      if (index < lines.length) index++
      blocks.push(
        <pre className="chat-md-pre" data-lang={lang || undefined} key={key++}>
          <code>{body.join('\n')}</code>
        </pre>
      )
      continue
    }

    if (!line.trim()) {
      index++
      continue
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    if (heading) {
      const level = heading[1].length
      const content = inline(heading[2], `h${key}`)
      blocks.push(
        level === 1 ? (
          <h4 key={key++}>{content}</h4>
        ) : level === 2 ? (
          <h5 key={key++}>{content}</h5>
        ) : (
          <h6 key={key++}>{content}</h6>
        )
      )
      index++
      continue
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: React.ReactNode[] = []
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        const itemText = lines[index].replace(/^\s*[-*+]\s+/, '')
        items.push(
          <li key={`li${key}-${items.length}`}>{inline(itemText, `li${key}-${items.length}`)}</li>
        )
        index++
      }
      blocks.push(<ul key={key++}>{items}</ul>)
      continue
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: React.ReactNode[] = []
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        const itemText = lines[index].replace(/^\s*\d+[.)]\s+/, '')
        items.push(
          <li key={`li${key}-${items.length}`}>{inline(itemText, `li${key}-${items.length}`)}</li>
        )
        index++
      }
      blocks.push(<ol key={key++}>{items}</ol>)
      continue
    }

    const body: string[] = []
    while (index < lines.length) {
      const next = lines[index]
      if (
        !next.trim() ||
        /^\s*```/.test(next) ||
        /^(#{1,3})\s+/.test(next) ||
        /^\s*[-*+]\s+/.test(next) ||
        /^\s*\d+[.)]\s+/.test(next)
      ) {
        break
      }
      body.push(next)
      index++
    }
    blocks.push(paragraph(body, `p${key++}`))
  }

  return <div className="chat-md">{blocks}</div>
}
