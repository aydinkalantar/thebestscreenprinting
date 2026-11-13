// The merch agent's name for scripts in the browser (Admin › Settings › Max; "Max" by default).
// Base.astro puts it on <html data-agent>, and the edge keeps it current (src/worker.ts).
/** The invisible marks around the name in the built pages (src/lib/facts.mjs AGENT_MARK). */
const AGENT_MARK = '\u2060';

export function agentName(): string {
  if (typeof document === 'undefined') return 'Max';
  return (document.documentElement.dataset.agent || '').replaceAll(AGENT_MARK, '').trim() || 'Max';
}
