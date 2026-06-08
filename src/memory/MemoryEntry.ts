export type EntryType = 'decision' | 'pattern' | 'risk' | 'event' | 'problem' | 'workflow';

export const ENTRY_TYPE_LABELS: Record<EntryType, string> = {
  decision: '🔵 Decisão',
  pattern:  '🟢 Padrão',
  risk:     '🔴 Risco',
  event:    '🟡 Evento',
  problem:  '🟠 Problema',
  workflow: '⚪ Workflow',
};

export interface MemoryEntry {
  id:      string;
  type:    EntryType;
  title:   string;
  content: string;
  tags:    string[];
  related: string[];
  date:    string;
}
