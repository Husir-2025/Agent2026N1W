// 头号写手 v2 增强模块（确定性规则，浏览器端可运行）
// ---------------------------------------------------------------
// 借鉴自公开写作 Agent 项目的设计理念，取长补短、非照抄：
//   - oh-story-claudecode：去AI味分层检查 + 禁用词表
//   - novel-ai-agent：节奏曲线 / 文风指纹 / 上下文压缩 / 灵感库
//   - tianming-novel-ai-writer：15维事实快照 / 12类变更声明
//   - AI-Novel-Writing-Assistant：卷战略→卷骨架→节奏板→拆章
//   - chinese-novelist-skill：13种钩子 / 偏好记忆 / 指南库
// 本模块全部为纯函数与常量，不依赖 LLM API，可离线确定性运行。

// ---------------------------------------------------------------- 去AI味

// 阻断级：命中即提示删除或改写（确定性词表）
export const AI_BLOCKED_PATTERNS: Array<{ pattern: RegExp; replace: string }> = [
  { pattern: /重新确认了自己的目标/gu, replace: '又看了一遍摊开的东西' },
  { pattern: /仿佛置身于/gu, replace: '站在这' },
  { pattern: /无一不/gu, replace: '都' },
  { pattern: /淋漓尽致/gu, replace: '很透' },
  { pattern: /挥之不去/gu, replace: '散不掉' },
  { pattern: /如影随形/gu, replace: '一直跟着' },
  { pattern: /不言而喻/gu, replace: '不用说' },
  { pattern: /显而易见/gu, replace: '明摆着' },
  { pattern: /综上所述/gu, replace: '' },
  { pattern: /总的来说/gu, replace: '' },
  { pattern: /让我们/gu, replace: '让' },
  { pattern: /不禁让人/gu, replace: '让人' },
  { pattern: /散发出/g, replace: '带着' },
  { pattern: /闪烁着/gu, replace: '亮着' },
  { pattern: /缓缓地/gu, replace: '缓缓' },
  { pattern: /默默地/gu, replace: '没出声' },
  { pattern: /轻轻地/gu, replace: '轻' },
  { pattern: /渐渐地/gu, replace: '慢慢' },
  { pattern: /然而，/gu, replace: '可' },
  { pattern: /但是，/gu, replace: '但' },
];

// 提醒级：疑似 AI 句式，仅提示不自动替换
export const AI_SUSPICIOUS_PATTERNS: RegExp[] = [
  /仿佛|似乎|好像(?=一切|时间)/gu,
  /心底|内心(?=深处)/gu,
  /这一刻/gu,
  /时间仿佛凝固/gu,
  /空气中弥漫着/gu,
  /眼神中流露出/gu,
  /嘴角勾起一抹/gu,
  /命运的齿轮/gu,
  /一切尽在掌握/gu,
  /画上了一个(圆满的)?句号/gu,
  /宛如一幅(美丽|动人的)?画卷/gu,
];

// 分层检查结果
export type AiTasteAudit = {
  blockedHits: Array<{ pattern: string; offset: number; sample: string }>;
  suspiciousHits: Array<{ pattern: string; offset: number; sample: string }>;
  blockedCount: number;
  suspiciousCount: number;
};

export function auditAiTaste(text: string): AiTasteAudit {
  const blockedHits: AiTasteAudit['blockedHits'] = [];
  const suspiciousHits: AiTasteAudit['suspiciousHits'] = [];
  for (const { pattern, replace } of AI_BLOCKED_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? 0;
      blockedHits.push({
        pattern: `${match[0]} → ${replace}`,
        offset: index,
        sample: text.slice(Math.max(0, index - 8), index + match[0].length + 8),
      });
    }
  }
  for (const pattern of AI_SUSPICIOUS_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? 0;
      suspiciousHits.push({
        pattern: match[0],
        offset: index,
        sample: text.slice(Math.max(0, index - 8), index + match[0].length + 8),
      });
    }
  }
  return {
    blockedHits,
    suspiciousHits,
    blockedCount: blockedHits.length,
    suspiciousCount: suspiciousHits.length,
  };
}

// 三遍去AI：第一遍替换阻断词，第二遍拆长句，第三遍查漏
export function deAiPolish(text: string): { output: string; changes: string[] } {
  const changes: string[] = [];
  let output = text;
  for (const { pattern, replace } of AI_BLOCKED_PATTERNS) {
    const hits = output.match(pattern);
    if (hits && hits.length > 0) {
      output = output.replace(pattern, replace);
      changes.push(`去AI味：${hits[0]} → ${replace}`);
    }
  }
  // 第二遍：把超过 80 字的句子按逗号拆短
  const longSentences = output.match(/[^。！？\n]{81,}[。！？]/gu) ?? [];
  if (longSentences.length > 0) {
    output = output.replace(/[^。！？\n]{81,}[。！？]/gu, (sentence) => {
      const trimmed = sentence.replace(/[。！？]$/u, '');
      const parts = trimmed.split(/(?<=，|；)/u).filter(Boolean);
      if (parts.length < 2) return sentence;
      const joined = parts.join('\n');
      return `${joined}${sentence.slice(-1)}`;
    });
    changes.push(`去AI味：拆解 ${longSentences.length} 个超长句`);
  }
  const leftover = auditAiTaste(output);
  if (leftover.blockedCount === 0 && leftover.suspiciousCount === 0) {
    changes.push('去AI味：第三遍查漏通过');
  } else {
    changes.push(`去AI味：第三遍查漏剩余阻断 ${leftover.blockedCount}、疑似 ${leftover.suspiciousCount}`);
  }
  return { output, changes };
}

// ---------------------------------------------------------------- 节奏曲线

export type PacingProfile = {
  emotionScore: number; // -1..1 正面情绪占比
  infoDensity: number; // 0..1 新词（罕见词）密度
  dialogueRatio: number; // 0..1 对话字符占比
  shortSentenceRatio: number; // 0..1 短句（≤12字）占比
  paragraphCount: number;
  tensionHints: string[];
};

const POSITIVE_WORDS =
  /希望|温暖|光明|笑着|安心|得救|重逢|圆满|胜利|平静|默契|信任|喜欢|归来/gu;
const NEGATIVE_WORDS =
  /恐惧|绝望|冰冷|颤抖|尖叫|破碎|背叛|死亡|沉默|昏暗|刺痛|颤抖|孤立|崩溃/gu;

export function analyzePacing(text: string): PacingProfile {
  const paragraphs = text.split(/\n+/u).filter((p) => p.trim().length > 0);
  const sentences = text.match(/[^。！？\n]+[。！？]?/gu) ?? [];
  const chars = text.replace(/\s/gu, '');
  const positiveHits = text.match(POSITIVE_WORDS)?.length ?? 0;
  const negativeHits = text.match(NEGATIVE_WORDS)?.length ?? 0;
  const emotionScore =
    positiveHits + negativeHits === 0
      ? 0
      : (positiveHits - negativeHits) / (positiveHits + negativeHits);
  const dialogueChars = (text.match(/[“「『][^”」』]*[”」』]/gu) ?? []).join('')
    .length;
  const shortSentences = sentences.filter((s) => s.trim().length <= 12).length;
  // 信息密度：出现次数少的名词化片段占比（用字频近似）
  const freq = new Map<string, number>();
  for (const ch of chars) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let rareChars = 0;
  for (const ch of chars) if ((freq.get(ch) ?? 0) <= 1) rareChars += 1;
  const infoDensity = chars.length === 0 ? 0 : Math.min(1, rareChars / chars.length);
  const tensionHints: string[] = [];
  if (shortSentences / Math.max(1, sentences.length) > 0.35) {
    tensionHints.push('短句密集，节奏偏紧');
  }
  if (dialogueChars / Math.max(1, chars.length) > 0.5) {
    tensionHints.push('对话占比高，注意推进信息');
  }
  if (emotionScore < -0.3) tensionHints.push('负面情绪浓度高，可留一丝转机');
  if (infoDensity > 0.3) tensionHints.push('新信息密度高，防止读者信息过载');
  return {
    emotionScore: Number(emotionScore.toFixed(2)),
    infoDensity: Number(infoDensity.toFixed(2)),
    dialogueRatio: Number((dialogueChars / Math.max(1, chars.length)).toFixed(2)),
    shortSentenceRatio: Number(
      (shortSentences / Math.max(1, sentences.length)).toFixed(2),
    ),
    paragraphCount: paragraphs.length,
    tensionHints,
  };
}

// ---------------------------------------------------------------- 文风指纹

export type StyleFingerprint = {
  avgSentenceLength: number;
  shortSentenceRatio: number;
  exclamationRatio: number; // 感叹号/问号占比
  dialogueRatio: number;
  topWords: string[]; // 高频实词
  descriptorRatio: number; // 叠词/程度副词密度
};

const ADVERB_WORDS =
  /很|非常|特别|十分|极其|格外|相当|略微|稍稍|忽然|突然|终于|竟然|居然/gu;

export function styleFingerprint(text: string): StyleFingerprint {
  const sentences = text.match(/[^。！？\n]+[。！？]?/gu) ?? [];
  const lengths = sentences.map((s) => s.trim().length);
  const avg =
    lengths.length === 0
      ? 0
      : lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const shortRatio =
    lengths.length === 0 ? 0 : lengths.filter((l) => l <= 12).length / lengths.length;
  const punctuation = (text.match(/[！？]/gu) ?? []).length;
  const puncRatio = punctuation / Math.max(1, text.length);
  const dialogueChars = (text.match(/[“「『][^”」』]*[”」』]/gu) ?? []).join('')
    .length;
  const dialogueRatio = dialogueChars / Math.max(1, text.replace(/\s/gu, '').length);
  const adverbHits = text.match(ADVERB_WORDS)?.length ?? 0;
  const descriptorRatio = adverbHits / Math.max(1, text.replace(/\s/gu, '').length);
  const freq = new Map<string, number>();
  for (const word of text.match(/[\u4e00-\u9fa5]{2,4}/gu) ?? []) {
    if (['我们', '他们', '自己', '一个', '没有', '这个', '那个', '什么', '已经', '还是', '可是'].includes(word)) continue;
    freq.set(word, (freq.get(word) ?? 0) + 1);
  }
  const topWords = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word]) => word);
  return {
    avgSentenceLength: Number(avg.toFixed(1)),
    shortSentenceRatio: Number(shortRatio.toFixed(2)),
    exclamationRatio: Number(puncRatio.toFixed(4)),
    dialogueRatio: Number(dialogueRatio.toFixed(2)),
    topWords,
    descriptorRatio: Number(descriptorRatio.toFixed(4)),
  };
}

export function styleDriftScore(a: StyleFingerprint, b: StyleFingerprint): number {
  // 0=完全一致 1=完全不同（按归一化差值加权）
  const diff =
    Math.abs(a.avgSentenceLength - b.avgSentenceLength) / Math.max(1, (a.avgSentenceLength + b.avgSentenceLength) / 2) * 0.3 +
    Math.abs(a.shortSentenceRatio - b.shortSentenceRatio) * 0.25 +
    Math.abs(a.dialogueRatio - b.dialogueRatio) * 0.2 +
    Math.abs(a.descriptorRatio - b.descriptorRatio) / Math.max(0.001, (a.descriptorRatio + b.descriptorRatio) / 2) * 0.25;
  return Number(Math.min(1, diff).toFixed(2));
}

// ---------------------------------------------------------------- 12类变更声明

export type ChapterChange = {
  kind:
    | '角色状态' | '位置' | '外貌' | '冲突进度' | '伏笔设置' | '伏笔回收'
    | '剧情节点' | '关系变化' | '秘密揭示' | '誓约' | '截止约束' | '物品';
  entity: string;
  from: string;
  to: string;
  sequence: number;
};

// 从章节正文确定性提取结构化变更（关键词触发 + 上一章状态比对）
export function extractChapterChanges(
  text: string,
  previousItems: Array<{ title: string; currentState: string }>,
  sequence: number,
): ChapterChange[] {
  const changes: ChapterChange[] = [];
  const seen = new Set<string>();
  const add = (kind: ChapterChange['kind'], entity: string, to: string) => {
    const key = `${kind}|${entity}`;
    if (seen.has(key)) return;
    seen.add(key);
    changes.push({ kind, entity, from: '', to, sequence });
  };
  for (const match of text.matchAll(/[“「『]([^”」』]{2,12})[”」』](?=[^。！？]{0,12}(发现|想起|承认|说|告诉|确认))/gu)) {
    add('秘密揭示', match[1], `本章揭示“${match[1]}”相关信息`);
  }
  for (const match of text.matchAll(/(?:怀表|信|钥匙|照片|日记|戒指|伞|钱包|纸条|药|枪)/gu)) {
    add('物品', match[0], `本章出现“${match[0]}”`);
  }
  for (const match of text.matchAll(/(?:回到|离开|前往|抵达|走进|走出|赶到|逃出|搬进|撤出)([^\s，。！？]{2,6})/gu)) {
    add('位置', match[1], `到达/离开“${match[1]}”`);
  }
  for (const match of text.matchAll(/(?:三天后|两天后|次日|当天夜里|深夜|清晨|黄昏|午夜|黎明)/gu)) {
    add('剧情节点', match[0], `时间推进到“${match[0]}”`);
  }
  for (const match of text.matchAll(/(?:发誓|承诺|约定|立誓|答应)/gu)) {
    add('誓约', '承诺', `本章出现“${match[0]}”事件`);
  }
  for (const match of text.matchAll(/(?:最后期限|只剩|倒计时|必须在|截止)/gu)) {
    add('截止约束', '时限', `本章设置/推进“${match[0]}”约束`);
  }
  for (const match of text.matchAll(/(?:伤口|血迹|淤青|结痂|痊愈|拆线|缝针)/gu)) {
    add('角色状态', '身体状态', `本章出现“${match[0]}”`);
  }
  // 与既有连续性条目比对：出现关键词则视为“触达+演进”
  for (const item of previousItems) {
    for (const keyword of item.title.match(/[\u4e00-\u9fa5]{2,4}/gu) ?? []) {
      if (keyword.length >= 2 && text.includes(keyword)) {
        add('剧情节点', item.title, `本章触达“${item.title}”（已计入连续性演进）`);
        break;
      }
    }
  }
  return changes;
}

// ---------------------------------------------------------------- 15维事实维度

export const FACT_DIMENSIONS = [
  '角色状态', '位置', '外貌', '冲突进度', '伏笔', '剧情节点', '地点',
  '势力', '时间线', '物品', '世界观约束', '秘密', '誓约', '截止约束', '其他',
] as const;

export type FactDimension = (typeof FACT_DIMENSIONS)[number];

// 由旧 kind 映射到 15 维分类（无人工干预的确定性映射）
export function mapKindToDimension(kind: string): FactDimension {
  switch (kind) {
    case 'character': return '角色状态';
    case 'foreshadow': return '伏笔';
    case 'storyline': return '剧情节点';
    case 'relationship': return '角色状态';
    case 'environment': return '地点';
    case 'detail': return '物品';
    default: return '其他';
  }
}

// ---------------------------------------------------------------- 卷规划

export type VolumePlan = {
  volumes: Array<{
    volumeNo: number;
    title: string;
    strategy: string;
    chapterCount: number;
    startSequence: number;
    endSequence: number;
    pacing: string;
    climaxChapter: number; // 卷内高潮章
  }>;
};

const VOLUME_STRATEGIES = [
  { title: '启幕', strategy: '建立日常与异常，抛出核心悬念', pacing: '起：平缓铺陈，钩子收尾' },
  { title: '推进', strategy: '冲突升级，人物关系生变', pacing: '承：渐紧，中段设转折' },
  { title: '转折', strategy: '秘密揭示，代价显形', pacing: '转：高频波动，信息密集' },
  { title: '收束', strategy: '主线收敛，伏笔回收，留余韵', pacing: '合：紧后回落，结尾留白' },
];

// 20章默认拆 4 卷 × 5 章；其余按每卷 4-6 章自适应
export function planVolumes(totalChapters: number): VolumePlan {
  const volumeCount = Math.max(1, Math.min(6, Math.round(totalChapters / 5)));
  const volumes: VolumePlan['volumes'] = [];
  let start = 1;
  for (let i = 0; i < volumeCount; i += 1) {
    const remaining = totalChapters - start + 1;
    const ideal = Math.ceil(remaining / (volumeCount - i));
    const count = Math.min(ideal, Math.max(4, Math.min(6, ideal)));
    const end = Math.min(totalChapters, start + count - 1);
    const strategy = VOLUME_STRATEGIES[i % VOLUME_STRATEGIES.length];
    volumes.push({
      volumeNo: i + 1,
      title: `第${i + 1}卷·${strategy.title}`,
      strategy: strategy.strategy,
      chapterCount: end - start + 1,
      startSequence: start,
      endSequence: end,
      pacing: strategy.pacing,
      climaxChapter: Math.max(start, end - 1),
    });
    start = end + 1;
  }
  return { volumes };
}

// ---------------------------------------------------------------- 13种结尾钩子

export const HOOK_TYPES: Array<{ name: string; pattern: string; example: string }> = [
  { name: '悬念提问', pattern: '以未解答的问题收尾', example: '那扇门后面，到底是谁在敲？' },
  { name: '反转亮相', pattern: '结尾出现身份/立场反转', example: '递来纸条的，正是要找的人。' },
  { name: '危险逼近', pattern: '威胁迫近，主角尚未察觉', example: '脚步声停在了门外。' },
  { name: '秘密泄露', pattern: '关键信息被第三方听到', example: '隔墙传来他的名字。' },
  { name: '承诺立约', pattern: '主角许下必须兑现的承诺', example: '“明天之前，我一定找到她。”' },
  { name: '时间压力', pattern: '截止时刻突然提前', example: '广播说：只剩今晚了。' },
  { name: '旧敌现身', pattern: '以为结束的对手回归', example: '那辆熄火的车，又亮起了灯。' },
  { name: '线索串联', pattern: '两件小事突然指向同一真相', example: '两张纸条上的字迹，一模一样。' },
  { name: '情感裂痕', pattern: '关系出现不可逆的裂缝', example: '她收回手，没有说话。' },
  { name: '环境异变', pattern: '设定规则被打破', example: '停电第七天，灯亮了。' },
  { name: '物品异常', pattern: '熟悉物品出现陌生变化', example: '怀表指向了十二点零五分。' },
  { name: '对话失语', pattern: '关键人物欲言又止', example: '“你妹妹她……”他没说下去。' },
  { name: '日常入侵', pattern: '平静场景被不速之客打破', example: '柜台前站着穿制服的人。' },
];

// ---------------------------------------------------------------- 指南库

export type WritingGuide = {
  id: string;
  title: string;
  summary: string;
  content: string[];
};

export const WRITING_GUIDES: WritingGuide[] = [
  {
    id: 'chapter-guide',
    title: '章节指南',
    summary: '单章的结构骨架：开场情境→发展→转折→收束钩子',
    content: [
      '开场：用一个具体动作或物件切入，不写天气式铺垫。',
      '中段：让角色主动行动，每次行动都带来新的代价或信息。',
      '转折：在 60%-80% 处让计划落空或秘密露出。',
      '收束：落到钩子（见 13 种结尾钩子），不留总结性段落。',
    ],
  },
  {
    id: 'suspense-guide',
    title: '悬念技巧（13种钩子）',
    summary: '结尾钩子与章内悬念的建立方式',
    content: HOOK_TYPES.map((h) => `${h.name}：${h.pattern}（例：${h.example}）`),
  },
  {
    id: 'character-guide',
    title: '人物塑造',
    summary: '让人物通过行动而非形容词立住',
    content: [
      '每个角色给一个动作习惯与一个忌讳（触碰即反应）。',
      '对话要有信息差：知道的不说、不知道的乱猜。',
      '目标与冲突要能具体到“这一章他要做什么、谁挡着”。',
    ],
  },
  {
    id: 'dialogue-guide',
    title: '对话写作',
    summary: '对话的节奏、潜台词与动作穿插',
    content: [
      '用动作代替“他说”：把表情和手势织进台词之间。',
      '每段对话至少有半句是偏离主题的（生活感）。',
      '关键信息不直说，用打断、沉默、答非所问呈现。',
    ],
  },
  {
    id: 'plot-guide',
    title: '情节结构',
    summary: '因果链与转折点的设计',
    content: [
      '每个情节节点回答：主角为此付出了什么？',
      '转折不靠巧合，靠“之前埋下的细节被触发”。',
      '章节之间用因果连接：上章结尾的钩子就是本章开场的动因。',
    ],
  },
  {
    id: 'expand-guide',
    title: '内容扩充',
    summary: '欠字时如何自然扩充而不注水',
    content: [
      '扩充感官细节：温度、气味、触感、环境声。',
      '扩充人物反应：先身体反应，再内心判断，再行动。',
      '扩充过程：把“去做了”拆成“准备→试探→受阻→调整”。',
      '不扩充：重复的心理独白、大段背景说明。',
    ],
  },
  {
    id: 'outline-guide',
    title: '大纲模板（7列）',
    summary: '章节大纲的结构化字段',
    content: [
      '章节号 | 章节标题 | 核心事件 | 人物与动机 | 冲突/代价 | 结尾钩子类型 | 目标字数',
    ],
  },
  {
    id: 'chapter-template',
    title: '章节模板',
    summary: '可直接套用的章节写作模板',
    content: [
      '第一段：承接上章钩子，给出新的处境（1 个动作）。',
      '第二段：主角行动受阻，暴露一条新信息。',
      '第三段：与对手/伙伴互动，关系出现变化。',
      '第四段：代价显形（失去/受伤/失信）。',
      '末段：以 13 种钩子之一收尾。',
    ],
  },
];

// ---------------------------------------------------------------- 偏好记忆

export type UserPreferences = {
  targetLength?: number;
  useMemories?: boolean;
  tone?: string;
  pointOfView?: string;
  templateRatio?: number;
  preferredGenres?: string[];
};

export function mergePreferences(
  base: UserPreferences,
  saved: UserPreferences,
): UserPreferences {
  return { ...base, ...saved };
}

// ---------------------------------------------------------------- 上下文压缩

export type ChapterSummary = {
  sequence: number;
  title: string;
  summary: string; // ≤200字
  keyFacts: string[]; // 关键事实短句
};

// 把章节正文压缩为摘要（确定性提取：首段事件 + 高频实体 + 末段钩子）
export function summarizeChapter(
  text: string,
  title: string,
  sequence: number,
  maxSummary = 180,
): ChapterSummary {
  const paragraphs = text.split(/\n+/u).filter((p) => p.trim().length > 0);
  const head = paragraphs[0]?.trim().slice(0, 60) ?? '';
  const tail = paragraphs.at(-1)?.trim().slice(0, 60) ?? '';
  const freq = new Map<string, number>();
  for (const name of text.match(/[\u4e00-\u9fa5]{2,4}/gu) ?? []) {
    if (['我们', '他们', '自己', '一个', '没有', '这个', '那个', '什么', '已经', '还是', '可是', '因为', '所以', '但是'].includes(name)) continue;
    freq.set(name, (freq.get(name) ?? 0) + 1);
  }
  const keyFacts = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([entity]) => `${entity}在本章多次出现`);
  let summary = `本章从“${head}”展开，至“${tail}”收束。`;
  if (summary.length > maxSummary) summary = `${summary.slice(0, maxSummary)}…`;
  return { sequence, title, summary, keyFacts };
}

// 组装最近 N 章压缩上下文（替代“只取上一章全文”）
export function compileRecentContext(
  summaries: ChapterSummary[],
  lastChapterFull?: { title: string; content: string },
  maxContext = 900,
): string {
  const lines: string[] = [];
  const recent = summaries.slice(-3);
  for (const item of recent) {
    lines.push(`【第${item.sequence}章《${item.title}】${item.summary}`);
    if (item.keyFacts.length > 0) {
      lines.push(`  关键事实：${item.keyFacts.join('；')}`);
    }
  }
  if (lastChapterFull && lastChapterFull.content.length > 240) {
    lines.push(`【上章《${lastChapterFull.title}》末尾衔接】${lastChapterFull.content.slice(-240)}`);
  }
  const joined = lines.join('\n');
  return joined.length > maxContext ? `${joined.slice(0, maxContext)}…` : joined;
}
