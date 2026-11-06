import { ScrapeLogExplorer } from './RunLogsModal'

export function ScrapeLogsTab(): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', minHeight: 0 }}>
      <header>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#f8fafc' }}>
          🕷️ Scrape Logs
        </h3>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: '#94a3b8' }}>
          Every manual and scheduled scrape, with channel-level results, people, windows, and
          history gaps. Live runs can be stopped here.
        </p>
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ScrapeLogExplorer showProjectColumn />
      </div>
    </div>
  )
}
