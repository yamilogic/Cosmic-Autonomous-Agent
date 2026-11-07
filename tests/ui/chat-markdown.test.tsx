// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import ChatMarkdown from '../../src/renderer/src/components/dashboard/ChatMarkdown'

afterEach(cleanup)

function renderMarkdown(text: string): HTMLElement {
  return render(<ChatMarkdown text={text} />).container
}

describe('ChatMarkdown', () => {
  it('renders raw HTML as text and never creates script or img nodes', () => {
    const container = renderMarkdown('<script>alert("xss")</script> <img src=x onerror="alert(1)">')

    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<script>alert("xss")</script>')
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">')
  })

  it('does not turn javascript: or data: links into anchors', () => {
    const container = renderMarkdown(
      '[js](javascript:alertDoc) [data](data:text/html;base64,PHNjcmlwdD4=)'
    )

    expect(container.querySelectorAll('a')).toHaveLength(0)
    expect(container.textContent).toContain('[js](javascript:alertDoc)')
    expect(container.textContent).toContain('[data](data:text/html;base64,PHNjcmlwdD4=)')
  })

  it('leaves relative and mailto links as plain text', () => {
    const container = renderMarkdown('[local](/admin) [mail](mailto:test@example.com)')

    expect(container.querySelectorAll('a')).toHaveLength(0)
    expect(container.textContent).toContain('[local](/admin)')
    expect(container.textContent).toContain('[mail](mailto:test@example.com)')
  })

  it('allows http(s) links with safe rel and target', () => {
    const container = renderMarkdown(
      '[docs](https://example.com/docs) and [plain](http://example.com)'
    )
    const anchors = [...container.querySelectorAll('a')]

    expect(anchors).toHaveLength(2)
    expect(anchors[0]).toMatchObject({
      href: 'https://example.com/docs',
      target: '_blank',
      rel: 'noreferrer noopener'
    })
    expect(anchors[0].textContent).toBe('docs')
    expect(anchors[1].getAttribute('href')).toBe('http://example.com/')
  })

  it('keeps markup inside link text as text', () => {
    const container = renderMarkdown('[<img src=x onerror=alert(1)>](https://example.com)')

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('a')?.textContent).toBe('<img src=x onerror=alert(1)>')
  })

  it('renders fenced code without interpreting its contents', () => {
    const container = renderMarkdown('```ts\nconst x = "<script>alert(1)</script>"\n```')

    const pre = container.querySelector('pre')
    expect(pre).not.toBeNull()
    expect(pre?.getAttribute('data-lang')).toBe('ts')
    expect(pre?.textContent).toBe('const x = "<script>alert(1)</script>"')
    expect(container.querySelector('script')).toBeNull()
  })

  it('renders headings, bold, italics, inline code and both list kinds', () => {
    const container = renderMarkdown(
      [
        '# Title',
        'Some **bold** and *italic* with `code`.',
        '- one',
        '- two',
        '1. first',
        '2. second'
      ].join('\n')
    )

    expect(container.querySelector('h4')?.textContent).toBe('Title')
    expect(container.querySelector('strong')?.textContent).toBe('bold')
    expect(container.querySelector('em')?.textContent).toBe('italic')
    expect(container.querySelector('code')?.textContent).toBe('code')
    expect([...container.querySelectorAll('ul li')].map((li) => li.textContent)).toEqual([
      'one',
      'two'
    ])
    expect([...container.querySelectorAll('ol li')].map((li) => li.textContent)).toEqual([
      'first',
      'second'
    ])
  })

  it('keeps line breaks inside a paragraph', () => {
    const container = renderMarkdown('line one\nline two')

    expect(container.querySelector('p')?.textContent).toBe('line oneline two')
    expect(container.querySelectorAll('br')).toHaveLength(1)
  })
})
