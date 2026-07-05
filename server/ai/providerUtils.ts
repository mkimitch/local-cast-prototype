import type {BriefingSection, SourceItem} from '../../src/types';

const sectionTypes: BriefingSection['type'][] = ['intro', 'news_summary', 'deep_dive', 'outro'];

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const isSectionType = (value: unknown): value is BriefingSection['type'] => (
  typeof value === 'string' && sectionTypes.includes(value as BriefingSection['type'])
);

const stringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
};

const score = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.max(1, Math.min(10, Math.round(value)));
};

export const sourceItemsForPrompt = (items: SourceItem[]): string => {
  if (items.length === 0) {
    return 'No source items were available. Generate a short placeholder briefing that says no active source items were found.';
  }

  return items.map(item => [
    `Item ID: ${item.id}`,
    `Source ID: ${item.sourceId}`,
    `Title: ${item.title}`,
    `Content: ${item.content}`,
    item.url ? `URL: ${item.url}` : undefined,
  ].filter(Boolean).join('\n')).join('\n\n');
};

export const fallbackSections = (items: SourceItem[], summary: string): BriefingSection[] => {
  const sourceItemIds = items.map(item => item.id);

  return [
    {
      id: `sec-intro-${Date.now()}`,
      title: 'Introduction',
      type: 'intro',
      spokenText: 'Welcome to your LocalCast briefing. We gathered the latest available items from your selected sources.',
      sourceItemIds: [],
      importanceScore: 5,
      followUpPrompts: [],
    },
    {
      id: `sec-summary-${Date.now()}`,
      title: 'Source Summary',
      type: 'news_summary',
      spokenText: summary,
      sourceItemIds,
      importanceScore: 7,
      followUpPrompts: ['Which source should I prioritize next?', 'What changed since the last briefing?'],
    },
    {
      id: `sec-outro-${Date.now()}`,
      title: 'Wrap-up',
      type: 'outro',
      spokenText: 'That is the end of this briefing. Check the referenced sources for more detail.',
      sourceItemIds: [],
      importanceScore: 4,
      followUpPrompts: [],
    },
  ];
};

export const coerceBriefingSections = (value: unknown, items: SourceItem[], summary: string): BriefingSection[] => {
  if (!Array.isArray(value)) return fallbackSections(items, summary);

  const sections = value.reduce<BriefingSection[]>((acc, item, index) => {
    if (!isRecord(item)) return acc;

    const title = typeof item.title === 'string' && item.title.trim() ? item.title : `Section ${index + 1}`;
    const spokenText = typeof item.spokenText === 'string' && item.spokenText.trim() ? item.spokenText : summary;

    acc.push({
      id: typeof item.id === 'string' && item.id.trim() ? item.id : `sec-api-${Date.now()}-${index}`,
      title,
      type: isSectionType(item.type) ? item.type : 'deep_dive',
      spokenText,
      sourceItemIds: stringArray(item.sourceItemIds),
      importanceScore: score(item.importanceScore, 6),
      followUpPrompts: stringArray(item.followUpPrompts).slice(0, 4),
    });

    return acc;
  }, []);

  return sections.length > 0 ? sections : fallbackSections(items, summary);
};

export const parseSectionsFromText = (text: string, items: SourceItem[], summary: string): BriefingSection[] => {
  const stripped = text.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  const start = stripped.indexOf('[');
  const end = stripped.lastIndexOf(']');
  const candidate = start >= 0 && end > start ? stripped.slice(start, end + 1) : stripped;

  try {
    return coerceBriefingSections(JSON.parse(candidate), items, summary);
  } catch {
    return fallbackSections(items, text || summary);
  }
};
