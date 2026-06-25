// Shared navigation taxonomy for the mission-control dashboard.
// Single source of truth consumed by NavDropdown (the "All Views" menu),
// the ViewCycler hotkeys (P164), and the Recently Shipped Rail route lookup (P163).

export interface NavItem {
  href: string
  label: string
  icon: string
}

export interface NavGroup {
  category: string
  color: string
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    category: 'Observability',
    color: '#22D3EE',
    items: [
      { href: '/feed', label: 'Project Feed', icon: '≣' },
      { href: '/galaxy', label: 'Galaxy Map', icon: '✵' },
      { href: '/nexus', label: 'Nexus Map', icon: '⬢' },
      { href: '/constellation', label: 'Fleet Constellation', icon: '✦' },
      { href: '/graph', label: 'Project Graph', icon: '⬡' },
      { href: '/timeline', label: 'Timeline', icon: '◫' },
      { href: '/memory-graph', label: 'Memory Graph', icon: '✦' },
      { href: '/memory-constellation', label: 'Memory Constellation', icon: '✶' },
      { href: '/knowledge', label: 'Knowledge', icon: '◈' },
      { href: '/flamegraph', label: 'Turn Flame Graph', icon: '▬' },
      { href: '/replay', label: 'Session Replay', icon: '⏮' },
      { href: '/ambient', label: 'Fleet Ambient', icon: '◌' },
      { href: '/ticker', label: 'Tool Call Ticker', icon: '▶' },
      { href: '/turns', label: 'Turn Volume', icon: '▦' },
      { href: '/gantt', label: 'Lifecycle Gantt', icon: '⊟' },
      { href: '/dependency-graph', label: 'Dependency Graph', icon: '⇢' },
      { href: '/lifecycle-heatmap', label: 'Lifecycle Heatmap', icon: '▦' },
      { href: '/topology', label: 'Fleet Topology', icon: '⬡' },
      { href: '/narrative', label: 'Narrative Timeline', icon: '◫' },
      { href: '/context-pressure', label: 'Context Pressure', icon: '◑' },
      { href: '/turn-quality', label: 'Turn Quality', icon: '▦' },
      { href: '/calendar', label: 'Fleet Calendar', icon: '◫' },
      { href: '/momentum', label: 'Momentum River', icon: '⇴' },
      { href: '/pulse', label: 'Fleet Pulse Radar', icon: '◎' },
      { href: '/memory-stream', label: 'Memory Stream', icon: '⇶' },
      { href: '/fleet-sunburst', label: 'Fleet Sunburst', icon: '◍' },
      { href: '/stuck-headroom', label: 'Stuck Headroom', icon: '⏱' },
      { href: '/context-eta', label: 'Context Fill ETA', icon: '◷' },
      { href: '/age-distribution', label: 'Age Distribution', icon: '▥' },
      { href: '/platform-matrix', label: 'Platform × State', icon: '▦' },
      { href: '/snapshot-scrubber', label: 'Snapshot Scrubber', icon: '⏯' },
      { href: '/pressure-ridgeline', label: 'Pressure Ridgeline', icon: '⋰' },
      { href: '/webhook-health', label: 'Webhook Health', icon: '⊶' },
      { href: '/freshness', label: 'Feed Freshness', icon: '◷' },
      { href: '/ekg', label: 'Fleet Activity EKG', icon: '♥' },
      { href: '/marquee', label: 'Fleet Vitals Marquee', icon: '⇆' },
      { href: '/attention-sankey', label: 'Attention Sankey', icon: '⇶' },
      { href: '/entity-graph', label: 'Unified Entity Graph', icon: '⬡' },
      { href: '/attention-clock', label: 'Attention Radial Clock', icon: '◷' },
      { href: '/command-bridge', label: 'Fleet Command Bridge', icon: '⌖' },
      { href: '/live-turns', label: 'Live Turn Activity Feed', icon: '◉' },
      { href: '/circuit-timeline', label: 'Circuit Breaker Timeline', icon: '⊘' },
      { href: '/turn-duration', label: 'Turn Duration Histogram', icon: '⏱' },
      { href: '/circuit-mttr', label: 'Circuit Breaker MTTR', icon: '⟳' },
      { href: '/message-heatmap', label: 'Message Volume Heatmap', icon: '▦' },
    ],
  },
  {
    category: 'Operations',
    color: '#F59E0B',
    items: [
      { href: '/pipeline', label: 'Specclaw Pipeline', icon: '⬒' },
      { href: '/canvas', label: 'Workflow Canvas', icon: '⊡' },
      { href: '/inject-templates', label: 'Inject Templates', icon: '◈' },
      { href: '/branches', label: 'Git Branches', icon: '⑂' },
      { href: '/broadcast', label: 'Broadcast', icon: '◉' },
      { href: '/audit', label: 'Audit Log', icon: '≡' },
      { href: '/commands', label: 'Fleet Commands', icon: '⌨' },
      { href: '/idle-fleet', label: 'Idle Fleet', icon: '◫' },
      { href: '/queue-board', label: 'Queue & Breakers', icon: '⇥' },
      { href: '/scheduler-history', label: 'Scheduler History', icon: '⏲' },
    ],
  },
  {
    category: 'Intelligence',
    color: '#A78BFA',
    items: [
      { href: '/goals', label: 'Goals', icon: '◎' },
      { href: '/goal-stream', label: 'Goal Stream', icon: '⇶' },
      { href: '/metrics', label: 'Metrics', icon: '◱' },
      { href: '/cost', label: 'Fleet Cost', icon: '$' },
      { href: '/burn-rate', label: 'Burn Rate', icon: '⥮' },
      { href: '/anomalies', label: 'Anomaly Detection', icon: '⚠' },
      { href: '/health-trends', label: 'Health Trends', icon: '↗' },
      { href: '/reports', label: 'Weekly Report', icon: '◻' },
      { href: '/digest', label: 'Fleet Digest', icon: '◈' },
      { href: '/advisor', label: 'Fleet Advisor', icon: '◆' },
      { href: '/similarity', label: 'Memory Similarity', icon: '⬡' },
      { href: '/memory-audit', label: 'Memory Audit', icon: '≡' },
      { href: '/memory-decay', label: 'Memory Decay', icon: '◑' },
      { href: '/compare', label: 'Project Compare', icon: '⇌' },
      { href: '/command-center', label: 'Command Center', icon: '⌖' },
      { href: '/scoreboard', label: 'Attention Scoreboard', icon: '◆' },
      { href: '/heat-strip', label: 'Attention Heat Strip', icon: '▤' },
      { href: '/goal-funnel', label: 'Goal Funnel', icon: '⧗' },
      { href: '/vitals', label: 'Project Vitals', icon: '◈' },
      { href: '/convergence-budget', label: 'Convergence vs Budget', icon: '⊹' },
      { href: '/memory-convergence', label: 'Memory vs Convergence', icon: '⊕' },
      { href: '/proposal-graph', label: 'Proposal Graph', icon: '◎' },
      { href: '/sequence', label: 'Mission Sequence', icon: '▷' },
      { href: '/goal-radar', label: 'Goal Radar', icon: '◎' },
      { href: '/proposal-velocity', label: 'Proposal Velocity', icon: '◈' },
      { href: '/memory-health', label: 'Memory Health', icon: '◑' },
      { href: '/goal-heatmap', label: 'Goal Heatmap', icon: '▦' },
      { href: '/capability-map', label: 'Capability Map', icon: '⊞' },
      { href: '/scorecard', label: 'Health Scorecard', icon: '⊕' },
      { href: '/turn-correlation', label: 'Turn Correlation', icon: '⊹' },
      { href: '/proposal-flow', label: 'Proposal Flow', icon: '⟿' },
      { href: '/momentum-index', label: 'Momentum Index', icon: '◔' },
      { href: '/burndown', label: 'Backlog Burndown', icon: '◣' },
      { href: '/burnup', label: 'Proposal Burnup', icon: '◥' },
      { href: '/themes', label: 'Proposal Themes', icon: '⊞' },
      { href: '/forecast', label: 'Velocity Forecast', icon: '⤳' },
      { href: '/memory-footprint', label: 'Memory Footprint', icon: '⊞' },
      { href: '/convergence-wall', label: 'Convergence Wall', icon: '◎' },
      { href: '/convergence-dist', label: 'Convergence Distribution', icon: '▥' },
      { href: '/convergence-trend', label: 'Convergence Trend', icon: '↗' },
      { href: '/convergence-forecast', label: 'Convergence Forecast', icon: '⤳' },
      { href: '/convergence-movers', label: 'Convergence Movers', icon: '⇅' },
      { href: '/convergence-risk', label: 'Convergence × Context Risk', icon: '⊠' },
      { href: '/quadrant', label: 'Quadrant Map', icon: '⊞' },
      { href: '/alert-calendar', label: 'Alert Calendar', icon: '▦' },
      { href: '/budget-pressure', label: 'Budget Pressure', icon: '▰' },
      { href: '/proposal-aging', label: 'Proposal Aging', icon: '◴' },
      { href: '/sparkline-wall', label: 'Sparkline Wall', icon: '⋀' },
      { href: '/alert-flow', label: 'Alert Type Flow', icon: '⇄' },
      { href: '/alert-sla', label: 'Alert Response Time', icon: '⏲' },
      { href: '/impact', label: 'Proposal Impact Trace', icon: '⊶' },
      { href: '/memory-convergence-xy', label: 'Memory × Convergence', icon: '⊕' },
      { href: '/brief', label: 'Fleet Brief', icon: '◳' },
      { href: '/signal-timeline', label: 'Attention Signal Timeline', icon: '▦' },
      { href: '/signal-graph', label: 'Signal Co-occurrence Graph', icon: '⬡' },
      { href: '/memory-bridge', label: 'Memory ⇄ Proposal Bridge', icon: '⇄' },
      { href: '/schedule-history', label: 'Schedule History', icon: '⏱' },
      { href: '/command-log', label: 'Operator Command Log', icon: '≡' },
      { href: '/context-horizon', label: 'Context Runway', icon: '◷' },
      { href: '/memory-distribution', label: 'Memory Type Distribution', icon: '◍' },
      { href: '/fleet-timeline', label: 'Fleet Operational Timeline', icon: '◫' },
      { href: '/token-race', label: 'Token Budget Burn Comparison', icon: '⇌' },
      { href: '/session-health-calendar', label: 'Session Health Calendar', icon: '▦' },
      { href: '/idle-recovery', label: 'Idle Recovery Tracker', icon: '◉' },
      { href: '/tool-frequency', label: 'Tool Call Frequency', icon: '⊞' },
      { href: '/backlog-coverage', label: 'Proposal Coverage Heatmap', icon: '▦' },
      { href: '/agent-tree', label: 'Agent Spawn Tree', icon: '⑂' },
      { href: '/memory-staleness', label: 'Memory Staleness Radar', icon: '◎' },
      { href: '/tool-cooccurrence', label: 'Tool Co-occurrence Matrix', icon: '⊠' },
      { href: '/backlog-forecast', label: 'Backlog Completion Forecast', icon: '⤳' },
    ],
  },
  {
    category: 'Admin',
    color: '#6B7280',
    items: [
      { href: '/permissions', label: 'Permissions', icon: '⊛' },
      { href: '/project-config', label: 'Project Config', icon: '⚙' },
      { href: '/search', label: 'Search', icon: '⌕' },
      { href: '/admin', label: 'Admin', icon: '⚙' },
    ],
  },
]

/** All nav items flattened, in category order. */
export function flattenNavItems(): NavItem[] {
  return NAV_GROUPS.flatMap((g) => g.items)
}

/** The category whose items include the given pathname, or null if none. */
export function categoryForPath(pathname: string): NavGroup | null {
  return NAV_GROUPS.find((g) => g.items.some((i) => i.href === pathname)) ?? null
}

// Normalise a title/label into a set of comparable tokens: lowercase,
// split on non-alphanumerics, drop empties, strip a single trailing 's'
// so "Themes" ↔ "Theme" match.
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t))
}

/**
 * Resolve a backlog proposal title to its dashboard route by matching against
 * NAV_GROUPS labels. A nav item matches only when *every* token of its label
 * appears in the title — guaranteeing no dead links. When several match, the
 * most specific (most label tokens) wins. Returns null when nothing matches.
 */
export function findRouteForTitle(title: string): NavItem | null {
  const titleTokens = new Set(tokenize(title))
  let best: NavItem | null = null
  let bestScore = 0
  for (const item of flattenNavItems()) {
    const labelTokens = tokenize(item.label)
    if (labelTokens.length === 0) continue
    const allPresent = labelTokens.every((t) => titleTokens.has(t))
    if (allPresent && labelTokens.length > bestScore) {
      best = item
      bestScore = labelTokens.length
    }
  }
  return best
}
