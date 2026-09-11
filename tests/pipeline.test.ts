import assert from 'node:assert/strict';
import test from 'node:test';

import { demoBookText } from '../lib/demo-text.ts';
import {
  analyzeBook,
  auditContinuity,
  buildContinuityFeedback,
  buildContinuityPrompt,
  captureChapterPromise,
  compileWritingPrompt,
  createDemoDraft,
  createBriefDraft,
  createOutline,
  defaultWritingBrief,
  isChapterLengthValid,
  MAX_CHAPTER_LENGTH,
  MIN_CHAPTER_LENGTH,
  normalizeWritingBrief,
  polishDraft,
  reviewDraft,
  segmentBook,
} from '../lib/pipeline.ts';

void test('segments a chaptered Chinese novel without losing offsets', () => {
  const chapters = segmentBook(demoBookText);
  assert.equal(chapters.length, 12);
  assert.equal(chapters[0].startOffset, 0);
  assert.equal(chapters.at(-1)?.endOffset, demoBookText.length);
  assert.match(chapters[0].label, /第一章/);
});

void test('selects the top ten percent and creates evidence-backed techniques', () => {
  const result = analyzeBook(demoBookText, '章尾钩子与逻辑衔接');
  assert.equal(result.chapters.length, 12);
  assert.ok(result.evidence.length >= 2);
  assert.ok(result.techniques.length >= 1);
  assert.ok(result.evidence.every((item) => item.excerpt.length <= 220));
  assert.ok(
    result.techniques.every((item) => item.evidenceIndexes.length >= 1),
  );
  assert.ok(
    ['structure', 'character', 'core', 'material'].every((kind) =>
      result.insights.some((item) => item.kind === kind),
    ),
  );
  assert.ok(result.insights.every((item) => item.content.avoidWhen));
});

void test('compiles only confirmed abstract techniques into the writing prompt', () => {
  const technique = analyzeBook(demoBookText, '章尾钩子').techniques[0];
  const prompt = compileWritingPrompt({
    brief: normalizeWritingBrief({
      ...defaultWritingBrief,
      inspiration: '失踪案',
      characters: [
        {
          name: '调查员',
          role: '追查真相的人',
          goal: '发现线索',
          conflict: '不敢相信熟人',
        },
      ],
      chapterGoal: '发现线索',
    }),
    techniques: [technique],
  });
  assert.match(prompt.role, /不得复刻/);
  assert.ok(prompt.priorities.some((item) => item.includes(technique.title)));
  assert.match(prompt.assembled, /世界背景/);
  assert.match(prompt.assembled, /角色 1/);
});

void test('compiles confirmed brain insights without copying source prose', () => {
  const prompt = compileWritingPrompt({
    brief: defaultWritingBrief,
    techniques: [],
    weaknesses: [
      {
        kind: 'weakness',
        title: '少用总结旁白',
        content: { rule: '用动作呈现人物立场。' },
      },
    ],
    insights: [
      {
        kind: 'character',
        title: '行动与回应',
        content: {
          rule: '人物行动后必须得到他人回应。',
          application: '关系试探',
        },
      },
    ],
  });
  assert.match(prompt.assembled, /已确认避坑规则：少用总结旁白/);
  assert.match(prompt.assembled, /拆书精华（character）：行动与回应/);
});

void test('normalizes a structured writing brief and drafts from user inspiration', () => {
  const brief = normalizeWritingBrief({
    title: '海上旧城',
    inspiration: '一座会移动的海上城市藏着失踪者的记忆。',
    worldSetting: '潮汐每晚改变街区位置。',
    characters: [
      {
        name: '林岸',
        role: '修表匠',
        goal: '找到姐姐',
        conflict: '害怕再次失去',
      },
      { name: '周岚', role: '领航员', goal: '守住航线', conflict: '隐瞒旧案' },
    ],
    chapterGoal: '在旧钟里发现姐姐的坐标。',
    targetLength: 1600,
    constraints: ['每次转折都要有前置线索'],
  });
  assert.equal(brief.characters.length, 2);
  assert.equal(brief.targetLength, 4000);
  const draft = createBriefDraft(brief);
  assert.match(draft, /海上旧城|潮汐/);
  assert.match(draft, /林岸/);
  assert.match(draft, /姐姐/);
  assert.ok(draft.length >= MIN_CHAPTER_LENGTH);
  assert.ok(draft.length <= MAX_CHAPTER_LENGTH);
  assert.doesNotMatch(draft, /可他同样清楚/);
});

void test('creates a twenty-chapter outline and carries forward the prior chapter', () => {
  const brief = normalizeWritingBrief({
    ...defaultWritingBrief,
    title: '连续性测试',
    chapterTitle: '第二章',
    chapterGoal: '确认门后的声音来自谁',
  });
  const outline = createOutline(brief);
  assert.equal(outline.split('\n').length, 20);
  const draft = createBriefDraft(brief, {
    title: '第一章',
    content: '门缝里留下了一枚带血的钥匙。',
  });
  assert.match(draft, /那件事还没有结束/);
  assert.match(draft, /带血的钥匙/);
});

void test('generates five distinct opening chapters without leaking outline language', () => {
  const goals = [
    '建立日常与异常：林岸发现一条无法解释的线索',
    '第一次选择：为了追查线索，人物主动越过一条安全边界',
    '阻力显形：最先出现的对手让目标变得更具体',
    '短暂盟友：人物得到帮助，但必须交换一个秘密',
    '第一次兑现：早期伏笔给出局部答案，同时带来新问题',
  ];
  const brief = normalizeWritingBrief({
    ...defaultWritingBrief,
    title: '海上旧城',
    worldSetting: '潮汐每晚改变街区位置，旧钟会指向一段被抹去的航线。',
    plotDirection: '线索指向被封锁的旧港。',
    characters: [
      {
        name: '林岸',
        role: '修表匠',
        goal: '寻找姐姐',
        conflict: '不信陌生人',
      },
      { name: '周岚', role: '领航员', goal: '守住航线', conflict: '隐瞒旧案' },
    ],
    targetLength: 4000,
  });
  let previous: { title: string; content: string } | undefined;
  const chapters = goals.map((chapterGoal, index) => {
    const chapterBrief = {
      ...brief,
      chapterTitle: `第 ${index + 1} 章`,
      chapterGoal,
    };
    const content = createBriefDraft(chapterBrief, previous);
    previous = { title: chapterBrief.chapterTitle, content };
    assert.ok(isChapterLengthValid(content));
    assert.doesNotMatch(content, /当前章节任务|前四章|上一章《/u);
    const paragraphs = content
      .split(/\n\s*\n/u)
      .map((item) => item.replace(/\s+/gu, ' ').trim())
      .filter((item) => item.length >= 20);
    assert.equal(new Set(paragraphs).size, paragraphs.length);
    assert.ok(
      !reviewDraft(content, {
        targetLength: 4000,
        chapterTitle: chapterBrief.chapterTitle,
      }).some(
        (item) =>
          item.dimension === '成稿痕迹' ||
          (item.dimension === '段落重复' && item.severity === 'error') ||
          (item.dimension === '变相重复' && item.severity === 'warning'),
      ),
    );
    return content;
  });
  assert.doesNotMatch(chapters[0], /周岚/u);
  assert.doesNotMatch(chapters[4], /林家修表铺|修表铺里/u);
  assert.equal(new Set(chapters).size, 5);
});

void test('accepts causal chapter carryover and flags an unexplained environment jump', () => {
  const connected = reviewDraft('林岸攥着带血的钥匙推开审讯室。', {
    previousEnding: '深夜里，门缝下留下了一枚带血的钥匙。',
    protagonistName: '林岸',
  });
  assert.ok(
    connected.some(
      (item) => item.dimension === '章节衔接' && item.severity === 'info',
    ),
  );
  const jumped = reviewDraft('正午烈日下，林岸走进灯火通明的大厅。', {
    previousEnding: '深夜仍在下雨，全城停电，林岸守在门边。',
    protagonistName: '林岸',
  });
  assert.ok(jumped.some((item) => item.dimension === '时空连续性'));
});

void test('flags thin or awkward prose instead of giving fixed praise', () => {
  const findings = reviewDraft(
    '林岸重新确认了自己的目标。可他同样清楚，习惯把所有责任揽在自己身上。',
    { targetLength: 1600 },
  );
  assert.ok(
    findings.some(
      (item) => item.dimension === '篇幅' && item.severity === 'error',
    ),
  );
  assert.ok(
    findings.some(
      (item) => item.dimension === '句法与语感' && item.severity === 'warning',
    ),
  );
  assert.ok(
    findings.some(
      (item) => item.dimension === '场景塑造' && item.severity === 'warning',
    ),
  );
});

void test('reviews the generated original scene with expert dimensions', () => {
  const findings = reviewDraft(createDemoDraft());
  assert.ok(
    findings.some(
      (item) => item.reviewType === 'expert' && item.dimension === '结构力',
    ),
  );
  assert.ok(
    findings.some(
      (item) => item.reviewType === 'expert' && item.dimension === '人物力',
    ),
  );
});

void test('polishes summary-like prose with lived-in and behavioral detail', () => {
  const brief = normalizeWritingBrief({
    ...defaultWritingBrief,
    characters: [
      {
        name: '林岸',
        role: '修表匠',
        goal: '找到姐姐',
        conflict: '不信任陌生人',
      },
      { name: '周岚', role: '领航员', goal: '守住航线', conflict: '隐瞒旧案' },
    ],
  });
  const draft = [
    '林岸重新确认了自己的目标。',
    '可他同样清楚，自己不愿信任陌生人。',
    '他走进房间，看到桌上的信。',
    '周岚没有回答。',
  ].join('\n\n');
  const result = polishDraft(draft, brief);
  assert.doesNotMatch(result.polished, /重新确认了自己的目标|可他同样清楚/);
  assert.match(result.polished, /卷帘门|面|塑料凳/);
  assert.match(result.polished, /手已经碰到门闩|袖口|掌心/);
  assert.ok(result.appliedChanges.length >= 3);
});

void test('reviews AI-like prose across specific mechanism dimensions', () => {
  const findings = reviewDraft(
    '他重新确认了自己的目标。眼前出现的细节让判断站不住脚。他继续调查，又发现一条信息。',
    { targetLength: 1000, protagonistName: '林岸' },
  );
  assert.ok(
    findings.some(
      (item) => item.dimension === '模板化表达' && item.severity === 'warning',
    ),
  );
  assert.ok(
    findings.some(
      (item) => item.dimension === '生活气息' && item.severity === 'warning',
    ),
  );
  assert.ok(
    findings.some(
      (item) => item.dimension === '冲突密度' && item.severity === 'warning',
    ),
  );
});

const continuityFixture = [
  {
    id: 'habit',
    kind: 'character' as const,
    title: '林岸的左手习惯',
    description: '林岸受伤后一直用左手写字。',
    currentState: '林岸是左撇子，习惯用左手写字。',
    changeRule: '右手康复训练完成',
    status: 'active' as const,
    importance: 'major' as const,
    introducedSequence: 1,
    lastTouchedSequence: 2,
    mentionCount: 2,
    keywords: ['林岸'],
    evolution: [],
  },
  {
    id: 'setup',
    kind: 'foreshadow' as const,
    title: '停走的怀表',
    description: '怀表停在姐姐失踪的时刻。',
    currentState: '怀表仍停在十一点四十分，来源未知。',
    changeRule: '找到修表记录后才可揭示来源',
    status: 'active' as const,
    importance: 'critical' as const,
    introducedSequence: 2,
    targetSequence: 6,
    lastTouchedSequence: 2,
    mentionCount: 1,
    keywords: ['怀表', '十一点四十分'],
    evolution: [],
  },
];

void test('adds project continuity facts and due setups to the writing prompt', () => {
  const lines = buildContinuityPrompt(continuityFixture, 6);
  assert.ok(lines.some((line) => line.includes('本章已进入兑现窗口')));
  assert.ok(lines.some((line) => line.includes('人物和环境允许变化')));
});

void test('audits overdue setups without treating a mention as automatic resolution', () => {
  const overdue = auditContinuity(
    '林岸推门进去，没有看桌面。',
    continuityFixture,
    6,
  );
  assert.ok(
    overdue.some(
      (item) => item.itemId === 'setup' && item.severity === 'warning',
    ),
  );
  const mentioned = auditContinuity(
    '林岸拿出那只停走的怀表，指针仍在十一点四十分。',
    continuityFixture,
    6,
  );
  assert.ok(
    mentioned.some(
      (item) =>
        item.itemId === 'setup' &&
        item.mentioned &&
        item.suggestion.includes('不自动等同于填坑'),
    ),
  );
  const resolved = auditContinuity(
    '林岸拿出怀表。原来它来自姐姐留下的修表铺，答案证实了旧案；因此他转身离开警局。',
    continuityFixture,
    6,
  );
  assert.ok(
    resolved.some(
      (item) => item.itemId === 'setup' && item.autoResolved === true,
    ),
  );
});

void test('keeps a distant critical setup on its importance cadence', () => {
  const findings = auditContinuity(
    '林岸只是沿着空走廊继续向前。',
    [
      {
        ...continuityFixture[1],
        targetSequence: 20,
        lastTouchedSequence: 2,
      },
    ],
    5,
  );
  assert.ok(
    findings.some(
      (item) =>
        item.itemId === 'setup' &&
        item.severity === 'warning' &&
        item.message.includes('连续 3 章未触达'),
    ),
  );
});

void test('flags an unexplained state contradiction and static character state', () => {
  const findings = auditContinuity(
    '林岸熟练地用右手写字，随后收起纸张。',
    continuityFixture,
    8,
  );
  assert.ok(findings.some((item) => item.dimension === '状态突变'));
  assert.ok(findings.some((item) => item.dimension === '动态成长'));
});

void test('turns a chapter audit into automatic continuity feedback', () => {
  const findings = auditContinuity(
    '林岸熟练地用右手写字，随后收起纸张。',
    continuityFixture,
    8,
  );
  const feedback = buildContinuityFeedback(
    '林岸关上门。\n\n走廊尽头又响起怀表的滴答声。',
    findings,
    8,
  );
  assert.equal(feedback.status, 'needs-attention');
  assert.ok(feedback.warningCount > 0);
  assert.match(feedback.summary, /怀表/);
});

void test('captures a strong chapter ending as a future payoff obligation', () => {
  const promise = captureChapterPromise(
    '林岸推开门。\n\n门后没有人，桌上的怀表却突然重新走动起来？',
    4,
  );
  assert.equal(promise?.kind, 'foreshadow');
  assert.equal(promise?.targetSequence, 6);
  assert.match(promise?.currentState ?? '', /怀表/);
});

void test('learns an abstract continuity method from distant recurrence', () => {
  const text = Array.from({ length: 8 }, (_, index) => {
    const marker =
      index === 0
        ? '林岸把裂纹怀表锁进抽屉，谁也没有告诉。'
        : index === 7
          ? '多年以后，裂纹怀表再次走动，迫使林岸改变证词。'
          : '林岸沿着港口继续调查，每一次选择都付出了新的代价。';
    return `第${index + 1}章 测试\n${marker}\n\n他转身推开门。`;
  }).join('\n\n');
  const result = analyzeBook(text, '长线伏笔与连续性');
  const insight = result.insights.find((item) => item.kind === 'continuity');
  assert.ok(insight);
  assert.match(insight.content.rule, /再次出现/);
  assert.equal(insight.evidenceIndexes.length, 2);
});
