// 头号写手 v2：确定性增强模块（去AI味词表/节奏曲线/文风指纹/变更提取/指南库）
import {
  auditAiTaste,
  analyzePacing,
  deAiPolish,
  styleFingerprint,
  WRITING_GUIDES,
} from './writer-v2.ts';

export type ChapterMapItem = {
  label: string;
  startOffset: number;
  endOffset: number;
  characterCount: number;
  dialogueRatio: number;
  hookScore: number;
  signals: string[];
};

export type EvidenceCandidate = {
  chapterLabel: string;
  startOffset: number;
  endOffset: number;
  excerpt: string;
  score: number;
  reasons: string[];
};

export type TechniqueCandidate = {
  title: string;
  confidence: number;
  evidenceIndexes: number[];
  content: {
    applicableWhen: string;
    formula: string;
    expectedEffect: string;
    avoidWhen: string;
  };
};

export type AnalysisResult = {
  chapters: ChapterMapItem[];
  evidence: EvidenceCandidate[];
  techniques: TechniqueCandidate[];
  insights: AnalysisInsight[];
};

export type AnalysisInsight = {
  kind: 'structure' | 'character' | 'core' | 'material' | 'continuity';
  title: string;
  confidence: number;
  evidenceIndexes: number[];
  content: {
    rule: string;
    detail: string;
    application: string;
    avoidWhen: string;
  };
};

export type ReviewFinding = {
  reviewType: 'basic' | 'expert';
  dimension: string;
  severity: 'info' | 'warning' | 'error';
  startOffset?: number;
  endOffset?: number;
  message: string;
  suggestion: string;
  memoryCandidate?: { kind: 'weakness'; title: string; rule: string };
};

export type CharacterPrompt = {
  id?: string;
  name: string;
  role: string;
  goal: string;
  conflict: string;
};

export type WritingBrief = {
  title: string;
  outline: string;
  inspiration: string;
  worldSetting: string;
  characters: CharacterPrompt[];
  plotDirection: string;
  chapterTitle: string;
  chapterGoal: string;
  pointOfView: string;
  tone: string;
  constraints: string[];
  targetLength: number;
  useMemories: boolean;
};

export type CompiledWritingPrompt = {
  role: string;
  priorities: string[];
  assembled: string;
};

export type BrainMemory = {
  id?: string;
  kind:
    | 'weakness'
    | 'material'
    | 'structure'
    | 'character'
    | 'core'
    | 'continuity';
  title: string;
  content: {
    rule?: string;
    suggestedFix?: string;
    detail?: string;
    application?: string;
    avoidWhen?: string;
  };
};

export type MechanismTrace = {
  name: string;
  stages: string[];
  draft: string;
  polished: string;
  findingsBefore: ReviewFinding[];
  findingsAfter: ReviewFinding[];
  appliedChanges: string[];
  memoryTitles: string[];
};

export type ContinuityKind =
  | 'storyline'
  | 'foreshadow'
  | 'character'
  | 'relationship'
  | 'environment'
  | 'detail';

export type ContinuityItem = {
  id: string;
  kind: ContinuityKind;
  title: string;
  description: string;
  currentState: string;
  changeRule?: string;
  status: 'active' | 'resolved' | 'parked';
  importance: 'critical' | 'major' | 'minor';
  introducedSequence: number;
  targetSequence?: number;
  resolvedSequence?: number;
  lastTouchedSequence: number;
  mentionCount: number;
  keywords: string[];
  evolution: Array<{ sequence: number; note: string }>;
};

export type ContinuityAuditFinding = {
  itemId: string;
  dimension: '连续性' | '伏笔兑现' | '状态突变' | '动态成长';
  severity: 'info' | 'warning';
  message: string;
  suggestion: string;
  mentioned: boolean;
  autoResolved?: boolean;
};

export type ContinuityFeedback = {
  sequence: number;
  status: 'passed' | 'needs-attention';
  summary: string;
  warningCount: number;
  touchedItemIds: string[];
};

export const MIN_CHAPTER_LENGTH = 3500;
export const MAX_CHAPTER_LENGTH = 4500;
export const DEFAULT_CHAPTER_LENGTH = 4000;

const continuityKindLabels: Record<ContinuityKind, string> = {
  storyline: '故事线',
  foreshadow: '伏笔/包袱',
  character: '人物习惯与状态',
  relationship: '人物关系',
  environment: '环境状态',
  detail: '关键细节',
};

function continuityCadence(item: ContinuityItem) {
  const importanceCadence =
    item.importance === 'critical' ? 3 : item.importance === 'major' ? 5 : 8;
  if (!item.targetSequence) return importanceCadence;
  return Math.max(
    2,
    Math.min(importanceCadence, item.targetSequence - item.introducedSequence),
  );
}

function continuityTokens(item: ContinuityItem) {
  const stateTokens = item.currentState.match(/[\p{Script=Han}]{2,8}/gu) ?? [];
  const titleTokens = item.title.split(/[｜：:·\s]/u);
  return [
    ...item.keywords,
    ...titleTokens,
    ...(item.keywords.length ? [] : stateTokens.slice(0, 5)),
  ]
    .map((item) => item.trim())
    .filter(
      (item) =>
        item.length >= 2 &&
        !/^(?:作者修正|作者想法|全书主线|行为基线|世界环境基线|章尾承诺)$/u.test(
          item,
        ),
    );
}

export function buildContinuityPrompt(
  items: ContinuityItem[],
  nextSequence: number,
) {
  const active = items
    .filter((item) => item.status === 'active')
    .sort((a, b) => {
      const aDue = a.targetSequence ? a.targetSequence - nextSequence : 999;
      const bDue = b.targetSequence ? b.targetSequence - nextSequence : 999;
      const weight = { critical: 0, major: 1, minor: 2 };
      return aDue - bDue || weight[a.importance] - weight[b.importance];
    })
    .slice(0, 16);
  if (!active.length) return [];
  return [
    '【作品连续性账本】以下是本作品独有的当前事实，不得与其他作品混用。',
    ...active.map((item) => {
      const due = item.targetSequence
        ? item.targetSequence <= nextSequence
          ? `本章已进入兑现窗口（目标第 ${item.targetSequence} 章）`
          : `计划第 ${item.targetSequence} 章附近兑现`
        : `按需触达，最近第 ${item.lastTouchedSequence || item.introducedSequence} 章出现`;
      return `${continuityKindLabels[item.kind]}｜${item.title}｜当前事实=${item.currentState || item.description}｜变化条件=${item.changeRule || '如需改变，必须先写出可见原因、人物反应和后果'}｜${due}`;
    }),
    '连续性规则：标题以“作者修正”开头的记录优先级最高；不是每条线索每章都要出现，只在当前场景相关、临近兑现或久未触达时自然提及。人物和环境允许变化，但变化必须经过原因、反应、新状态三个步骤。伏笔兑现要回扣早期细节并改变当下选择，不能只用旁白解释答案。',
  ];
}

export function buildContinuityFeedback(
  content: string,
  findings: ContinuityAuditFinding[],
  sequence: number,
): ContinuityFeedback {
  const paragraphs = content
    .split(/\n\s*\n/u)
    .map((item) => item.trim())
    .filter(Boolean);
  const ending = paragraphs.slice(-2).join(' ');
  const summary = ending.length > 320 ? `…${ending.slice(-319)}` : ending;
  const warningCount = findings.filter(
    (item) => item.severity === 'warning',
  ).length;
  return {
    sequence,
    status: warningCount ? 'needs-attention' : 'passed',
    summary: summary || '本章没有可提取的接续正文。',
    warningCount,
    touchedItemIds: [
      ...new Set(
        findings.filter((item) => item.mentioned).map((item) => item.itemId),
      ),
    ],
  };
}

export function captureChapterPromise(content: string, sequence: number) {
  const hook = inspectEnding(content);
  if (hook.score < 3) return null;
  const lastParagraph =
    content
      .split(/\n\s*\n/u)
      .map((item) => item.trim())
      .filter(Boolean)
      .at(-1) ?? '';
  if (!lastParagraph) return null;
  const keywords = [
    ...new Set(
      (lastParagraph.match(/[\p{Script=Han}]{2,12}/gu) ?? []).flatMap(
        (chunk) => {
          if (chunk.length <= 4) return [chunk];
          return [chunk.slice(0, 4), chunk.slice(-4)];
        },
      ),
    ),
  ]
    .filter(
      (item) =>
        !continuityStopPhrases.has(item) &&
        !/^[的了是在有和也都而又将把被与就还只很着过让给从对向于]+$/u.test(
          item,
        ),
    )
    .slice(0, 6);
  return {
    kind: 'foreshadow' as const,
    title: `第 ${sequence} 章章尾承诺`,
    description: '机制根据章尾的信息缺口或未完成行动自动登记。',
    currentState: `第 ${sequence} 章留下待回应的信息：${lastParagraph.slice(-240)}`,
    changeRule:
      '后续正文给出明确回应，并让答案改变人物理解、关系或下一步行动后才算兑现。',
    importance: 'major' as const,
    introducedSequence: sequence,
    targetSequence: sequence + 2,
    keywords,
  };
}

export function auditContinuity(
  content: string,
  items: ContinuityItem[],
  sequence: number,
): ContinuityAuditFinding[] {
  const findings: ContinuityAuditFinding[] = [];
  for (const item of items.filter((item) => item.status === 'active')) {
    const mentioned = continuityTokens(item).some((token) =>
      content.includes(token),
    );
    const lastTouched = item.lastTouchedSequence || item.introducedSequence;
    const chaptersSinceTouch = Math.max(0, sequence - lastTouched);
    const due = Boolean(item.targetSequence && sequence >= item.targetSequence);
    if (mentioned) {
      const payoffHasAnswer =
        /原来|真相|揭开|揭示|答案|来自|意味着|终于明白|证实/gu.test(content);
      const payoffHasConsequence =
        /于是|因此|决定|转身|拒绝|相信|改变|交给|拿起|推开|离开/gu.test(
          content,
        );
      const autoResolved =
        item.kind === 'foreshadow' &&
        due &&
        payoffHasAnswer &&
        payoffHasConsequence;
      findings.push({
        itemId: item.id,
        dimension: item.kind === 'foreshadow' ? '伏笔兑现' : '连续性',
        severity: 'info',
        message: autoResolved
          ? `“${item.title}”在本章完成揭示并产生行动后果，机制已判定兑现。`
          : `本章触达了“${item.title}”。`,
        suggestion: autoResolved
          ? '后续仍可回扣它造成的关系或局势变化，但不必重复解释答案。'
          : item.kind === 'foreshadow' && due
            ? '这只是触达，不自动等同于填坑；机制会继续跟踪它是否真正改变人物理解或选择。'
            : '确认这次提及带来新信息、关系变化或行动后果，避免机械点名。',
        mentioned: true,
        autoResolved,
      });
    } else if (due) {
      findings.push({
        itemId: item.id,
        dimension: item.kind === 'foreshadow' ? '伏笔兑现' : '连续性',
        severity: 'warning',
        message: `“${item.title}”已到第 ${item.targetSequence} 章兑现窗口，本章没有触达。`,
        suggestion:
          '若有意延后，请向机制补充新的兑现安排；否则让它以行动后果或新证据回到正文。',
        mentioned: false,
      });
    } else if (chaptersSinceTouch >= continuityCadence(item)) {
      findings.push({
        itemId: item.id,
        dimension: '连续性',
        severity: 'warning',
        message: `“${item.title}”已连续 ${chaptersSinceTouch} 章未触达。`,
        suggestion:
          '先判断当前章节是否相关；相关则自然回扣，不相关则保留为后续风险，避免为了打卡硬塞细节。',
        mentioned: false,
      });
    }

    if (
      ['character', 'relationship', 'environment'].includes(item.kind) &&
      sequence - item.introducedSequence >= 6 &&
      item.mentionCount >= 2 &&
      item.evolution.length === 0
    ) {
      findings.push({
        itemId: item.id,
        dimension: '动态成长',
        severity: 'warning',
        message: `“${item.title}”多次出现，但机制没有记录任何演变。`,
        suggestion:
          '检查它是否真的应保持不变；若变化，记录诱因、过渡反应和新的稳定状态，若不变则写清坚持的代价。',
        mentioned,
      });
    }

    const contradictionPairs: Array<[string, string]> = [
      ['左撇子', '右手写字'],
      ['右撇子', '左手写字'],
      ['不会游泳', '熟练地游泳'],
      ['怕高', '毫不犹豫地跳下'],
      ['断电', '灯火通明'],
      ['失明', '看见了'],
    ];
    const contradiction = contradictionPairs.find(
      ([state, opposite]) =>
        item.currentState.includes(state) &&
        content.includes(opposite) &&
        continuityTokens(item).some((token) => content.includes(token)),
    );
    if (contradiction && !content.includes(item.changeRule || '\u0000')) {
      findings.push({
        itemId: item.id,
        dimension: '状态突变',
        severity: 'warning',
        message: `“${item.title}”的既有状态“${contradiction[0]}”与本章“${contradiction[1]}”可能冲突。`,
        suggestion:
          '若这是有意变化，请补出触发原因和人物反应，并向机制写入新的当前事实；否则修正文中的冲突描述。',
        mentioned: true,
      });
    }
  }
  return findings;
}

export const defaultWritingBrief: WritingBrief = {
  title: '断电之后',
  outline: '',
  inspiration: '停电城市里，一名杂货店青年追查妹妹失踪与异常广播之间的联系。',
  worldSetting:
    '全城停电七天，旧城区被临时封锁，收音机偶尔会播出不存在的频道。',
  characters: [
    {
      id: 'protagonist',
      name: '许照',
      role: '经营旧城区杂货铺的青年',
      goal: '找到失踪的妹妹',
      conflict: '习惯把所有责任揽在自己身上，不愿信任陌生人',
    },
    {
      id: 'missing-sister',
      name: '许晴',
      role: '通过异常广播留下线索的失踪者',
      goal: '阻止哥哥落入更大的陷阱',
      conflict: '她传递的每条线索都可能被人伪造',
    },
  ],
  plotDirection:
    '线索逐步指向封锁区内仍在运行的自动系统，每次接近真相都要付出新的代价。',
  chapterTitle: '雨夜来信',
  chapterGoal: '发现第一条可信线索，并在章尾让这条线索指向更大的危险。',
  pointOfView: '第三人称限知，跟随许照',
  tone: '克制、紧张，技术细节通过行动呈现',
  constraints: ['不模仿任何现有作者措辞', '场景变化必须由人物选择触发'],
  targetLength: DEFAULT_CHAPTER_LENGTH,
  useMemories: true,
};

function textField(value: unknown, fallback = '', maxLength = 4000) {
  return typeof value === 'string'
    ? value.trim().slice(0, maxLength)
    : fallback;
}

export function normalizeWritingBrief(value: unknown): WritingBrief {
  const input =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  const characterInput = Array.isArray(input.characters)
    ? input.characters
    : defaultWritingBrief.characters;
  const characters = characterInput
    .slice(0, 8)
    .map((item, index) => {
      const row =
        item && typeof item === 'object'
          ? (item as Record<string, unknown>)
          : {};
      return {
        id: textField(row.id, `character-${index + 1}`, 80),
        name: textField(row.name, '', 80),
        role: textField(row.role, '', 240),
        goal: textField(row.goal, '', 400),
        conflict: textField(row.conflict, '', 400),
      };
    })
    .filter((item) => item.name || item.role || item.goal || item.conflict);
  const constraints = (
    Array.isArray(input.constraints)
      ? input.constraints
      : typeof input.constraints === 'string'
        ? input.constraints.split(/\r?\n/)
        : defaultWritingBrief.constraints
  )
    .map((item) => textField(item, '', 500))
    .filter(Boolean)
    .slice(0, 20);
  const requestedTarget = Number(input.targetLength);
  const targetLength =
    Number.isFinite(requestedTarget) &&
    requestedTarget >= MIN_CHAPTER_LENGTH &&
    requestedTarget <= MAX_CHAPTER_LENGTH
      ? requestedTarget
      : DEFAULT_CHAPTER_LENGTH;
  const brief: WritingBrief = {
    title: textField(input.title, defaultWritingBrief.title, 120),
    outline: textField(input.outline, '', 12_000),
    inspiration: textField(input.inspiration, '', 4000),
    worldSetting: textField(input.worldSetting, '', 4000),
    characters,
    plotDirection: textField(input.plotDirection, '', 4000),
    chapterTitle: textField(
      input.chapterTitle,
      defaultWritingBrief.chapterTitle,
      120,
    ),
    chapterGoal: textField(input.chapterGoal, '', 2000),
    pointOfView: textField(
      input.pointOfView,
      defaultWritingBrief.pointOfView,
      240,
    ),
    tone: textField(input.tone, '', 1000),
    constraints,
    targetLength: Math.round(targetLength),
    useMemories: input.useMemories !== false,
  };
  if (!brief.inspiration) throw new Error('请填写核心灵感。');
  if (!brief.chapterGoal) throw new Error('请填写当前章节任务。');
  if (!brief.characters.length) throw new Error('请至少填写一个角色。');
  return brief;
}

const headingPattern =
  /^[ \t]*(?:第[零一二三四五六七八九十百千0-9]{1,8}[章节卷回]|chapter[ \t]+\d+)[^\n]*$/gim;
const hookKeywords = [
  '但是',
  '突然',
  '直到',
  '竟然',
  '真相',
  '来电',
  '门外',
  '身后',
  '失踪',
  '警告',
  '抹掉',
  '仍在',
  '最后',
  'only then',
  'but',
  'suddenly',
  'truth',
];
const actionKeywords = [
  '冲',
  '跑',
  '抓',
  '推开',
  '转身',
  '扣下',
  '打开',
  '逃',
  'ran',
  'opened',
  'turned',
  'grabbed',
];

function roundedRatio(value: number) {
  return Math.round(value * 100) / 100;
}

function normalizeExcerpt(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(-220);
}

const continuityStopPhrases = new Set([
  '一个',
  '一些',
  '一样',
  '不是',
  '不能',
  '不会',
  '什么',
  '他们',
  '你们',
  '我们',
  '自己',
  '这个',
  '那个',
  '这样',
  '已经',
  '还是',
  '只是',
  '没有',
  '然后',
  '因为',
  '所以',
  '但是',
  '如果',
  '时候',
]);

function findLongRangeContinuityEvidence(
  text: string,
  segments: Array<{ label: string; startOffset: number; endOffset: number }>,
) {
  if (segments.length < 4) return null;
  const occurrences = new Map<
    string,
    {
      chapters: Set<number>;
      count: number;
      firstChapter: number;
      lastChapter: number;
      firstOffset: number;
      lastOffset: number;
    }
  >();
  segments.slice(0, 300).forEach((segment, chapterIndex) => {
    const content = text.slice(segment.startOffset, segment.endOffset);
    const samples =
      content.length > 8000
        ? [
            { value: content.slice(0, 4000), offset: segment.startOffset },
            {
              value: content.slice(-4000),
              offset: segment.endOffset - 4000,
            },
          ]
        : [{ value: content, offset: segment.startOffset }];
    const chapterPhrases = new Set<string>();
    for (const sample of samples) {
      for (const match of sample.value.matchAll(/[\p{Script=Han}]{2,24}/gu)) {
        const chunk = match[0];
        for (const length of [2, 3, 4]) {
          for (let index = 0; index <= chunk.length - length; index += 1) {
            const phrase = chunk.slice(index, index + length);
            if (
              continuityStopPhrases.has(phrase) ||
              /^[的了是在有和也都而又将把被与就还只很着过让给从对向于]+$/u.test(
                phrase,
              )
            )
              continue;
            const absoluteOffset = sample.offset + (match.index ?? 0) + index;
            const current = occurrences.get(phrase) ?? {
              chapters: new Set<number>(),
              count: 0,
              firstChapter: chapterIndex,
              lastChapter: chapterIndex,
              firstOffset: absoluteOffset,
              lastOffset: absoluteOffset,
            };
            current.count += 1;
            current.chapters.add(chapterIndex);
            if (chapterIndex < current.firstChapter) {
              current.firstChapter = chapterIndex;
              current.firstOffset = absoluteOffset;
            }
            if (chapterIndex >= current.lastChapter) {
              current.lastChapter = chapterIndex;
              current.lastOffset = absoluteOffset;
            }
            occurrences.set(phrase, current);
            chapterPhrases.add(phrase);
          }
        }
      }
    }
    for (const phrase of chapterPhrases) {
      const current = occurrences.get(phrase);
      if (current) current.chapters.add(chapterIndex);
    }
  });
  const minimumSpan = Math.max(3, Math.floor(segments.length * 0.35));
  const candidate = [...occurrences.entries()]
    .filter(([, item]) => {
      const chapterCount = item.chapters.size;
      return (
        chapterCount >= 2 &&
        chapterCount <= Math.max(6, Math.ceil(segments.length * 0.45)) &&
        item.count <= 30 &&
        item.lastChapter - item.firstChapter >= minimumSpan
      );
    })
    .sort((a, b) => {
      const score = ([phrase, item]: typeof a) =>
        item.chapters.size * 8 +
        (item.lastChapter - item.firstChapter) * 2 +
        phrase.length;
      return score(b) - score(a);
    })[0];
  if (!candidate) return null;
  const [phrase, item] = candidate;
  const evidenceForOffset = (offset: number, chapterIndex: number) => ({
    chapterLabel:
      segments[chapterIndex]?.label ?? `文本片段 ${chapterIndex + 1}`,
    startOffset: Math.max(0, offset - 100),
    endOffset: Math.min(text.length, offset + phrase.length + 120),
    excerpt: normalizeExcerpt(
      text.slice(
        Math.max(0, offset - 100),
        Math.min(text.length, offset + phrase.length + 120),
      ),
    ),
    score: Math.min(10, 5 + item.chapters.size),
    reasons: [
      `同一关键称谓或物件跨越 ${item.lastChapter - item.firstChapter} 个章节再次出现`,
    ],
  });
  return {
    chapterCount: item.chapters.size,
    span: item.lastChapter - item.firstChapter,
    evidence: [
      evidenceForOffset(item.firstOffset, item.firstChapter),
      evidenceForOffset(item.lastOffset, item.lastChapter),
    ],
  };
}

export function segmentBook(text: string) {
  const matches = [...text.matchAll(headingPattern)];
  if (matches.length >= 2) {
    return matches.map((match, index) => ({
      label: match[0].trim(),
      startOffset: match.index ?? 0,
      endOffset: matches[index + 1]?.index ?? text.length,
    }));
  }

  const chunks: Array<{
    label: string;
    startOffset: number;
    endOffset: number;
  }> = [];
  let start = 0;
  let index = 1;
  while (start < text.length) {
    let end = Math.min(text.length, start + 6000);
    if (end < text.length) {
      const paragraphBreak = text.lastIndexOf('\n\n', end);
      if (paragraphBreak > start + 2500) end = paragraphBreak;
    }
    chunks.push({
      label: `文本片段 ${index}`,
      startOffset: start,
      endOffset: end,
    });
    start = end;
    index += 1;
  }
  return chunks;
}

function inspectEnding(content: string) {
  const ending = content.slice(-500);
  const signals: string[] = [];
  let score = 0;
  if (/[?？]\s*[”"']?\s*$/.test(ending)) {
    signals.push('以未回答的问题结束');
    score += 3;
  }
  if (/[—…]{2,}\s*[”"']?\s*$/.test(ending)) {
    signals.push('动作或话语在高压处中断');
    score += 2;
  }
  const matchedHook = hookKeywords.find((keyword) =>
    ending.toLowerCase().includes(keyword),
  );
  if (matchedHook) {
    signals.push('末段引入新信息或反转');
    score += 2;
  }
  const matchedAction = actionKeywords.find((keyword) =>
    ending.toLowerCase().includes(keyword),
  );
  if (matchedAction) {
    signals.push('末段仍处于行动状态');
    score += 1;
  }
  const lastParagraph =
    ending
      .trim()
      .split(/\n\s*\n/)
      .pop() ?? '';
  if (lastParagraph.length > 0 && lastParagraph.length < 120) {
    signals.push('短段落收束形成视觉停顿');
    score += 1;
  }
  return { score, signals };
}

export function analyzeBook(text: string, goal: string): AnalysisResult {
  const segments = segmentBook(text);
  const chapters = segments.map((segment) => {
    const content = text.slice(segment.startOffset, segment.endOffset);
    const dialogueMarks = content.match(/[“”「」『』"]/g)?.length ?? 0;
    const hook = inspectEnding(content);
    return {
      ...segment,
      characterCount: content.length,
      dialogueRatio: roundedRatio(dialogueMarks / Math.max(content.length, 1)),
      hookScore: hook.score,
      signals: hook.signals,
    };
  });

  const sampleCount = Math.max(
    1,
    Math.min(5, Math.ceil(chapters.length * 0.1)),
  );
  const selected = [...chapters]
    .sort(
      (a, b) =>
        b.hookScore - a.hookScore || b.characterCount - a.characterCount,
    )
    .slice(0, sampleCount);
  const evidence = selected.map((chapter) => ({
    chapterLabel: chapter.label,
    startOffset: Math.max(chapter.startOffset, chapter.endOffset - 500),
    endOffset: chapter.endOffset,
    excerpt: normalizeExcerpt(
      text.slice(chapter.startOffset, chapter.endOffset),
    ),
    score: chapter.hookScore,
    reasons: chapter.signals.length
      ? chapter.signals
      : [`与“${goal}”目标相关的高信息密度章尾样本`],
  }));

  const hasQuestion = evidence.some((item) =>
    item.reasons.some((reason) => reason.includes('问题')),
  );
  const hasTurn = evidence.some((item) =>
    item.reasons.some((reason) => reason.includes('新信息')),
  );
  const hasAction = evidence.some((item) =>
    item.reasons.some((reason) => reason.includes('行动')),
  );
  const techniques: TechniqueCandidate[] = [];
  if (hasQuestion) {
    techniques.push({
      title: '问题悬置型章尾',
      confidence: 78,
      evidenceIndexes: evidence.flatMap((item, index) =>
        item.reasons.some((reason) => reason.includes('问题')) ? [index] : [],
      ),
      content: {
        applicableWhen: '读者已经掌握必要信息，但关键选择或答案尚未揭示时',
        formula: '完成局部动作 → 抛出具体问题 → 在回答出现前切章',
        expectedEffect: '制造明确的信息缺口，让下一章承接一个可兑现的问题',
        avoidWhen: '问题与主线无关，或下一章不能很快兑现时',
      },
    });
  }
  if (hasTurn) {
    techniques.push({
      title: '新信息改写局势',
      confidence: 74,
      evidenceIndexes: evidence.flatMap((item, index) =>
        item.reasons.some((reason) => reason.includes('新信息')) ? [index] : [],
      ),
      content: {
        applicableWhen: '本章目标刚完成，读者以为局势暂时稳定时',
        formula: '兑现本章目标 → 引入一条可信的新事实 → 让旧结论立即失效',
        expectedEffect: '同时提供满足感和新的阅读驱动力',
        avoidWhen: '新事实没有前置线索，只靠巧合强行反转时',
      },
    });
  }
  if (hasAction || techniques.length === 0) {
    techniques.push({
      title: '行动未完成式截断',
      confidence: hasAction ? 70 : 55,
      evidenceIndexes: evidence.map((_, index) => index),
      content: {
        applicableWhen: '冲突已经启动，而且下一步会产生不可逆后果时',
        formula: '明确行动目标 → 提高即时风险 → 在结果落地前切章',
        expectedEffect: '保持动能，并让章节衔接建立在因果而非场景位置上',
        avoidWhen: '每章都在同一节奏点截断，造成机械感时',
      },
    });
  }
  const livingEvidenceIndexes = evidence.flatMap((item, index) =>
    /饭|茶|碗|衣|鞋|摊|铺|邻|灯|窗|门|灰|水|雨|风/u.test(item.excerpt)
      ? [index]
      : [],
  );
  if (livingEvidenceIndexes.length) {
    techniques.push({
      title: '生活痕迹承载环境',
      confidence: 68,
      evidenceIndexes: livingEvidenceIndexes,
      content: {
        applicableWhen: '场景需要建立可信日常，或紧张气氛容易写得空泛时',
        formula: '选择被人使用过的物件 → 让人物与它发生动作 → 借变化透露处境',
        expectedEffect: '环境既有生活气息，也参与叙事而不是只负责渲染冷暖',
        avoidWhen: '堆叠无关物件、气味和颜色，却不影响人物判断时',
      },
    });
  }
  const characterEvidenceIndexes = evidence.flatMap((item, index) =>
    /[“”].{0,80}(?:手|眼|脚|袖|门)|(?:抓|推|停|退|抬|按|藏).{0,50}[“”]/u.test(
      item.excerpt,
    )
      ? [index]
      : [],
  );
  if (characterEvidenceIndexes.length) {
    techniques.push({
      title: '动作替代性格说明',
      confidence: 72,
      evidenceIndexes: characterEvidenceIndexes,
      content: {
        applicableWhen: '需要表现人物戒备、犹豫、亲疏或压力时',
        formula:
          '给人物一个带习惯性的细动作 → 让对手观察或误读 → 用回应显出关系',
        expectedEffect: '读者从行为自行判断人物，减少总结式心理旁白',
        avoidWhen: '动作与当下目标无关，或每次情绪都使用同一个身体反应时',
      },
    });
  }
  const fallbackEvidence = evidence.length ? [0] : [];
  const actionEvidenceIndexes = evidence.flatMap((item, index) =>
    /推|拉|停|走|跑|抬|抓|转|打开|拒绝|选择|ran|walked|opened|turned|grabbed|refused|decided/iu.test(
      item.excerpt,
    )
      ? [index]
      : [],
  );
  const dialogueEvidenceIndexes = evidence.flatMap((item, index) =>
    /[“”「」『』"]/.test(item.excerpt) ? [index] : [],
  );
  const objectEvidenceIndexes = evidence.flatMap((item, index) =>
    /门|钥匙|纸|灯|收音机|照片|桌|碗|信|电话|电脑|door|key|paper|light|radio|photo|table|phone|computer/iu.test(
      item.excerpt,
    )
      ? [index]
      : [],
  );
  const turnEvidenceIndexes = evidence.flatMap((item, index) =>
    item.reasons.some((reason) => reason.includes('新信息')) ? [index] : [],
  );
  const insights: AnalysisInsight[] = [
    {
      kind: 'structure',
      title: '局部兑现后再改写局势',
      confidence: hasTurn ? 78 : 62,
      evidenceIndexes: turnEvidenceIndexes.length
        ? turnEvidenceIndexes
        : fallbackEvidence,
      content: {
        rule: '章节先兑现一个局部目标，再用新事实改变人物的下一步，而不是只把答案拖后。',
        detail: `本次抽样 ${evidence.length} 个高信息片段，重点观察章尾的信息缺口和因果承接。`,
        application: '用于检查章节是否同时给读者满足感和继续阅读的具体理由。',
        avoidWhen: '新事实没有前置线索，或只为了反转而否定前文时。',
      },
    },
    {
      kind: 'character',
      title: '行动与回应共同显出人物立场',
      confidence: actionEvidenceIndexes.length ? 74 : 58,
      evidenceIndexes: actionEvidenceIndexes.length
        ? actionEvidenceIndexes
        : dialogueEvidenceIndexes.length
          ? dialogueEvidenceIndexes
          : fallbackEvidence,
      content: {
        rule: '人物态度至少经过一次行动和他人的回应来显形，少用旁白直接概括性格。',
        detail: `样本中识别到 ${actionEvidenceIndexes.length} 个行动密集片段、${dialogueEvidenceIndexes.length} 个对白片段。`,
        application: '用于人物出场、关系试探和关键选择前后的塑造。',
        avoidWhen: '动作只是无意义的小表情，且不改变关系或局势时。',
      },
    },
    {
      kind: 'core',
      title: '核心命题通过重复选择递进',
      confidence: hasAction && (hasQuestion || hasTurn) ? 72 : 56,
      evidenceIndexes: actionEvidenceIndexes.length
        ? actionEvidenceIndexes
        : fallbackEvidence,
      content: {
        rule: '同一核心难题要在不同处境下反复逼人物选择，每次都提高代价或改变关系。',
        detail: '把主题落到人物反复面对的具体抉择中，不直接写成作者结论。',
        application: '用于全书大纲、中点反转、最低谷和终局选择的前后呼应。',
        avoidWhen: '每次选择的后果相同，或人物只是被情节拖着走时。',
      },
    },
  ];
  if (objectEvidenceIndexes.length) {
    insights.push({
      kind: 'material',
      title: '日常物件转化为叙事线索',
      confidence: 69,
      evidenceIndexes: objectEvidenceIndexes,
      content: {
        rule: '先让物件具有日常用途，再让其异常变化携带信息或压力。',
        detail: `在 ${objectEvidenceIndexes.length} 个高信息样本中发现具体物件参与叙事。`,
        application: '生成场景时优先选择与人物职业、住处和习惯有关的物件。',
        avoidWhen: '物件只负责装饰，或直接照搬参考书中的标志性道具时。',
      },
    });
  }
  const longRangeContinuity = findLongRangeContinuityEvidence(text, segments);
  if (longRangeContinuity) {
    const firstEvidenceIndex = evidence.length;
    evidence.push(...longRangeContinuity.evidence);
    insights.push({
      kind: 'continuity',
      title: '跨章线索按状态递进而非机械复现',
      confidence: Math.min(84, 64 + longRangeContinuity.chapterCount * 4),
      evidenceIndexes: [firstEvidenceIndex, firstEvidenceIndex + 1],
      content: {
        rule: '关键人物习惯、物件或环境线索再次出现时，必须带来新的理解、关系变化或行动后果。',
        detail: `样本识别到同一线索跨越 ${longRangeContinuity.span} 个章节、在 ${longRangeContinuity.chapterCount} 个章节中形成回响。`,
        application:
          '用于审核长线伏笔是否完成“建立、变形、加压、兑现”，并判断人物和环境是否在因果中演变。',
        avoidWhen:
          '只重复名称来提醒读者，或在没有前置变化条件时突然改写既有事实。',
      },
    });
  }
  return {
    chapters,
    evidence,
    techniques: techniques.slice(0, 6),
    insights,
  };
}

export function compileWritingPrompt(input: {
  brief: WritingBrief;
  techniques: TechniqueCandidate[];
  weaknesses?: BrainMemory[];
  materials?: BrainMemory[];
  insights?: BrainMemory[];
  continuity?: ContinuityItem[];
  nextSequence?: number;
  previousChapter?: { title: string; content: string };
}): CompiledWritingPrompt {
  const { brief } = input;
  const priorities = [
    `作品名：${brief.title}`,
    brief.outline ? `全书大纲：\n${brief.outline}` : '',
    `核心灵感：${brief.inspiration}`,
    brief.worldSetting ? `世界背景：${brief.worldSetting}` : '',
    ...brief.characters.map(
      (character, index) =>
        `角色 ${index + 1}｜${character.name || '未命名'}：身份=${character.role || '待定'}；目标=${character.goal || '待定'}；矛盾=${character.conflict || '待定'}`,
    ),
    brief.plotDirection ? `情节方向：${brief.plotDirection}` : '',
    `当前章节：${brief.chapterTitle}`,
    `章节任务：${brief.chapterGoal}`,
    input.previousChapter
      ? `前情接续：${compact(input.previousChapter.content.slice(-260), '', 260)}。本章必须承接其信息或人物后果；允许转场，不允许逻辑断裂。`
      : '',
    `叙事视角：${brief.pointOfView}`,
    brief.tone ? `语言与节奏：${brief.tone}` : '',
    `目标篇幅：${brief.targetLength} 字；成稿必须不少于 ${MIN_CHAPTER_LENGTH} 字且不多于 ${MAX_CHAPTER_LENGTH} 字`,
    '篇幅不足时补足人物行动、对话交锋、环境作用、因果过程与选择后果；篇幅超限时删除重复解释，不得截断句子或删除章尾承诺',
    '硬约束：保持原创，不复刻参考书的措辞、人物、情节或可识别作者风格',
    ...brief.constraints.map((item) => `硬约束：${item}`),
    ...input.techniques.map(
      (item) =>
        `已确认技法：${item.title}；${item.content.formula}；禁用条件=${item.content.avoidWhen}`,
    ),
    ...(input.weaknesses ?? []).map(
      (item) =>
        `已确认避坑规则：${item.title}；${item.content.rule || item.content.suggestedFix || '写作后专项复查'}`,
    ),
    ...(input.materials ?? []).map(
      (item) =>
        `可调用素材：${item.title}；${item.content.detail || item.content.rule || '按当前场景转化使用'}`,
    ),
    ...(input.insights ?? []).map(
      (item) =>
        `拆书精华（${item.kind}）：${item.title}；${item.content.rule || item.content.detail || ''}；适用=${item.content.application || '按当前章节判断'}`,
    ),
    ...buildContinuityPrompt(input.continuity ?? [], input.nextSequence ?? 1),
    '成文机制：先完成情节初稿，再检查模板化说明、生活气息、人物行动和冲突代价；只对薄弱段落做有限润色，润色后复审。',
  ].filter(Boolean);
  const role =
    '你是原创小说写作助手。先遵守创作简报和硬约束，再使用已确认的抽象技法；参考书只提供方法证据，不得复刻作者措辞、人物或情节。';
  return {
    role,
    priorities,
    assembled: [`【角色】\n${role}`, '【创作简报】', ...priorities]
      .join('\n')
      .trim(),
  };
}

export function polishDraft(
  draft: string,
  brief: WritingBrief,
  context?: { weaknesses?: BrainMemory[]; materials?: BrainMemory[] },
) {
  const name = compact(brief.characters[0]?.name ?? '', '主角', 40);
  const supportingName = compact(brief.characters[1]?.name ?? '', '来人', 40);
  const settingText = `${brief.worldSetting} ${brief.inspiration}`;
  const livingDetail = /古代|王朝|县衙|客栈|江湖|宫廷|朝堂/u.test(settingText)
    ? `灶房的粥已经凉透，木凳下还压着半截劈柴；穿堂风一过，竹帘便轻轻磕着门框。${name}弯腰把柴塞回去，才继续往里走。`
    : /太空|星舰|飞船|宇宙|空间站|殖民星/u.test(settingText)
      ? `循环风口积着一圈没擦净的灰，桌边还粘着半袋开过的口粮；舱体一震，空水杯沿桌面滑出半寸。${name}按住杯子，才继续往里走。`
      : /校园|学校|教室|宿舍|大学|高中/u.test(settingText)
        ? `楼下小卖部的卷帘门卡在半腰，窗台还搁着一盒没吃完的炒饭；风一吹，晾衣杆便磕着瓷砖响。${name}顺手扶稳杆子，才继续往里走。`
        : `隔壁铺子的卷帘门卡在半腰，门口那碗吃剩的面早泡胀了；风一吹，塑料凳就在砖地上蹭出短短一声。${name}顺手把凳子扶正，才继续往里走。`;
  const appliedChanges: string[] = [];
  let polished = draft;

  const replacements: Array<[RegExp, string, string]> = [
    [
      /(?:可|但)(?:他|她|\p{Script=Han}{1,4})同样清楚[，,]([^。！？]+)[。！？]?/gu,
      `${name}的手已经碰到门闩，又慢慢收了回来。“我自己去。”他说。${supportingName}看着他：“你又想一个人扛？”`,
      '把抽象心理说明改成犹豫动作',
    ],
    [
      /(?:他|她|\p{Script=Han}{1,4})重新确认了自己的目标[。！？]?/gu,
      `${name}把写着地址的纸折成窄条，塞进口袋，起身。`,
      '删除任务总结式旁白',
    ],
    [
      /(?:他|她|\p{Script=Han}{1,4})做出了选择，也因此([^。！？]*)[。！？]?/gu,
      `${name}伸手按住了桌角。这个决定一出口，$1便再没有收回的余地。`,
      '让选择通过动作和后果落地',
    ],
    [
      /最可靠的事实可能是假的/gu,
      '那张盖过章的纸边缘还沾着新墨，日期却是三年前',
      '把抽象判断换成可核验细节',
    ],
  ];
  for (const [pattern, replacement, label] of replacements) {
    if (pattern.test(polished)) {
      pattern.lastIndex = 0;
      polished = polished.replace(pattern, replacement);
      appliedChanges.push(label);
    }
  }

  const paragraphs = polished.split(/\n\s*\n/).filter(Boolean);
  const livingPattern =
    /饭|茶|碗|筷|油烟|晾衣|衣角|衣领|摊位|铺子|邻居|收音机|热水|门帘|菜叶|米袋|药瓶|账本|凳子|粥|口粮|水杯/u;
  const livingMatches = polished.match(new RegExp(livingPattern, 'gu')) ?? [];
  if (livingMatches.length < 2 && paragraphs.length) {
    const insertionIndex = Math.min(1, paragraphs.length - 1);
    paragraphs[insertionIndex] += ` ${livingDetail}`;
    appliedChanges.push('补入被人物使用过的日常环境');
  }
  const costPattern = /代价|失去|受伤|暴露|来不及|再没有|牵连|赔|断了|用完/u;
  if (!costPattern.test(polished) && paragraphs.length >= 3) {
    const insertionIndex = Math.max(1, Math.floor(paragraphs.length * 0.66));
    paragraphs[insertionIndex] +=
      ` ${supportingName}把话截住：“你再往前一步，替你开门的人就得先替你付账。”`;
    appliedChanges.push('把冲突补成可感知的人物代价');
  }
  const behaviorPattern = new RegExp(
    `${name}.{0,24}(?:手|袖口|鞋|碗|门|口袋|指|肩)`,
    'u',
  );
  if (!behaviorPattern.test(polished) && paragraphs.length >= 2) {
    const insertionIndex = Math.floor(paragraphs.length / 2);
    paragraphs[insertionIndex] +=
      ` ${name}把袖口往掌心拽了一寸。${supportingName}的视线在那只手上停了一下，没有拆穿。`;
    appliedChanges.push('用习惯动作呈现人物压力');
  }
  polished = paragraphs.join('\n\n');
  // 头号写手 v2：三遍去AI味（阻断词替换 → 长句拆解 → 查漏）
  const deAi = deAiPolish(polished);
  if (deAi.changes.length > 0) {
    appliedChanges.push(...deAi.changes);
  }
  polished = fitChapterLength(deAi.output, brief);

  const memoryTitles = [
    ...(context?.weaknesses ?? []),
    ...(context?.materials ?? []),
  ].map((item) => item.title);
  return { polished, appliedChanges, memoryTitles };
}

export function createOutline(brief: WritingBrief) {
  const protagonist = brief.characters[0];
  const name = compact(protagonist?.name ?? '', '主角', 40);
  const goal = sentenceFragment(
    protagonist?.goal ?? '',
    compact(brief.chapterGoal, '查清眼前的异常'),
    80,
  );
  const direction = sentenceFragment(
    brief.plotDirection,
    '线索不断把人物推向更大的风险',
    100,
  );
  const beats = [
    `建立日常与异常：${name}发现一条无法解释的线索`,
    '第一次选择：为了追查线索，人物主动越过一条安全边界',
    '阻力显形：最先出现的对手让目标变得更具体',
    '短暂盟友：人物得到帮助，但必须交换一个秘密',
    '第一次兑现：早期伏笔给出局部答案，同时带来新问题',
    '关系反转：盟友的真实目的与主角发生冲突',
    '进入新区域：人物离开熟悉环境，规则开始改变',
    '代价出现：一次错误判断让无辜者或重要资源受损',
    `线索拼合：${name}确认${goal}与更大的阴谋相连`,
    '中点反转：看似可靠的证据证明先前结论并不完整',
    '被迫合作：主角与对手共享一个短期目标',
    '关系裂缝：合作中的隐瞒让人物必须重新选择信任对象',
    '追逐升级：对手抢先一步，主角只能改变原来的计划',
    `最低谷：${name}失去最接近答案的机会，并承担直接后果`,
    `重新定义目标：${name}放弃一个执念，找到更准确的行动理由`,
    '反攻准备：前面留下的细节被重新组合成可执行的方案',
    '终局逼近：所有主要人物在同一地点或同一事件中汇合',
    `终极选择：${name}必须在“${goal}”和保护重要的人之间付出真实代价`,
    `结果落地：${direction}，主线问题得到回答但生活留下改变`,
    '余波与新钩子：兑现本卷承诺，为下一阶段留下一个具体问题',
  ];
  return beats
    .map(
      (beat, index) => `第 ${String(index + 1).padStart(2, '0')} 章｜${beat}`,
    )
    .join('\n');
}

function compact(value: string, fallback: string, maxLength = 90) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return (normalized || fallback).slice(0, maxLength);
}

function sentenceFragment(value: string, fallback: string, maxLength = 90) {
  return compact(value, fallback, maxLength).replace(/[。！？!?]+$/u, '');
}

type OpeningArcPlan = {
  location: string;
  daily: string;
  anomaly: string;
  clue: string;
  witness: string;
  opposition: string;
  falseLead: string;
  choice: string;
  cost: string;
  reveal: string;
  hook: string;
};

type OpeningArcContext = {
  partner: string;
  routine: string;
  ambient: string;
  verify: string;
  witnessAction: string;
  pressureNoise: string;
  conceal: string;
  question: string;
  usedTrace: string;
  tail: string;
  document: string;
  departure: string;
  choiceAftermath: string;
  costWitness: string;
  personalTrace: string;
  environmentShift: string;
  observation: string;
  routePlan: string;
  civilianRisk: string;
  clockAction: string;
  clueAction: string;
};

function openingArcSequence(brief: WritingBrief) {
  const source = `${brief.chapterTitle} ${brief.chapterGoal}`;
  const byGoal = [
    /建立日常与异常/u,
    /第一次选择/u,
    /阻力显形/u,
    /短暂盟友/u,
    /第一次兑现/u,
  ].findIndex((pattern) => pattern.test(source));
  if (byGoal >= 0) return byGoal + 1;
  const match = source.match(/第\s*0?([1-5])\s*章/u);
  return match ? Number(match[1]) : 0;
}

function createOpeningArcParagraphs(
  brief: WritingBrief,
  previousChapter?: { title: string; content: string },
) {
  if (
    !/潮汐|海上|旧港|航线/u.test(`${brief.worldSetting} ${brief.plotDirection}`)
  )
    return null;
  const sequence = openingArcSequence(brief);
  const plans: Record<number, OpeningArcPlan> = {
    1: {
      location: '林家修表铺',
      daily: '煤油炉上的水刚滚，隔壁鱼摊的孙姨隔着窗催他修好秤盘里的小闹钟',
      anomaly: '所有校准过的钟在同一刻慢了七分钟，只有姐姐留下的旧潮钟越走越快',
      clue: '潮钟背板内侧新出现的一道双弯刻痕',
      witness: '孙姨认出那是旧港领航员才用的逆潮记号',
      opposition: '收钟队沿街登记所有不合时的钟，领队齐槐已经走到巷口',
      falseLead: '背板上的数字看似门牌，实则对应当夜最低潮的分钟数',
      choice: '林岸把普通座钟交出去，藏下潮钟，并决定在收钟队之前赶到旧栈桥',
      cost: '他失约没能替街坊送药，修表铺也被贴上次日复查的封条',
      reveal: '刻痕末端藏着姐姐惯用的反写小字，证明这条线索不是旁人临摹',
      hook: '潮钟停在十一点四十分，背板浮出“十三号栈桥下面”的字样',
    },
    2: {
      location: '旧城白色潮界线外',
      daily: '摆渡人正收最后一锅鱼粥，船家把晒不干的胶靴倒扣在缆桩上',
      anomaly: '退潮后的石路没有通向昨日的街口，而是拐进一片地图上不存在的棚屋',
      clue: '姐姐刻下的七分钟与巡潮铃之间恰好差一轮换岗',
      witness: '替人看船的少年阿简见过周岚在封港后独自驶入那条水道',
      opposition: '齐槐的巡潮艇封住正航道，并逐条检查夜间出航许可',
      falseLead: '十三号栈桥已经拆除，编号却被刷在一艘卖冰的小船底部',
      choice:
        '林岸割断自家备用缆绳，借潮水拖船越过白线，从棚屋背后的窄水道进入封锁区',
      cost: '装着精密工具的木箱落进咸水，他以后修复潮钟只剩一把旧镊子',
      reveal: '所谓十三号不是固定地点，而是随街区移动的临时泊位编号',
      hook: '卖冰船的暗舱里留着半张航图，落款是失踪三年的周岚',
    },
    3: {
      location: '漂移到旧港边缘的盆市',
      daily: '早市还没散，卖虾人用木勺舀走摊布上的积水，裁缝在棚下替孩子补校服',
      anomaly: '市场每换一条巷子，潮钟便快一分钟，像在计算某个人接近的速度',
      clue: '半张航图的折痕正好压住齐槐负责的三处巡检点',
      witness: '补网老人说收钟队并不销毁旧钟，而是把机芯送进海关后面的仓库',
      opposition: '齐槐当众扣下林岸的潮钟，要求他说明姐姐失踪当夜去过哪里',
      falseLead: '仓库清单把姐姐列为偷渡者，日期和官方失踪记录却相差一天',
      choice:
        '林岸故意承认航图在自己手里，引齐槐离开人群，再让阿简潜入仓库取回机芯',
      cost: '齐槐查封修表铺并公开林岸的名字，街坊从此也被纳入盘问',
      reveal: '齐槐寻找的不是姐姐本人，而是她掌握的城市换位次序',
      hook: '仓库拘留册的最后一页写着林岸，收押日期却是明天',
    },
    4: {
      location: '停航多年的白鹭渡轮',
      daily:
        '船舱茶炉里还温着水，桌角压着吃了一半的盐花生，舷窗边晾着一双洗净的手套',
      anomaly: '渡轮没有发动，船身却始终逆着潮向缓慢转头',
      clue: '拘留册使用的蓝墨只在领航站配发，周岚正是最后一批领用人',
      witness: '周岚主动现身，承认失踪当夜由她驾驶姐姐乘坐的引航船',
      opposition: '巡潮艇开始逐舱搜查，齐槐用扩音器承诺只带走林岸一人',
      falseLead:
        '周岚起初声称姐姐在外海下船，航海日志的盐渍却证明船当晚没有出港',
      choice:
        '林岸交出姐姐留言的一半，换周岚带他去真正的十三号泊位；两人各留一半证据互相牵制',
      cost: '为了摆脱巡艇，周岚烧掉唯一完整航图，林岸也失去独自追查的退路',
      reveal: '周岚隐瞒旧案，是因为她曾替姐姐启动城市换位装置',
      hook: '渡轮离岸前，周岚终于说出姐姐当年的原话：“别让林岸找到我。”',
    },
    5: {
      location: '低潮时露出的第七码头',
      daily:
        '淤泥里的旧食堂仍摆着搪瓷碗，墙上菜单停在三年前，米缸却留有上周翻动的痕迹',
      anomaly: '第七码头的钟都没有指针，整座建筑却按七分钟一次的节奏发出齿轮声',
      clue: '此前凑齐的时间、泊位、蓝墨和逆潮刻痕可以拼成一套开启顺序',
      witness: '周岚认出控制室门上的维修签名，末笔是姐姐最近才养成的写法',
      opposition:
        '齐槐封住上层出口，涨潮又从下层管道倒灌，留给他们的时间不足一刻钟',
      falseLead:
        '控制室最显眼的航线通向外海，真正的开关却藏在食堂送饭的小升降机里',
      choice:
        '林岸放弃抢救完整录音，先把被闸门卡住的周岚拖出来，再用潮钟顶住回落的齿轮',
      cost: '姐姐留下的录音机进水，只保住最后十九秒，潮钟的主发条也彻底折断',
      reveal:
        '城市移动不是为了躲避风暴，而是在轮流遮蔽一座保存居民记忆的水下档案库',
      hook: '残存录音里，姐姐说她仍在城内，并警告下一次换位会抹掉一个人的全部记录',
    },
  };
  const plan = plans[sequence];
  if (!plan) return null;
  const name = compact(brief.characters[0]?.name ?? '', '主角', 40);
  const supportingName = compact(brief.characters[1]?.name ?? '', '同伴', 40);
  const carry = previousChapter
    ? sentenceFragment(
        previousChapter.content
          .split(/\n\s*\n/u)
          .map((item) => item.trim())
          .filter(Boolean)
          .at(-1) ?? '',
        '',
        180,
      )
    : '';
  const priorHook = plans[sequence - 1]?.hook ?? carry;
  const priorHookSentence = priorHook
    ? `${priorHook}${/[。！？][”"']?$/u.test(priorHook) ? '' : '。'}`
    : '';
  const contexts: Record<number, OpeningArcContext> = {
    1: {
      partner: '孙姨',
      routine: `${name}把烧开的水从炉上移开，顺手用棉布盖住拆到一半的机芯。`,
      ambient: '门外有人为鱼价争了两句，孩子踩着水跑过，鞋底啪嗒作响。',
      verify: `${name}取出三只刚校准的表同潮钟并排放好，误差连续出现三次，才在纸上记下一笔。`,
      witnessAction:
        '孙姨没有进门，只把盛鱼的竹篮换到另一只手，目光始终留在街口。',
      pressureNoise:
        '邻铺先落下一扇门板，第二扇卡在槽里，木头摩擦声在巷里拖得很长。',
      conceal: `${name}把潮钟塞进废齿轮抽屉，覆上油布，手里只留一只常见的铜壳闹钟。`,
      question: `领队齐槐先问营业，随后忽然问起姐姐。${name}低头把最后一颗螺丝放进瓷碟。`,
      usedTrace:
        '柜台边还放着半碗凉粥，粥面结了薄皮，盘问者的视线却只在抽屉上停。',
      tail: `${name}数着门外踩过积水的声音，确认收钟队走了三人，墙后还留着一个。`,
      document:
        '检查条背面透出另一张表格的蓝印，铅粉扫过后显出被压住的旧港编号。',
      departure: `${name}只带潮钟、线索和旧镊子，给炉子封好进气口，把未送出的药包放在门边。`,
      choiceAftermath:
        '炉火要灭，欠账要压在砚台下，门锁还得留一道让街坊取药的缝。',
      costWitness:
        '孙姨隔着雨棚骂他不守信用，骂完又说药她替他送，回来再算修钟的钱。',
      personalTrace:
        '桌角留着姐姐小时候刻的身高线，最上面一横旁写着“再高一点就能看见海”。',
      environmentShift:
        '晾衣绳开始斜向另一边，沟里的水缓慢倒流，街坊忙着给灶脚垫砖。',
      observation: `${name}借药铺玻璃的反光看见跟踪者换过外套，鞋底仍沾着同一层盐泥。`,
      routePlan:
        '他让孙姨提空纸袋走亮处，自己从鱼摊后的窄巷绕行，在热汤摊会合。',
      civilianRisk:
        '他不能撞翻别人的锅，也不能把追兵引进住着孩子的后院，只能拿自己的时间换。',
      clockAction: `${name}每过一个岔口便摸一次潮钟，表壳在掌心硌出一道红印。`,
      clueAction: `${name}拆开潮钟后盖，镊尖在铜板上碰到一道从未见过的划痕。`,
    },
    2: {
      partner: '阿简',
      routine: `${name}跪在卖冰船舷边，把舱底积水一瓢瓢舀出去，又用旧布裹紧潮钟。`,
      ambient: '白色潮界线外，船家收着胶靴和空碗，最后一锅鱼粥在风里结了薄皮。',
      verify: `${name}把七分钟误差同巡潮铃对了三轮，确认空档只够一条小船越过换岗水口。`,
      witnessAction:
        '阿简蹲在缆桩后补网，嘴上说没见过周岚，手里的梭子却指向棚屋水道。',
      pressureNoise:
        '巡潮艇的机轮声从正航道压过来，缆桩上的铁环跟着一下一下发颤。',
      conceal: `${name}把潮钟塞进盐筐底部，再压上两条湿麻袋，自己提着空工具箱站到船头。`,
      question:
        '巡查员踏上跳板，先查出航许可，随后用靴尖踢了踢那只看似空着的工具箱。',
      usedTrace:
        '船舱里还有半碗鱼粥和两双不同尺码的筷子，说明卖冰人离开得仓促。',
      tail: `${name}从水面的倒影看见巡潮艇并未远去，只关了灯，横在棚屋出口等他们动。`,
      document:
        '卖冰船底板夹着一张油纸，潮水泡开粘胶后，半幅航图才从木纹里脱出来。',
      departure: `${name}只留一把镊子和一卷防水线，把其余工具连箱推到船尾当作配重。`,
      choiceAftermath:
        '缆绳一断，小船便没有回头系泊的地方；白线也在船后迅速合拢。',
      costWitness: '岸上的药铺伙计举着灯追了几步，没能把他托付的药包送上船。',
      personalTrace:
        '工具箱内盖还贴着姐姐写的维修顺序，最末一项总是“把借来的东西送回去”。',
      environmentShift:
        '棚屋水道随退潮缓慢拐弯，晒网杆先后倾倒，船家忙着重新认自家门口。',
      observation: `${name}借船侧的积水看见跟踪者换上斗笠，腰间巡潮牌仍在水里闪了一下。`,
      routePlan: '他让阿简划空船走正口，自己伏在卖冰船暗舱里借流漂过木闸。',
      civilianRisk:
        '他不能让巡艇撞上住人的棚船，只能贴着废桩走最浅也最慢的一条水路。',
      clockAction: `${name}隔着湿麻袋按住潮钟，靠传进掌心的振动计算下一次街区换位。`,
      clueAction: `${name}趴到卖冰船底，用镊尖刮开新漆，十三号下面还压着三道旧泊位线。`,
    },
    3: {
      partner: '阿简',
      routine: `${name}替卖虾人扶正秤盘，趁砝码落下时把半张航图压进秤座的木缝。`,
      ambient:
        '盆市还没散，摊主忙着舀走棚布积水，裁缝在风里追一块没缝完的校服袖口。',
      verify: `${name}在三个摊位间各走一遍，潮钟每换一条巷便快一分钟，追来的速度有了数。`,
      witnessAction: '补网老人只顾理线，提到海关仓库时却把同一个死结打了两遍。',
      pressureNoise:
        '收钟队掀开市场西口的油布棚，铜哨一响，刚谈价的人群立刻散出一条路。',
      conceal: `${name}把潮钟扣进坏秤的空腔，自己拿着航图站到最显眼的鱼案旁。`,
      question: `齐槐没有搜身，先问姐姐失踪当夜谁替她关的铺门。${name}反问拘留册为何早了一天。`,
      usedTrace:
        '鱼案下摆着一双童鞋和没吃完的糖糕，摊主护着它们，比护钱匣更快。',
      tail: `${name}从铜盆倒影里看见两名便衣逆着散场人群停下，一个盯他，一个盯阿简。`,
      document:
        '仓库清单的复写纸粘在航图背面，抹去水珠后，姐姐的名字和错位日期一起出现。',
      departure: `${name}把航图撕成两半，一半塞进鱼鳞下面，另一半交给阿简带往仓库。`,
      choiceAftermath:
        '他一开口承认持有航图，整座市场的目光便先于收钟队落到他身上。',
      costWitness:
        '齐槐让人贴出修表铺封条，孙姨的鱼摊也被记进第二天的盘问名单。',
      personalTrace:
        '秤座背面刻着姐姐小时候卖旧零件换糖的歪字，林岸一眼认出被刮掉的那一笔。',
      environmentShift:
        '盆市整条浮街向南偏转，摊棚互相挤压，商贩边骂边把火炉抬过新的水缝。',
      observation: `${name}借一排铜盆看清跟踪者的间距，发现其中一人始终不敢踩湿木板。`,
      routePlan: '他让阿简混进搬冰的人群，自己穿过裁缝棚，在仓库后门汇合。',
      civilianRisk:
        '收钟队一旦在人群里追跑，最先翻倒的是装着热油的锅，他只能故意走到空码头。',
      clockAction: `${name}把潮钟留在坏秤里，只凭摊棚震动记时，第一次让线索离开自己的手。`,
      clueAction: `${name}把半张航图按在铜盆底，折痕经过齐槐负责的三个巡检点，最后落到海关仓库。`,
    },
    4: {
      partner: supportingName,
      routine: `${name}在白鹭渡轮的茶炉旁拧干袖口，把半张航图压在搪瓷杯底慢慢烘平。`,
      ambient:
        '船舱桌角散着盐花生，舷窗边晾着洗净的手套，像主人只是临时去了一趟甲板。',
      verify: `${name}将蓝墨在热汽上熏过，暗记浮到纸面，与周岚领航章的缺口完全相合。`,
      witnessAction: '周岚给茶炉添了水，手始终压在壶盖上，也始终不肯背对舱门。',
      pressureNoise: '巡潮艇的探灯扫过舷窗，船壳外传来钩索刮过铁皮的尖响。',
      conceal: `${name}把潮钟放进茶炉下的灰盒，自己将航图折成杯垫压在周岚手边。`,
      question: `扩音器里，齐槐只叫${name}的名字。周岚问他是否相信这个承诺，他把舱门又栓紧一格。`,
      usedTrace:
        '两只茶杯一冷一热，花生壳只堆在靠舷窗的一边，说明这里一直还有别人值守。',
      tail: `${name}从舷窗玻璃看见巡艇放下一条无灯小艇，登船的人没有穿制服。`,
      document:
        '航海日志的盐渍在中页断掉，证明渡轮当夜没有出港，周岚先前的话少了一段。',
      departure: `${name}关掉舱灯，收走桌上的冷茶，把两条可走的舷梯都试了一遍。`,
      choiceAftermath:
        '交换完成后，两个人都失去独自离开的条件，也都多了一个必须盯住的同伴。',
      costWitness: '纸灰落进那杯一直没人喝的热茶里，周岚没有伸手去捞。',
      personalTrace:
        '船舱壁留着姐姐用指甲划出的三道短线，最后一道比前两道深，像当时船身突然一震。',
      environmentShift:
        '渡轮未发动却逆潮转头，桌上的空杯慢慢滑向相反方向，整片旧港在窗外换了位置。',
      observation: `${name}从舷窗反光数出登船人的站位，发现真正看守舱口的只有一个。`,
      routePlan: `他让${supportingName}从上层甲板露面，自己沿送煤槽下到机舱，再从另一侧拉开舷梯。`,
      civilianRisk:
        '他们不能把巡艇引向旁边住着船工家属的驳船，只能让白鹭渡轮先离开泊位。',
      clockAction: `${name}把潮钟贴在船壳上，滴答与水下齿轮重合时才示意周岚松缆。`,
      clueAction: `${name}把领航站的蓝墨放到热汽上，航海日志纸背慢慢浮出第二层日期。`,
    },
    5: {
      partner: supportingName,
      routine: `${name}蹲在第七码头旧食堂的配餐台下，用半截汤匙撬开送饭升降机的检修盖。`,
      ambient:
        '搪瓷碗还摞在窗口，墙上菜单停在三年前，米缸表面却留着上周翻动的凹痕。',
      verify: `${name}把时间、泊位、蓝墨和逆潮刻痕依次压进四个卡槽，墙后的齿轮才错开半圈。`,
      witnessAction: '周岚用指甲沿签名末笔划了一遍，手指在最后那个弯处停住。',
      pressureNoise:
        '铁门插销在上方接连落下，倒灌的海水托起空碗，瓷沿不断碰着桌腿。',
      conceal: `${name}把潮钟卡进回落的齿槽，以折断主发条的代价替升降机争出一道缝。`,
      question: `齐槐隔着铁门问他愿不愿拿周岚换完整录音。${name}先去拉被闸板卡住的那只手。`,
      usedTrace: '米缸里埋着新鲜药纸和鱼骨，说明所谓废码头至今仍有人按时送饭。',
      tail: `${name}在上涨的水面里看见第二束探灯，齐槐的人已经从通风井下到同一层。`,
      document:
        '录音机旁的值班表缺了七页，背面却留下送饭升降机每七分钟启动一次的油印。',
      departure: `${name}扯下外套包住录音机，把它推到升降机门边，再试了一次仅剩的手柄。`,
      choiceAftermath:
        '齿轮压弯潮钟表壳，升降机只够升一次；谁先上去不再是可以拖延的问题。',
      costWitness: '周岚听见主发条折断，回头看了一眼，脸色比听见追兵更难看。',
      personalTrace:
        '配餐台侧面刻着姐姐过去量药勺的刻度，最新一道划痕还没有被盐雾染黑。',
      environmentShift:
        '七码头随着换位向下沉，食堂窗外从淤泥变成水面，桌椅一件件顶上天花板。',
      observation: `${name}借水面反光看见通风井里的靴底，数出追兵落地前还有三次齿轮震动。`,
      routePlan: `他让${supportingName}先钻进升降机，自己沿配餐窗爬上横梁，等闸门抬起再荡过去。`,
      civilianRisk:
        '若他开启错一条航线，水下档案库附近仍住着的人会先失去全部身份记录。',
      clockAction: `${name}听不见潮钟了，只能把手按在墙上，用骨头感受齿轮的下一次回落。`,
      clueAction: `${name}把潮钟、蓝墨纸和半幅航图排在配餐台上，四组痕迹刚好对应检修盖的四个卡槽。`,
    },
  };
  const scene = contexts[sequence];
  return [
    ...(priorHookSentence
      ? [
          `${priorHookSentence}这个事实把${name}一路逼到${plan.location}。他没有停下来解释，只按它带来的后果继续往前。`,
        ]
      : []),
    `${plan.location}里，${plan.daily}。声音和物件还按旧日规矩留在原处，先乱掉的是时间。`,
    `${plan.anomaly}。${scene.routine}`,
    `${scene.ambient}城里的日子照常往前挤，异常却已经有了能听见、能碰到的形状。`,
    `${scene.clueAction}它把一件事说明白：${plan.clue}。痕迹很浅，不迎着光根本看不见；缝里还嵌着一丝姐姐封修理单时惯用的红蜡。`,
    `${name}没有立刻把它认作答案。${scene.verify}`,
    `${plan.witness}。${scene.witnessAction}“路可以指给你，后果得你自己带走。”`,
    `${plan.opposition}。${scene.pressureNoise}`,
    `${scene.conceal}他没有把动作做快；越快越像在藏东西。`,
    `${scene.question}${name}没有顺着对方的次序回答，只交出一件可以被核验的事实。`,
    `${scene.usedTrace}${name}没有去看那段准备好的口供，把这处痕迹记在纸边。`,
    `他把线索按时间重新排了一遍，先标出已经核实的事实，再圈出仍可能被人伪造的部分。`,
    `${plan.falseLead}。${name}把它同现有记录逐项核对，到第三项时，日期先对不上。`,
    `${scene.partner}在这时留下了一句可以核验的话。${name}故意把一个时间说错，对方立刻纠正，犹豫随之露了出来。`,
    `“你不信我。”${scene.partner}说。${name}把纸折好：“我信你刚才纠正的那一分钟。”至于其余的话，他没有接。`,
    `${scene.document}${name}用指腹抹掉水汽，让缺失的信息一点点显出来。`,
    `他用铅粉轻扫纸面，缺失的编号一点点显出来。编号与潮钟刻痕相连，也让眼前要查的事第一次有了可见的因果。`,
    `${scene.departure}姐姐教过他，真正临时离开的人才会什么都想带。`,
    `${plan.choice}。${scene.choiceAftermath}`,
    `代价没有等到以后才来。${plan.cost}。${scene.costWitness}`,
    `${scene.personalTrace}${name}看了一眼，没停下手里的动作。`,
    `前方很快出现新的阻拦。${name}先失去时间，又被迫暴露一件随身物，只能用眼前剩下的东西换下一步。`,
    `一次争执之后，${scene.partner}转身要走。${name}没有喊，只把刚发现的蓝印放在能看见的地方。对方走出五步，终究回来补上最后一个方向。`,
    `${scene.environmentShift}锅、船和人都被迫挪位，${name}原定的下一步也换了方向。`,
    `${scene.clockAction}这个动作既在确认线索，也在提醒他没有把责任推给同行的人。`,
    `追来的人终于露面。${scene.observation}`,
    `${scene.routePlan}计划只解决眼前十几步，后面仍要临场判断。`,
    `${scene.civilianRisk}${name}划掉最快的走法，宁可把损失记在自己身上。`,
    `绕行奏效了一半。${scene.tail}${scene.partner}问还要不要继续，约定时间已经所剩不多。`,
    `${name}把剩下的路标折进口袋：“继续。”一扇将被封的门和一条可能错过的潮路已经追到眼前。`,
    `${plan.reveal}。慢七分钟的钟、被换过的编号和有人用过的饭碗由此落进同一条因果。`,
    `身后的巡潮铃变成三短一长，封锁范围开始收紧。${name}把新事实写在纸的内折，不让雨水先碰到它。`,
    `${plan.hook}。${name}听完没有说“我明白了”，只是把原定回程的那一行划掉，在下面写了一个新的时间。`,
  ];
}

export function createBriefDraft(
  brief: WritingBrief,
  previousChapter?: { title: string; content: string },
) {
  const protagonist = brief.characters[0];
  const supporting = brief.characters[1];
  const name = compact(protagonist?.name ?? '', '主角', 40);
  const supportingName = compact(supporting?.name ?? '', '来人', 40);
  const setting = sentenceFragment(
    brief.worldSetting,
    '原有的秩序正在这座城里松动',
    180,
  );
  const inspiration = sentenceFragment(
    brief.inspiration,
    '一条不该出现的线索改变了原来的计划',
    180,
  );
  const goal = sentenceFragment(
    protagonist?.goal ?? '',
    compact(brief.chapterGoal, '完成眼前的任务'),
    100,
  );
  const chapterGoal = sentenceFragment(
    brief.chapterGoal,
    '查清眼前线索的来源',
    160,
  );
  const direction = sentenceFragment(
    brief.plotDirection,
    '眼前的线索正在把局势推向更大的风险',
    160,
  );
  const previousEnding = previousChapter
    ? sentenceFragment(
        previousChapter.content.slice(-180),
        '上一章留下的线索仍未得到回答。',
        180,
      )
    : '';
  const openingArc = createOpeningArcParagraphs(brief, previousChapter);
  if (openingArc) return fitChapterLength(openingArc.join('\n\n'), brief);
  const paragraphs = [
    ...(previousEnding
      ? [
          `那件事还没有结束：${previousEnding}。${name}没有时间重新整理，只能把它当作今天行动的起点。`,
        ]
      : []),
    `${setting}。天色压得很低，远处的声音被风切成断续的碎片。${name}停在门前，没有立刻进去；门缝里透出的光比约定早了整整一刻钟。`,
    `门把手是凉的，指腹却摸到一层尚未干透的水。${name}把手凑近闻了闻，除了铁锈，还有一点烧焦的纸味。屋里没有脚步声，桌下却传来极轻的碰撞，像有人刚把什么东西踢进阴影。`,
    `“出来。”${name}说。声音落下以后，屋里安静了两息。第三息，${supportingName}从帘子后走出来，袖口沾着灰，右手始终藏在身后。`,
    `“你来早了。”${supportingName}看了一眼门外，“这地方今晚不该有人经过。”\n\n“所以你才点灯？”${name}没有往前。两人之间隔着一张窄桌，桌面空空的，边缘却留着一道新鲜划痕。`,
    `${name}想要的很明确：${goal}。但他没有把这句话说出口，只把那道划痕和门外石阶上的泥印对在一起。泥印朝里，没有出去的痕迹。这里不久前还有第三个人。`,
    `${supportingName}终于摊开右手。掌心是一枚磨损严重的金属片，边缘刻着三组不完整的数字。“有人让我交给你。那个人知道你会来，也知道你在找什么。”`,
    `${name}没有接。过去几天里，太多恰到好处的线索把他引向空房、假名字和来迟一步的现场。越像答案的东西，越可能是一扇替人准备好的门。`,
    `窗外响起一声短促的金属摩擦。${name}偏过头，玻璃上映出巷口晃动的影子。那影子没有靠近，只在确认屋里的人数。${supportingName}压低声音：“再不走，就来不及了。”`,
    `${name}拿起金属片，却没有收进口袋。他借着灯光转动它，刻痕里残留着深色粉末。粉末遇到指尖的水汽，慢慢浮出第二层细线，正好补全了缺失的数字。`,
    `那些数字不是地址，而是一组时间。${name}见过同样的排列：它属于一份早已作废的记录。按照官方说法，那一页从未真正执行，可金属片上的磨损证明有人长期带着它。`,
    `“交东西的人呢？”\n\n${supportingName}朝后门看了一眼。这个动作比回答更快。${name}绕过桌子，推门时闻到更重的焦纸味；狭窄的过道尽头堆着一盆灰，灰下压着半张没有烧净的纸。`,
    `纸上能辨认的内容不多，只有一个地点和时间被人用力圈过。圈线在末端突然划向纸外，像书写的人听见了什么，连笔都没来得及放下。`,
    `巷口的影子动了。先是一人，随后是第二人。${name}吹灭灯，把金属片贴着纸面压出拓痕，又将原件塞回${supportingName}手里。“从前门走，让他们看见你带着它。”`,
    `${supportingName}盯着他：“那你呢？”\n\n“我去找被烧掉的另一半。”${name}把拓下的薄纸折进袖口。这个选择不会让局面更安全，却能迫使盯梢的人提前行动。只要他们行动，就会留下方向。`,
    `前门被推开的同时，后巷传来奔跑声。${name}翻过窗台，鞋底落进积水，没有沿巷道直走，而是贴着墙钻进一条只够侧身通过的缝隙。身后的脚步果然分成两路。`,
    `他数着脚步间隔，在第五次回声消失时停住。墙另一边有人喘息，刻意压得很轻。${name}拾起一块碎瓦掷向远处，追来的人立即转身；那一瞬，他看见对方领口别着与金属片相同的记号。`,
    `${direction}。这不再只是推测。有人一面销毁记录，一面又故意把残片送到他手上；两股力量用同一个记号互相牵制，而他刚刚站到了它们中间。`,
    `${name}退回烧纸的屋子时，${supportingName}已经不见了。桌上的灯重新亮起，灯芯旁多了一滴尚未凝固的蜡。有人在他离开的几分钟里进来过，而且知道他还会回来。`,
    `${name}先检查门闩，再检查窗框。没有撬动的痕迹，说明来人拿着钥匙，或者根本没有从门窗进入。屋里的灰尘被踩出两条窄线，一条通向桌边，另一条停在墙角。`,
    `墙角的木板比旁边新，钉帽上还挂着细小的铜屑。${name}用刀尖撬开木板，里面藏着一根卷紧的黑线。黑线没有接到任何机器，却沿着墙缝一路伸向屋顶。`,
    `屋顶传来一声闷响。${name}仰头时，黑线突然绷直，像有人在另一端试探。他没有拉扯，只用刀背轻敲墙面。三下之后，屋外远处传来同样的回声。`,
    `回应不是给他的。巷口那两道影子同时停住，随后其中一道抬手，露出一块反光的表面。${name}把灯芯压低，让屋内重新陷入半明半暗，借着缝隙观察对方的站位。`,
    `他记住了两个人之间的距离，也记住了他们没有互相看一眼。真正负责盯梢的只有一个，另一个只是为了让他误以为自己已经被包围。${name}把这点判断写在心里，没有急着验证。`,
    `后门外忽然滚进一颗玻璃珠。玻璃珠撞到鞋尖，停在离墙三寸的地方。里面封着一小截纸条，纸条上只有一个时间，正好比金属片显示的时间早十分钟。`,
    `${name}把纸条同先前的时间叠在一起，两个缺口正好互相补全。有人在前面留下路径，也有人在后面修改路径；他每走一步，都可能同时替两边完成一次筛选。`,
    `桌下那件先前被踢进去的东西露出一角。${name}俯身拉出来，是一只旧匣子。锁已经被撬开，里面没有文件，只有一段新鲜剪下的线和一张对折的纸。`,
    `纸上先画着一条从旧城区通往封锁线的细路。下面另有一行字，笔迹与被烧毁的记录完全相同。${name}读到最后，手指停在折痕上。`,
    `那行字问：“如果你今晚找到的每一条线索，都是为了让你主动走到这里，那么门外等着你的，究竟是谁？”`,
  ];
  const selected: string[] = [];
  for (const paragraph of paragraphs) {
    selected.push(paragraph);
    if (selected.join('\n\n').length >= brief.targetLength) break;
  }
  return fitChapterLength(selected.join('\n\n'), brief);
}

/**
 * Keep chapter size as a content-quality contract. Expansion happens before
 * the final hook so the ending remains readable; trimming removes whole
 * paragraphs before falling back to a sentence boundary.
 */
export function fitChapterLength(content: string, brief: WritingBrief) {
  const paragraphs = content
    .split(/\n\s*\n/u)
    .map((item) => item.trim())
    .filter(Boolean);
  if (!paragraphs.length) return content;
  const name = compact(brief.characters[0]?.name ?? '', '主角', 40);
  const sequence = openingArcSequence(brief);
  const supportingName =
    sequence === 1
      ? '孙姨'
      : sequence === 2 || sequence === 3
        ? '阿简'
        : compact(brief.characters[1]?.name ?? '', '来人', 40);
  const genericDetailBeats = [
    `${name}没有急着追问。潮气从门缝里钻进来，把纸边卷得发软；他先用袖口压住纸，再看${supportingName}的鞋底，鞋纹里嵌着一粒和屋顶灰烬同色的砂。`,
    `“你到底看见了什么？”${name}问。${supportingName}把话咽回去，伸手去拿桌边的水杯。杯底碰到木面时，他的手指轻轻抖了一下，这个停顿比回答更像回答。`,
    `屋外有人咳嗽，隔着两堵墙，声音被潮风吹得忽远忽近。${name}把灯芯拨低，借着墙上的旧水渍判断屋子的朝向；水渍最高的一道正对着封锁区，涨潮时那里会先积水。`,
    `他把刚才得到的线索拆成三部分：能核对的时间、不能核对的人名，以及必须亲自走一趟的地点。每一部分都不完整，合在一起却足以让原来的安全方案失效。`,
    `${supportingName}说：“现在回头，还来得及。”他说得很平，手却按住了门边那道新刮痕，像在确认某个看不见的机关没有被触发。${name}看见了，却故意没有提醒。`,
    `选择并不因为谁更勇敢而变得容易。${name}想起铺子里还亮着的那盏备用灯，想起答应过邻居天亮前替他们送药；他若离开，今晚就没人知道封锁线内发生了什么。`,
    `他把金属片贴在掌心捂热，刻痕便显出一层细细的蓝。那不是油，也不是锈，而是旧港维修工用来标记潮位的粉末。记忆里姐姐曾说过，真正危险的地方从不把路标写在显眼处。`,
    `两人一前一后穿过狭窄的过道。木板下面传来水声，水声里夹着轻轻的碰撞。${name}停下，先让${supportingName}把鞋脱下来，自己用脚尖探过积水，才发现水面下压着一只没有上锁的铁盒。`,
    `铁盒里没有答案，只有一张被反复折叠的值班表。最早的一行写着三年前的日期，最后一行却是昨天。中间缺了整整七页，缺口边缘留着指甲刮过的毛刺，像有人临时改变了主意。`,
    `${name}把值班表收好，听见远处传来旧钟的第一声。钟声在潮雾里走了很久才抵达，等第二声响起，巷口的影子已经换了位置。有人在移动，也有人在等他移动。`,
    `他终于把话说出口：“今晚把这条线索查到底。”这句话没有让局面变轻，反而让${supportingName}沉默了片刻。沉默之后，对方递来一把钥匙，却只交出钥匙的一半，另一半仍攥在手里。`,
    `门外的风忽然停了。没有风，悬在屋檐下的水珠却一颗颗落下来，砸在石阶上，排成和金属片刻痕相同的间隔。${name}数到第三滴，明白有人已经替他们选好了出路。`,
    `墙上贴着一张褪色的缴费单，户主姓名被潮气洇掉，只剩门牌和月份。${name}把月份同线索里的时间并在一起，发现两者总差七天。不是巧合，是有人按潮汐周期使用这间屋子。`,
    `${supportingName}蹲下系鞋带，系到一半忽然停住。“刚才那个人走路有响声，现在没有了。”${name}顺着他的目光看去，门缝外的影子还在，影子的主人却已经脱掉了湿鞋。`,
    `巷子深处传来锅盖落地的脆响，紧接着有人骂了一句。这样普通的声响让四周显得更安静。${name}记得那家人每天这个时候煮鱼汤，今天烟囱却没有冒烟。`,
    `他们不能一直躲。${name}将一枚旧螺丝塞进门轴，推门时故意让木门发出刺耳的吱呀声。巷口的人果然朝正门靠拢，墙后的呼吸也随之乱了一拍。`,
    `“拿我当饵？”${supportingName}问。${name}没有否认，只把唯一一块干布递过去，让他包住掌心的伤口。两人的合作还谈不上信任，但至少已经有了不能装作没看见的代价。`,
    `石阶下压着几片烂菜叶，叶面却没有被雨打散，说明不久前有人挪动过。${name}掀开最上面一片，找到半枚沾着盐霜的鞋印，鞋尖朝向一堵看似没有门的墙。`,
    `墙后是一条废弃送货道，窄得只能一个人通过。头顶晾着几件来不及收的旧衣服，湿袖子擦过脸颊。${name}闻到其中一件衣服上有机油味，和金属片凹槽里的味道一样。`,
    `线索第一次有了生活里的主人，而不是档案上的编号。有人在这里吃饭、换衣、怕冷，也有人每天替他抹掉出入记录。${name}把衣角翻回原位，没有惊动屋里的人。`,
    `走到拐角，${supportingName}忽然伸手拦住他。一根几乎看不见的细线横在膝盖高度，线头连着一排空玻璃瓶。只要碰响一个，整条街都会知道他们来了。`,
    `${name}没有剪线。他从地上捡起两块砖，垫在细线下方，替后来的人留下一个必须弯腰的缺口。若追兵够急，就会在这里露出携带的东西；若不急，他们便能多出半分钟。`,
    `半分钟不长，足够一个人改口，也足够一条船离岸。${supportingName}望着远处越来越淡的灯影，终于补上先前隐去的那句话。话只说了一半，剩下的一半被急促的钟声吞没。`,
    `钟声不是报时。第一下来自东边，第二下却从脚下传来，像整片街区内部藏着一口更大的钟。${name}把掌心贴上湿墙，震动正沿着砖缝往封锁区深处移动。`,
    `他们沿震动走了十几步，地面突然向一侧轻斜。桌上的空罐滚到墙边，积水也换了方向。${name}扶住门框，变化正在脚底真实发生。`,
    `一扇窗在楼上推开，老太太探出头来收晾着的鱼干。她看见他们，没有呼救，只朝相反方向努了努嘴。${name}道谢，她却低声说：“别谢，回来时替我把门带上。”`,
    `这句叮嘱让退路忽然有了重量。${name}本可以把危险留在身后，却不能把追来的人也带进这条有人生活的巷子。他停下重新安排路线，把最快的那条划掉。`,
    `${supportingName}看懂了他的选择，嘴角动了一下，没有讥讽。“绕路会错过时间。”他说。${name}把表冠拧紧：“那就让时间等我们一次。”`,
    `路口那盏坏灯忽明忽暗，亮起时能看见墙上的旧箭头，熄灭后却显出另一层用炭写的记号。${name}等了三个明灭周期，才确认后者刚被人补过。`,
    `${supportingName}把先前的说法又讲了一遍，这次少了一个地点。${name}没有拆穿，只把两次回答分别记在纸的正反面；缺掉的那部分比留下的更接近真相。`,
    `他们在一间还冒着热气的小厨房外停下。锅里只剩半勺汤，案板上的葱切到一半，主人并非早早离开，而是在几分钟前被什么声音叫走。`,
    `${name}摸过门框上的灰，靠下的一段被衣袖蹭得很干净。来人习惯贴墙走，也知道怎样避开窗内视线，这不是第一次经过这里。`,
    `远处的争吵忽然停住，随后传来关窗声。整条巷子没有人喊危险，住户却按同一个顺序收起门外的东西，说明他们早已学会辨认某种信号。`,
    `${name}把能带走的证据分成两份，一份贴身收好，一份藏回原处。若他被截住，至少还有一条线索能等到下一个愿意追查的人。`,
    `一道脚印在排水沟边消失。${supportingName}以为人已经上墙，${name}却发现沟盖内侧粘着新泥；对方不是离开，而是钻进了他们脚下。`,
    `两人掀开沟盖时，先闻到洗衣粉和湿纸箱的味道。地下并非秘密通道，只是几户人家共用的储物夹层，危险因此同普通生活挤在了一起。`,
    `${supportingName}想借一辆停在墙边的旧车，${name}先摸了摸尚有余温的车座，把手收回。拿走它能省五分钟，也会让一个不相干的人在追问里失去解释。`,
    `追踪者在前方故意留下半扇开着的门。${name}没有从门口经过，而是看向门上方没有晃动的蛛网；这条看似仓促的退路其实早已布置好。`,
    `他绕到后墙，听见里面有人把同一句话练了两遍。第二遍比第一遍更镇定，也更像专门等他来听的答案。`,
    `钟声又近了一格。${name}在纸上划掉一个已经失效的时间，剩余路线顿时只够完成一件事：继续追线索，或先把同行的人送出去。`,
    `${supportingName}没有催他，只把钥匙放在两人中间。${name}最后拿走钥匙，却把唯一的干燥火柴推给对方；选择从这一刻开始有了各自承担的部分。`,
    `他们重新上路时，身后的门没有立刻关。门内的人等脚步走远才轻轻落闩，这一点克制让${name}知道，附近至少还有人希望他们回来。`,
  ];
  const maritimeDetailBeats: Record<number, string[]> = {
    1: [
      `${name}把门闩插回半截，隔壁鱼摊的油锅正好溅出一声响。他顺着声响看去，孙姨已把药包塞进竹篮，嘴里还在骂他欠账。`,
      `潮钟的蓝痕遇到炉火慢慢发亮，${name}用废齿轮垫住表壳，发现每一次亮起都对应街口换岗。`,
      `齐槐的人折返时，孙姨故意掀翻一盆鱼鳞。腥水流满石阶，追兵不得不绕开，${name}第一次欠下一个无法用铜钱还的情。`,
      `${name}在雨棚下把旧港编号抄进修表账本，账本里还夹着邻居没来取的药票。他把药票交给孙姨，自己只带走潮钟。`,
      `旧栈桥的方向被潮雾遮住，远处有人敲响收摊铁门。${name}按住掌心的红印，确认姐姐留下的记号仍比城市早七分钟。`,
    ],
    2: [
      `${name}趴在卖冰船底，听见水面上巡潮艇喊出许可编号。阿简在另一侧划空船，故意让木桨撞上缆桩。`,
      `白线像一层浮在水上的灰，船头刚越过去，身后的水就重新合拢。${name}伸手捞回掉落的旧镊子，没能捞回工具箱。`,
      `棚屋里有人把晾网收得太快，鱼鳞落进水沟，顺流指向一条窄口。${name}把半张航图贴在船板上，折痕正好对上那条口子。`,
      `巡潮铃改成两长一短，阿简说这意味着有人在封港前替他们改过一次路线。${name}没有问是谁，只把空缆绳收进湿麻袋。`,
      `临时泊位在脚下移动，卖冰船撞上废桩又弹开。${name}护住潮钟，周岚的名字从暗舱里传来，像有人在下一站等他们。`,
    ],
    3: [
      `${name}把坏秤推回鱼案下，砝码落地的声音盖住了阿简钻进仓库的脚步。卖虾人朝他眨眼，手里仍忙着给客人找零钱。`,
      `市场向南偏转，裁缝棚的针线盒滑到水边。${name}伸脚勾回盒子，里面压着一枚和航图同色的蓝铅笔。`,
      `齐槐的盘问没有停，摊主们却开始用报鱼价的方式传递位置。每报一次低价，便表示仓库后门还没有人守。`,
      `仓库里传来机芯相撞的脆声，${name}隔着墙听出姐姐修表时常用的三连敲。他没有立刻推门，先看向不远处的热油锅。`,
      `阿简带回一页拘留册，手背被铁丝划开。${name}把自己的袖口撕下一条替他缠住，航图上的日期也因此沾上了血。`,
    ],
    4: [
      `${name}踩过白鹭渡轮的湿甲板，脚下每一块铁板都比上一块热。周岚把茶炉移到舱门旁，免得蒸汽遮住逃生窗。`,
      `巡艇钩索第二次刮过船壳，舱内的花生壳滚进排水槽。${name}用鞋尖挡住，听见水下齿轮开始逆转。`,
      `周岚烧掉航图后，把一只没喝过的茶杯推给${name}。杯底刻着姐姐留下的半个日期，另一半被盐霜盖住。`,
      `他们从送煤槽下到机舱，船工留下的旧手套挂在管线上。${name}借手套包住蓝墨纸，避免它在潮气里再次晕开。`,
      `白鹭渡轮离开泊位时没有鸣笛，只有缆桩发出一声闷响。周岚回头看了三次，第三次终于把那句警告说完整。`,
    ],
    5: [
      `${name}踩着浮起的木凳摸到通风井，水面已经没过食堂灶台。米缸里的药纸贴住他的手背，撕开时留下半个送饭人的姓。`,
      `升降机齿轮卡了一下，周岚从横梁上掉下半截。${name}没有去够录音机，先把她的手从闸板缝里拖出来。`,
      `齐槐在铁门外叫他的名字，声音被水管放大。${name}把空碗一个个踢向相反方向，让回声替他们制造第二条路。`,
      `控制室亮起一盏红灯，墙上的城市图像开始换位。每一次移动，旧食堂的菜单便少一行，像有人正在从生活里删掉一顿饭。`,
      `残存录音只剩十九秒，背景里有送饭铃和潮钟重合的声音。${name}把磁带贴在胸口，直到听清姐姐说她还在城内。`,
    ],
  };
  const expansion = {
    1: {
      place: '修表铺后巷',
      object: '潮钟',
      sound: '收钟队的铜哨',
      path: '鱼摊后的窄巷',
      trace: '红蜡碎屑',
    },
    2: {
      place: '棚屋水道',
      object: '半幅航图',
      sound: '巡潮艇的机轮',
      path: '卖冰船暗舱',
      trace: '新刷的十三号',
    },
    3: {
      place: '盆市西口',
      object: '拘留册',
      sound: '秤砣落进铜盘',
      path: '海关仓库后门',
      trace: '领航站蓝墨',
    },
    4: {
      place: '白鹭渡轮机舱',
      object: '烧剩的航图',
      sound: '钩索刮过船壳',
      path: '送煤槽',
      trace: '中断的盐渍',
    },
    5: {
      place: '第七码头旧食堂',
      object: '进水的录音机',
      sound: '回落的齿轮',
      path: '送饭升降机',
      trace: '新鲜维修签名',
    },
  }[sequence];
  const sharedMaritimeBeats = expansion
    ? [
        `${expansion.place}里传来${expansion.sound}。${name}停住一息，把${expansion.object}贴近衣内，等第二次声响确认方向。`,
        `${supportingName}伸手来接${expansion.object}，${name}没有立刻松手。两人的手在潮气里僵了片刻，最后各自握住一边。`,
        `${expansion.trace}并非新留下的装饰。${name}用指甲刮下一点，和先前留存的样本并在掌心，颜色相同，干燥程度却差了几天。`,
        `他们从${expansion.path}穿过去时，头顶有人拖动桌椅。水从板缝落下，正好打湿地图上唯一没有标号的空白处。`,
        `${name}把那处空白对着灯看，纸纤维里藏着一道针孔。针孔连成歪线，避开所有巡检点，却必须经过${expansion.place}。`,
        `“早一分钟还是晚一分钟？”${supportingName}问。${name}没有抬头：“早一分钟会被看见，晚一分钟会有人替我们受罚。”`,
        `一户人家正在门后分晾不干的衣服，争执声压得很低。听见${expansion.sound}，屋里立刻熄灯，只留下灶膛一点红。`,
        `${name}经过时把歪掉的门板扶回槽里。这个动作耽误了几秒，也让门后的人替他指出追兵没有守住的方向。`,
        `${supportingName}踩到一块松板，木头向下沉了半寸。${name}没有拉人后退，而是蹲下摸板缝，从潮泥里抠出一小段防水线。`,
        `线的一头通向${expansion.object}，另一头已经被割断。切口很新，说明走在前面的人同样时间紧迫，没有余裕收拾痕迹。`,
        `${name}把防水线绕在手腕上，继续前行。粗糙纤维磨着皮肤，每一次抬手都提醒他，这条路不是凭空出现的。`,
        `远处有人报出错误的潮位，${supportingName}下意识回了一句正确数字。声音刚出口，两个人同时看向阴影里的脚步。`,
        `${name}朝相反方向扔出一枚旧螺帽。脚步果然追着金属声偏开，他们借来的十几秒只够走到下一个转角。`,
      ]
    : [];
  const maritimeCausalBeats = expansion
    ? [
        `${expansion.place}外的水位尺少了一截，断口却没有锈。${name}用${expansion.object}比过高度，发现缺掉的刻度恰好遮住今夜的最低潮。`,
        `${supportingName}说这条路昨天还能走。${name}蹲下拨开浮沫，看见石缝里的贝壳全朝同一方向张开；改变的不是记忆，是水流。`,
        `一家小铺正把咸湿的面粉筛出来，老板娘边筛边数远处的铃声。她数到${expansion.sound}时停手，把最靠里的窄门让出半尺。`,
        `${name}没有立刻穿门。他先把一枚铜钱滚进去，铜钱绕了半圈又从门下回来，里面的地面正在缓慢倾斜。`,
        `墙角挂着几件刚洗过的工衣，只有一件袖口沾着${expansion.trace}。${name}记下补丁形状，没有取走衣服；穿它的人还会回到这里。`,
        `${supportingName}在前面催了一声，回应却从后方传来。潮雾把声音折回窄巷，${name}只好盯着积水波纹判断真正的方向。`,
        `一辆送煤车横在路中，车夫不肯挪，说前面有人欠了三袋煤钱。${name}替陌生人补上一枚旧表簧，换来的不是路，而是一句“刚才有人从车底过去”。`,
        `车底留下的水痕很浅，爬过去的人没有带重物。${expansion.object}仍在他们手中，这让${name}第一次确认追兵要抢的也许不是物件，而是他们抵达的位置。`,
        `${name}在拐角停下清点东西：一件证物、半条退路、两个尚未说清的名字。${supportingName}听见他低声报数，才承认自己还藏着一段时间。`,
        `那段时间与${expansion.sound}相差不到半刻。${name}把两者写在掌心，汗水很快洇开墨迹，只剩先后次序还能辨认。`,
        `楼上有人把洗鱼水泼进沟里，水面浮起细碎油花。油花经过东侧砖缝时突然断开，那里藏着一股通往${expansion.place}的暗流。`,
        `他们顺着暗流走，经过一张摆着三副碗筷的矮桌。饭还温着，人却不在；第三只碗底压着与${expansion.trace}同色的一道印。`,
        `${supportingName}伸手去拿碗，${name}按住桌沿。灶火没有灭，说明屋主只是躲开，并没有把东西留给他们。越界拿走证据会先毁掉这里仅存的信任。`,
        `门后传来孩子吸鼻子的声音。${name}把声音压低，只问昨夜有没有听见${expansion.sound}。孩子没回答，却用手指在门板上敲出两短一长。`,
        `两短一长不是巡潮口令，而是旧船工提醒家人收衣服的节奏。${name}把先前的判断划掉；同一种声音落在生活里，意思并不只属于追捕。`,
        `重新判断耽误了他们一轮潮。${supportingName}望向越来越近的灯，脸上第一次有了埋怨，${name}没有辩解，只把下一段路让给对方决定。`,
        `${supportingName}选的近路经过一排住人的棚屋。${name}在入口停住，将${expansion.object}裹进不起眼的旧围裙，免得它的反光把追兵引向窗内。`,
        `棚屋里有人正在给老人换药，剪刀和纱布摆满小桌。经过时，${name}认出药纸上的批号与自己没能送出的那包相同，先前付出的代价在这里有了具体去处。`,
        `追兵的脚步越过第一座木桥，桥板承重的声音却只有一人。${name}示意${supportingName}别回头；对方故意制造了两个人的影子。`,
        `他把${expansion.object}贴在桥柱上，细小震动沿木纹传来。前方有沉重机械启动，频率与${expansion.sound}并不一致，说明封锁还藏着第二套指令。`,
        `第二套指令让沿街门牌同时翻面。住户熟练地把新号码念给孩子听，仿佛每天都要重新学习住址；${name}终于明白，城市的变化早已进入他们的饭桌和账本。`,
        `${supportingName}指着一块刚翻出的门牌，说姐姐曾在上面刻过记号。${name}摸到刻痕边缘的新毛刺，承认这一次对方没有撒谎。`,
        `信任没有因此一次结清。${name}只把后路交给${supportingName}看守，自己仍带着${expansion.object}；两个人能合作的范围被一件具体事情框住。`,
        `他们在下一次换位前越过窄桥。桥身转动时，卖早点的炉子差点滑进水里，${name}回身帮店主顶住车轮，眼看着最近的出口在面前合上。`,
        `店主把一块垫车轮的木楔塞给他。木楔背面写着旧泊位号，末尾数字被反复刮改，最近一次正指向${expansion.place}。`,
        `${name}把木楔和先前的线索并在一起，第一次得到不依赖任何人口供的证据。${supportingName}也看懂了，终于说出自己一直回避的那个人名。`,
        `名字出口后，远处立刻有人吹响短哨。不是巧合。附近一直有人等着确认他们何时把零散痕迹拼成答案。`,
        `${name}熄掉手边的灯，却没有马上逃。他借最后一点余光看清哨声方向，将追兵、${expansion.place}和下一次潮位排进同一条路。`,
      ]
    : [];
  const detailBeats = expansion
    ? [
        ...(maritimeDetailBeats[sequence] ?? []),
        ...sharedMaritimeBeats,
        ...maritimeCausalBeats,
      ]
    : genericDetailBeats;
  const target = Math.min(
    MAX_CHAPTER_LENGTH,
    Math.max(MIN_CHAPTER_LENGTH, Math.round(brief.targetLength)),
  );
  let index = [...brief.chapterTitle, ...brief.chapterGoal].reduce(
    (total, character) => total + (character.codePointAt(0) ?? 0),
    0,
  );
  const last = paragraphs.pop() ?? '';
  const usedParagraphs = new Set(paragraphs.map((item) => item.trim()));
  while (paragraphs.join('\n\n').length + last.length + 2 < target) {
    let next = '';
    for (let attempt = 0; attempt < detailBeats.length; attempt += 1) {
      const candidate = detailBeats[index % detailBeats.length].trim();
      index += 1;
      if (
        !usedParagraphs.has(candidate) &&
        !paragraphHasNearDuplicate(candidate, paragraphs)
      ) {
        next = candidate;
        break;
      }
    }
    if (!next) break;
    paragraphs.push(next);
    usedParagraphs.add(next);
    if (paragraphs.length > 80) break;
  }
  paragraphs.push(last);
  let result = paragraphs.join('\n\n');
  if (result.length <= MAX_CHAPTER_LENGTH) return result;
  while (paragraphs.length > 2 && result.length > MAX_CHAPTER_LENGTH) {
    paragraphs.splice(Math.max(1, paragraphs.length - 2), 1);
    result = paragraphs.join('\n\n');
  }
  if (result.length > MAX_CHAPTER_LENGTH) {
    const clipped = result.slice(0, MAX_CHAPTER_LENGTH);
    const boundary = Math.max(
      clipped.lastIndexOf('。'),
      clipped.lastIndexOf('！'),
      clipped.lastIndexOf('？'),
    );
    result = clipped.slice(
      0,
      boundary > MIN_CHAPTER_LENGTH ? boundary + 1 : MAX_CHAPTER_LENGTH,
    );
  }
  return result;
}

function paragraphNgrams(value: string, size = 5) {
  const normalized = value
    .replace(/[\s，。！？；：、“”‘’「」『』（）()、,.!?;:'"—…]/gu, '')
    .trim();
  const grams = new Set<string>();
  if (normalized.length < size) return grams;
  for (let index = 0; index <= normalized.length - size; index += 1) {
    grams.add(normalized.slice(index, index + size));
  }
  return grams;
}

function paragraphHasNearDuplicate(candidate: string, paragraphs: string[]) {
  const candidateGrams = paragraphNgrams(candidate);
  if (candidateGrams.size < 8) return false;
  return paragraphs.some((paragraph) => {
    const existingGrams = paragraphNgrams(paragraph);
    if (existingGrams.size < 8) return false;
    let shared = 0;
    for (const gram of candidateGrams) {
      if (existingGrams.has(gram)) shared += 1;
    }
    const smaller = Math.min(candidateGrams.size, existingGrams.size);
    return shared >= 10 && shared / smaller >= 0.35;
  });
}

export function isChapterLengthValid(content: string) {
  return (
    content.length >= MIN_CHAPTER_LENGTH && content.length <= MAX_CHAPTER_LENGTH
  );
}

export function createDemoDraft() {
  return [
    '雨水顺着停电后的招牌往下淌，许照把最后一枚电池推到柜台中央。',
    '“城南还有灯。”老板没有碰电池，只盯着他的袖口，“你从哪儿看见的？”',
    '许照想起河对岸那三次规律的闪烁。妹妹失踪前，也用同样的节奏敲过他的房门。',
    '门外忽然响起两短一长的敲击。',
    '老板脸色变了：“别开门。”',
    '许照已经握住门把手。门缝下，一张被雨浸透的纸慢慢滑了进来，上面只有妹妹的名字。',
  ].join('\n\n');
}

function narrativeAnchorTokens(value: string) {
  const tokens = new Set<string>();
  for (const match of value.matchAll(/[\p{Script=Han}]{2,16}/gu)) {
    const chunk = match[0];
    for (const length of [2, 3, 4]) {
      for (let index = 0; index <= chunk.length - length; index += 1) {
        const token = chunk.slice(index, index + length);
        if (
          !continuityStopPhrases.has(token) &&
          !/^(?:的|了|是|在|有|和|也|都|而|又|将|把|被|与|就|还|只|很|着|过|让|给|从|对|向|于)+$/u.test(
            token,
          )
        )
          tokens.add(token);
      }
    }
  }
  return [...tokens].slice(0, 160);
}

export function reviewDraft(
  content: string,
  context?: {
    targetLength?: number;
    protagonistName?: string;
    protagonistGoal?: string;
    chapterTitle?: string;
    previousEnding?: string;
  },
): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  for (const match of content.matchAll(/([!?！？。，])\1+/g)) {
    findings.push({
      reviewType: 'basic',
      dimension: '标点',
      severity: 'warning',
      startOffset: match.index,
      endOffset: (match.index ?? 0) + match[0].length,
      message: '检测到连续重复标点。',
      suggestion: '保留一个符合语气的标点，避免依赖符号堆叠制造强度。',
    });
  }
  const paragraphs = content.split(/\n\s*\n/).filter(Boolean);
  const paragraphCounts = new Map<string, number>();
  for (const paragraph of paragraphs) {
    const normalized = paragraph.replace(/\s+/gu, ' ').trim();
    if (normalized.length < 20) continue;
    paragraphCounts.set(normalized, (paragraphCounts.get(normalized) ?? 0) + 1);
  }
  const repeatedParagraphs = [...paragraphCounts.values()].filter(
    (count) => count > 1,
  ).length;
  findings.push({
    reviewType: 'basic',
    dimension: '段落重复',
    severity: repeatedParagraphs ? 'error' : 'info',
    message: repeatedParagraphs
      ? `发现 ${repeatedParagraphs} 组完全重复的正文段落，成稿不得依靠复制段落补足篇幅。`
      : '未发现完全重复的正文段落。',
    suggestion: repeatedParagraphs
      ? '删除重复段落，并用新的行动、交锋、环境变化或选择后果补足缺失内容。'
      : '继续检查意思近似但措辞不同的变相重复。',
  });
  let nearDuplicatePairs = 0;
  for (let index = 0; index < paragraphs.length; index += 1) {
    if (
      paragraphHasNearDuplicate(paragraphs[index], paragraphs.slice(0, index))
    ) {
      nearDuplicatePairs += 1;
    }
  }
  if (nearDuplicatePairs) {
    findings.push({
      reviewType: 'basic',
      dimension: '变相重复',
      severity: 'warning',
      message: `发现 ${nearDuplicatePairs} 处与前文共享大量连续语块的段落，可能是在换说法重复同一动作或信息。`,
      suggestion:
        '保留真正改变局势的一次表达，其余段落改为新的感官细节、人物反应或因果后果。',
    });
  }
  const longSentences = [...content.matchAll(/[^。！？!?]{100,}[。！？!?]/gu)];
  if (longSentences.length) {
    findings.push({
      reviewType: 'basic',
      dimension: '句子',
      severity: 'warning',
      startOffset: longSentences[0].index,
      endOffset: (longSentences[0].index ?? 0) + longSentences[0][0].length,
      message: `发现 ${longSentences.length} 个过长句子，阅读时容易失去重心。`,
      suggestion:
        '在动作完成、视线变化或信息落点处断句，不要用多个逗号承载整段解释。',
    });
  }
  const targetLength = context?.targetLength;
  if (targetLength) {
    const validLength = isChapterLengthValid(content);
    findings.push({
      reviewType: 'basic',
      dimension: '篇幅',
      severity: validLength ? 'info' : 'error',
      message: validLength
        ? `正文 ${content.length} 字符，符合 ${MIN_CHAPTER_LENGTH}–${MAX_CHAPTER_LENGTH} 字硬性标准。`
        : `正文 ${content.length} 字符，未达到 ${MIN_CHAPTER_LENGTH}–${MAX_CHAPTER_LENGTH} 字硬性标准。`,
      suggestion:
        content.length < MIN_CHAPTER_LENGTH
          ? '补足行动过程、人物交锋、环境作用、因果过程和选择造成的后果，不要只增加背景说明。'
          : content.length > MAX_CHAPTER_LENGTH
            ? '删去重复解释，保留改变局势的动作和信息；不得截断句子或章尾承诺。'
            : '保持当前密度，优先检查段落是否都推动了局势。',
    });
  }
  if (context?.previousEnding) {
    const previousEnding = sentenceFragment(context.previousEnding, '', 80);
    const opening = content.slice(0, 600);
    const sharedAnchors = narrativeAnchorTokens(context.previousEnding).filter(
      (token) => opening.includes(token),
    );
    const protagonistCarries = Boolean(
      context.protagonistName &&
      context.previousEnding.includes(context.protagonistName) &&
      opening.includes(context.protagonistName),
    );
    const connected =
      (previousEnding.length >= 12 && content.includes(previousEnding)) ||
      sharedAnchors.length >= 2 ||
      (protagonistCarries && sharedAnchors.length >= 1);
    findings.push({
      reviewType: 'expert',
      dimension: '章节衔接',
      severity: connected ? 'info' : 'warning',
      message: connected
        ? '本章承接了上一章的末尾信息。'
        : '本章没有明确回应上一章结尾留下的信息。',
      suggestion: connected
        ? '允许换场，但要让上一章的线索、关系或后果继续产生作用。'
        : '在开篇或前两段补一个承接点，让读者知道上一章发生的事没有被丢下。',
    });
    const hasTimeBridge =
      /次日|翌日|第二天|天亮后|入夜后|几小时后|半天后|与此同时|另一边|后来|三天后/u.test(
        opening,
      );
    const environmentJump = [
      ['雨', /晴空|烈日|阳光灿烂/u],
      ['深夜', /正午|午后|清晨/u],
      ['停电', /灯火通明|霓虹闪烁/u],
      ['封锁', /人来人往|自由进出/u],
    ].find(
      ([before, after]) =>
        context.previousEnding?.includes(before as string) &&
        (after as RegExp).test(opening),
    );
    if (environmentJump && !hasTimeBridge) {
      findings.push({
        reviewType: 'expert',
        dimension: '时空连续性',
        severity: 'warning',
        message: `上一章的“${environmentJump[0]}”与本章开篇环境发生明显变化，但没有看到时间、地点或因果过渡。`,
        suggestion:
          '补一个明确的时间或地点锚点，并让环境变化对人物行动产生影响；若没有转场，则修正冲突状态。',
      });
    }
  }
  const awkwardPattern =
    /(?:可|但)(?:他|她|\p{Script=Han}{1,4})同样清楚[，,]|重新确认了自己的目标|做出了选择，也因此|最可靠的事实可能是假的/gu;
  const awkwardMatches = [...content.matchAll(awkwardPattern)];
  findings.push({
    reviewType: 'expert',
    dimension: '句法与语感',
    severity: awkwardMatches.length ? 'warning' : 'info',
    message: awkwardMatches.length
      ? `发现 ${awkwardMatches.length} 处模板化或衔接生硬的表达。`
      : '未发现明显的模板化衔接或病句。',
    suggestion: awkwardMatches.length
      ? '把人物设定改写成可观察的动作、停顿、误判或对话，让读者自己得出结论。'
      : '继续朗读检查主谓搭配和句间因果，避免只凭句子短就判断为简洁。',
  });
  const templatePattern =
    /重新确认了自己的目标|可他同样清楚|做出了选择，也因此|最可靠的事实可能是假的|眼前出现的细节让.{0,12}站不住脚/gu;
  const templateMatches = [...content.matchAll(templatePattern)];
  findings.push({
    reviewType: 'expert',
    dimension: '模板化表达',
    severity: templateMatches.length ? 'warning' : 'info',
    startOffset: templateMatches[0]?.index,
    endOffset: templateMatches[0]
      ? (templateMatches[0].index ?? 0) + templateMatches[0][0].length
      : undefined,
    message: templateMatches.length
      ? `发现 ${templateMatches.length} 处容易产生“AI味”的总结式表达。`
      : '未发现明显的总结式套话。',
    suggestion: templateMatches.length
      ? '优先改成可见动作、物件细节或带立场的对话，不替读者直接下结论。'
      : '保留具体、带上下文的表达，避免连续使用抽象判断句。',
    memoryCandidate: templateMatches.length
      ? {
          kind: 'weakness',
          title: '避免总结式心理旁白',
          rule: '人物性格和判断要通过动作、停顿、物件或对话呈现，不直接替读者下结论。',
        }
      : undefined,
  });
  const craftPattern =
    /第\s*\d+\s*章\s*[：:｜|]|建立日常与异常[：:]|第一次选择[：:]|阻力显形[：:]|短暂盟友[：:]|第一次兑现[：:]|当前章节任务|上一章《/gu;
  const craftMatches = [...content.matchAll(craftPattern)];
  if (craftMatches.length) {
    findings.push({
      reviewType: 'expert',
      dimension: '成稿痕迹',
      severity: 'warning',
      startOffset: craftMatches[0]?.index,
      endOffset: craftMatches[0]
        ? (craftMatches[0].index ?? 0) + craftMatches[0][0].length
        : undefined,
      message: `发现 ${craftMatches.length} 处大纲或工作台术语混入正文。`,
      suggestion:
        '把任务说明转成角色当下能感知的事实、动作或对话，不要把章节功能写给读者看。',
    });
  }
  if (
    context?.chapterTitle?.includes('第七码头') &&
    /林家修表铺|修表铺里/u.test(content)
  ) {
    findings.push({
      reviewType: 'expert',
      dimension: '场景连续性',
      severity: 'warning',
      message: '本章地点是第七码头，却出现了前章修表铺的固定场景。',
      suggestion:
        '将动作改写为当前地点能容纳的行为，让换场后的空间、物件和人物职责保持一致。',
    });
  }
  const dialogueCount = (content.match(/[“”]/g) ?? []).length / 2;
  const actionCount = (
    content.match(/推|拉|停|走|跑|抬|伸|接|转|翻|拾|折|握|看|听|闻/g) ?? []
  ).length;
  const sensoryCount = (
    content.match(/光|影|声音|脚步|气味|风|雨|凉|热|灰|水|暗/g) ?? []
  ).length;
  const hasSceneTexture =
    paragraphs.length >= 8 &&
    dialogueCount >= 2 &&
    actionCount >= 8 &&
    sensoryCount >= 5;
  findings.push({
    reviewType: 'expert',
    dimension: '场景塑造',
    severity: hasSceneTexture ? 'info' : 'warning',
    message: hasSceneTexture
      ? '正文具备动作、对话和感官细节，人物关系通过场景展开。'
      : '正文更接近情节摘要，动作、对话或感官细节不足。',
    suggestion: hasSceneTexture
      ? '检查细节是否服务于人物判断，删掉只负责装饰气氛的描写。'
      : '至少补出一个可见动作链、一次有目的的对话交锋和一种持续的环境压力。',
  });
  const abstractMindCount = (
    content.match(
      /他(?:很)?清楚|她(?:很)?清楚|意识到|终于明白|心里知道|觉得自己|决定要|不愿意|内心/u,
    ) ?? []
  ).length;
  const characterShown =
    actionCount >= Math.max(4, abstractMindCount * 3) && dialogueCount >= 1;
  findings.push({
    reviewType: 'expert',
    dimension: '人物展示',
    severity: characterShown ? 'info' : 'warning',
    message: characterShown
      ? '人物主要通过动作和交锋显露立场，解释性心理旁白占比较低。'
      : '人物态度主要由旁白说明，缺少能让读者自行判断的动作或对话。',
    suggestion: characterShown
      ? '继续为主要人物保留不同的动作习惯和说话策略。'
      : '删去一处“知道、明白、决定、不愿”的结论，改成手部动作、停顿、拒绝或答非所问。',
    memoryCandidate: characterShown
      ? undefined
      : {
          kind: 'weakness',
          title: '人物态度需要展示而非说明',
          rule: '每个关键态度至少通过一次动作或对话让读者自行判断，减少“知道、明白、决定、不愿”等解释性旁白。',
        },
  });
  const livingDetailCount = (
    content.match(
      /饭|茶|碗|筷|油烟|晾衣|衣角|衣领|摊位|铺子|邻居|收音机|热水|门帘|菜叶|米袋|药瓶|账本|凳子|粥|口粮|水杯/gu,
    ) ?? []
  ).length;
  const living = livingDetailCount >= 3 && paragraphs.length >= 4;
  findings.push({
    reviewType: 'expert',
    dimension: '生活气息',
    severity: living ? 'info' : 'warning',
    message: living
      ? `检测到 ${livingDetailCount} 处生活物件或使用痕迹，环境不只承担气氛。`
      : '环境描写偏抽象，缺少人物真正生活过的物件、声音或使用痕迹。',
    suggestion: living
      ? '让生活细节继续参与人物选择，避免只作背景摆设。'
      : '补入至少两处与人物行动有关的生活痕迹，例如吃剩的饭、磨旧的衣物、邻里声音或被使用过的器具。',
    memoryCandidate: living
      ? undefined
      : {
          kind: 'weakness',
          title: '环境需要生活使用痕迹',
          rule: '环境至少出现两处具体生活物件、日常动作或空间使用痕迹，并与人物选择发生关系。',
        },
  });
  const conflictSignals = (
    content.match(
      /拒绝|阻止|逼|拦|代价|暴露|受伤|失去|威胁|交换|不肯|来不及|追上|追来|被迫/gu,
    ) ?? []
  ).length;
  const choiceSignals = (
    content.match(
      /只好|于是|决定|没有接|没有走|按住|推开|转身|藏|交给|留下|选择/gu,
    ) ?? []
  ).length;
  const conflictDense = conflictSignals >= 2 && choiceSignals >= 2;
  findings.push({
    reviewType: 'expert',
    dimension: '冲突密度',
    severity: conflictDense ? 'info' : 'warning',
    message: conflictDense
      ? '冲突包含阻力、回应和选择，局势有连续变化。'
      : '冲突推进偏平，信息增加了，但人物的阻力、选择或代价不够连续。',
    suggestion: conflictDense
      ? '检查每次升级是否改变下一步行动，而不是只增加说明。'
      : '每三至四段至少安排一次阻力与回应，并让人物失去时间、信任、资源或安全中的一项。',
    memoryCandidate: conflictDense
      ? undefined
      : {
          kind: 'weakness',
          title: '冲突推进必须带来选择或代价',
          rule: '信息不能平推；每次升级都要迫使人物回应，并让时间、信任、资源或安全至少损失一项。',
        },
  });
  if (paragraphs.some((paragraph) => paragraph.length > 420)) {
    findings.push({
      reviewType: 'basic',
      dimension: '段落',
      severity: 'info',
      message: '存在超过 420 字的长段落。',
      suggestion: '按动作变化、观察对象或说话人变化重新分段。',
    });
  }
  const ending = inspectEnding(content);
  findings.push({
    reviewType: 'expert',
    dimension: '结构力',
    severity: ending.score >= 3 ? 'info' : 'warning',
    message:
      ending.score >= 3
        ? '场景结尾形成了明确的信息缺口。'
        : '场景结尾的继续阅读动机还不够具体。',
    suggestion:
      ending.score >= 3
        ? '下一场景尽快兑现纸条来源，避免无故延迟。'
        : '在结尾加入会改变人物下一步选择的新事实。',
    memoryCandidate:
      ending.score >= 3
        ? undefined
        : {
            kind: 'weakness',
            title: '章尾缺少可兑现的信息缺口',
            rule: '章尾优先留下具体问题、未完成行动或改变局势的新事实。',
          },
  });
  const protagonistName = context?.protagonistName ?? '主角';
  const protagonistGoal = context?.protagonistGoal ?? '当前目标';
  const protagonistPresent = content.includes(protagonistName);
  const personHasAction = protagonistPresent && actionCount >= 5;
  findings.push({
    reviewType: 'expert',
    dimension: '人物力',
    severity: personHasAction ? 'info' : 'warning',
    message: personHasAction
      ? `${protagonistName}的行动围绕“${protagonistGoal}”展开，选择带来了即时风险。`
      : '人物目标还停留在设定说明，正文中缺少能改变局面的主动选择。',
    suggestion: personHasAction
      ? '继续让每次推进都暴露一点人物代价，避免只靠旁白解释动机。'
      : '让人物为了目标做出一个会失去东西的选择，再用动作和后果呈现性格。',
  });
  // ---- 头号写手 v2：去AI味阻断/提醒分层 + 节奏曲线 ----
  const aiAudit = auditAiTaste(content);
  if (aiAudit.blockedCount > 0) {
    findings.push({
      reviewType: 'expert',
      dimension: 'AI味阻断词',
      severity: aiAudit.blockedCount >= 3 ? 'error' : 'warning',
      message: `命中 ${aiAudit.blockedCount} 处禁用表达：${aiAudit.blockedHits
        .slice(0, 4)
        .map((hit) => hit.pattern)
        .join('；')}${aiAudit.blockedCount > 4 ? '…' : ''}。`,
      suggestion: '按“动作/物件/对话”替换成具体描写，阻断词表可一键改写。',
      memoryCandidate: {
        kind: 'weakness',
        title: '禁用表达自动替换',
        rule: '命中禁用词表时优先替换为动作、物件或带立场的对话。',
      },
    });
  } else {
    findings.push({
      reviewType: 'expert',
      dimension: 'AI味阻断词',
      severity: 'info',
      message: '未命中禁用表达词表。',
      suggestion: '继续用提醒级规则复查疑似 AI 句式。',
    });
  }
  if (aiAudit.suspiciousCount > 0) {
    findings.push({
      reviewType: 'expert',
      dimension: 'AI味提醒词',
      severity: 'warning',
      message: `发现 ${aiAudit.suspiciousCount} 处疑似 AI 句式（${aiAudit.suspiciousHits
        .slice(0, 3)
        .map((hit) => hit.pattern)
        .join('、')}${aiAudit.suspiciousCount > 3 ? '…' : ''}），不强制替换但建议人工复核。`,
      suggestion: '逐处判断是否换成更具体的感官细节或人物动作。',
    });
  }
  const pacing = analyzePacing(content);
  const pacingRisks = pacing.tensionHints;
  if (pacingRisks.length > 0 && pacing.paragraphCount >= 6) {
    findings.push({
      reviewType: 'expert',
      dimension: '节奏曲线',
      severity: 'warning',
      message: `节奏检测：${pacingRisks.join('；')}（情绪 ${pacing.emotionScore}，信息密度 ${pacing.infoDensity}，对话占比 ${Math.round(pacing.dialogueRatio * 100)}%）。`,
      suggestion: '按提示调整对应段落：短句区补细节、对话区加动作、负面情绪区留转机。',
    });
  } else {
    findings.push({
      reviewType: 'expert',
      dimension: '节奏曲线',
      severity: 'info',
      message: `节奏检测：情绪 ${pacing.emotionScore}、信息密度 ${pacing.infoDensity}、对话占比 ${Math.round(pacing.dialogueRatio * 100)}%、短句占比 ${Math.round(pacing.shortSentenceRatio * 100)}%。`,
      suggestion: '节奏均衡，可在信息密度高的段落主动放慢。',
    });
  }
  return findings;
}
