'use client';

import {
  ArrowRight,
  BookOpen,
  Check,
  FlaskConical,
  Library,
  ListTree,
  LoaderCircle,
  PenLine,
  Plus,
  RefreshCw,
  Route,
  ShieldCheck,
  Sparkles,
  Upload,
  Workflow,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  compileWritingPrompt,
  createOutline,
  defaultWritingBrief,
  MAX_CHAPTER_LENGTH,
  MIN_CHAPTER_LENGTH,
  normalizeWritingBrief,
  type CharacterPrompt,
  type WritingBrief,
} from '@/lib/pipeline';
import {
  apiAnalyze,
  apiCompilePrompt,
  apiDemo,
  apiGetWorkspace,
  apiImportBook,
  apiRebuild,
  apiSaveBrief,
  apiSaveContinuity,
  apiSetMemory,
  apiWriteReview,
} from '@/lib/client-runtime';

type Row = Record<string, unknown>;
type Snapshot = {
  books: Row[];
  analyses: Row[];
  evidence: Row[];
  memories: Row[];
  projects: Row[];
  chapters: Row[];
  findings: Row[];
  continuityItems: Row[];
  continuityEvents: Row[];
};
type View = 'studio' | 'library' | 'review';

const emptySnapshot: Snapshot = {
  books: [],
  analyses: [],
  evidence: [],
  memories: [],
  projects: [],
  chapters: [],
  findings: [],
  continuityItems: [],
  continuityEvents: [],
};

const navItems: Array<{ view: View; label: string; icon: typeof Library }> = [
  { view: 'studio', label: '创作台', icon: Sparkles },
  { view: 'library', label: '参考书', icon: Library },
  { view: 'review', label: '成稿', icon: ShieldCheck },
];

const rightsLabels: Record<string, string> = {
  owned: '合法持有',
  licensed: '已获许可',
  'author-authorized': '作者公开授权',
  'public-domain': '公版作品',
  original: '原创内容',
};

function parseJson<T>(value: unknown, fallback: T): T {
  try {
    return typeof value === 'string' ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function formatNumber(value: unknown) {
  return new Intl.NumberFormat('zh-CN').format(Number(value ?? 0));
}

function formatDateTime(value: unknown) {
  const date = new Date(Number(value ?? 0));
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date);
}

export function Workbench() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [view, setView] = useState<View>('studio');
  const [file, setFile] = useState<File>();
  const [goal, setGoal] = useState('章尾钩子与逻辑衔接');
  const [rightsBasis, setRightsBasis] = useState('owned');
  const [bookTitle, setBookTitle] = useState('');
  const [bookAuthor, setBookAuthor] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [rightsNote, setRightsNote] = useState('');
  const [brief, setBrief] = useState<WritingBrief>(defaultWritingBrief);
  const [projectId, setProjectId] = useState('');
  const [compiledPrompt, setCompiledPrompt] = useState('');
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<{
    tone: 'ok' | 'error';
    text: string;
  }>();

  const refresh = useCallback(async () => {
    setSnapshot(await apiGetWorkspace());
  }, []);

  useEffect(() => {
    let active = true;
    apiGetWorkspace()
      .then((data) => {
        if (!active) return;
        setSnapshot(data);
        setProjectId(
          typeof data.projects[0]?.id === 'string' ? data.projects[0].id : '',
        );
        const savedBrief = parseJson<Record<string, unknown> | null>(
          data.projects[0]?.story_bible_json,
          null,
        );
        if (
          savedBrief &&
          typeof savedBrief.inspiration === 'string' &&
          typeof savedBrief.chapterGoal === 'string'
        ) {
          try {
            setBrief(normalizeWritingBrief(savedBrief));
          } catch {
            // Older projects used a different story-bible shape.
          }
        }
      })
      .catch((error) => {
        if (!active) return;
        console.error('[workbench-load]', error);
        setNotice({
          tone: 'error',
          text:
            (error instanceof Error && error.message) ||
            '工作区初始化失败，可尝试在网址后加 ?reset=1 重置本地数据。',
        });
      });
    return () => {
      active = false;
    };
  }, []);

  const runAction = async (name: string, action: () => Promise<void>) => {
    setBusy(name);
    setNotice(undefined);
    try {
      await action();
      await refresh();
      return true;
    } catch (error) {
      setNotice({
        tone: 'error',
        text: error instanceof Error ? error.message : '操作失败。',
      });
      return false;
    } finally {
      setBusy(undefined);
    }
  };

  const importAndAnalyze = () =>
    runAction('import', async () => {
      if (!file) throw new Error('请先选择书籍文件。');
      const imported = await apiImportBook(file, {
        title: bookTitle || file.name.replace(/\.[^.]+$/, ''),
        author: bookAuthor,
        sourceUrl,
        rightsBasis,
        rightsNote,
      });
      await apiAnalyze(String(imported.book?.id), goal);
      setNotice({ tone: 'ok', text: '书籍已导入，目标化拆解完成。' });
      setView('library');
    });

  const runDemo = () =>
    runAction('demo', async () => {
      await apiDemo();
      setNotice({
        tone: 'ok',
        text: '原创测试文本已跑完“读、学、写、审”闭环。',
      });
      setView('review');
    });

  const updateMemory = (id: string, status: 'confirmed' | 'rejected') =>
    runAction(`memory-${id}`, async () => {
      await apiSetMemory(id, status);
      setNotice({
        tone: 'ok',
        text:
          status === 'confirmed'
            ? '技法已进入正式写作记忆。'
            : '候选已驳回，不会影响后续写作。',
      });
    });

  const createContinuity = (input: Record<string, unknown>) =>
    runAction('mechanism-note', async () => {
      await apiSaveContinuity({ ...input, projectId });
      setNotice({
        tone: 'ok',
        text: '已写入故事逻辑机制，后续章节会自动读取。',
      });
    });

  const runWriteReview = () =>
    runAction('write', async () => {
      const normalized = normalizeWritingBrief(brief);
      const body = await apiWriteReview(normalized);
      if (body.projectId) setProjectId(body.projectId);
      setNotice({
        tone: 'ok',
        text: '已完成初稿、AI味专项审核、三层润色和成稿复审。',
      });
      setView('review');
    });

  const rebuildFirstFive = () =>
    runAction('rebuild', async () => {
      const body = await apiRebuild({
        projectId,
        brief: normalizeWritingBrief(brief),
      });
      setNotice({
        tone: 'ok',
        text: `已按大纲重建前 ${body.chapters?.length ?? 5} 章，每章均通过 3500–4500 字校验。`,
      });
      setView('review');
    });

  const compilePrompt = () =>
    runAction('compile', async () => {
      const normalized = normalizeWritingBrief(brief);
      const body = await apiCompilePrompt(normalized);
      setCompiledPrompt(body.prompt?.assembled ?? '');
      setNotice({ tone: 'ok', text: '提示词已整合，可检查后再开始写作。' });
    });

  const saveBrief = () =>
    runAction('save-brief', async () => {
      const normalized = normalizeWritingBrief(brief);
      const body = await apiSaveBrief(normalized);
      if (body.projectId) setProjectId(body.projectId);
      setNotice({ tone: 'ok', text: '简报已保存，可随时回来继续写。' });
    });

  const generateOutline = () => {
    setCompiledPrompt('');
    setBrief((current) => ({
      ...current,
      outline: createOutline(normalizeWritingBrief(current)),
    }));
    setNotice({ tone: 'ok', text: '已生成 20 章骨架，可继续修改后再写作。' });
  };

  const setBriefField = <K extends keyof WritingBrief>(
    key: K,
    value: WritingBrief[K],
  ) => {
    setCompiledPrompt('');
    setBrief((current) => ({ ...current, [key]: value }));
  };

  const updateCharacter = (
    index: number,
    key: keyof CharacterPrompt,
    value: string,
  ) => {
    setCompiledPrompt('');
    setBrief((current) => ({
      ...current,
      characters: current.characters.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [key]: value } : item,
      ),
    }));
  };

  const addCharacter = () => {
    setCompiledPrompt('');
    setBrief((current) => ({
      ...current,
      characters: [
        ...current.characters,
        {
          id: `character-${Date.now()}`,
          name: '',
          role: '',
          goal: '',
          conflict: '',
        },
      ],
    }));
  };

  const removeCharacter = (index: number) => {
    setCompiledPrompt('');
    setBrief((current) => ({
      ...current,
      characters:
        current.characters.length > 1
          ? current.characters.filter((_, itemIndex) => itemIndex !== index)
          : current.characters,
    }));
  };

  const counts = useMemo(
    () => ({
      confirmed: snapshot.memories.filter((item) => item.status === 'confirmed')
        .length,
    }),
    [snapshot.memories],
  );
  const selectProject = (nextProjectId: string) => {
    const project = snapshot.projects.find(
      (item) => String(item.id) === nextProjectId,
    );
    if (!project) return;
    const savedBrief = parseJson<Record<string, unknown> | null>(
      project.story_bible_json,
      null,
    );
    if (!savedBrief) return;
    try {
      setBrief(normalizeWritingBrief(savedBrief));
      setProjectId(nextProjectId);
      setCompiledPrompt('');
      setNotice(undefined);
    } catch {
      setNotice({ tone: 'error', text: '这部作品的旧简报无法读取。' });
    }
  };
  const createProject = () => {
    setProjectId('');
    setBrief({
      ...defaultWritingBrief,
      title: '未命名新作',
      outline: '',
      inspiration: '',
      worldSetting: '',
      characters: defaultWritingBrief.characters.map((item) => ({ ...item })),
      plotDirection: '',
      chapterTitle: '第一章',
      chapterGoal: '',
    });
    setCompiledPrompt('');
    setNotice({ tone: 'ok', text: '已打开空白作品，填写后保存即可建档。' });
  };
  const currentProject =
    snapshot.projects.find((item) => String(item.id) === projectId) ??
    snapshot.projects.find((item) => String(item.title) === brief.title);
  const currentProjectChapters = snapshot.chapters
    .filter(
      (item) =>
        currentProject && String(item.project_id) === String(currentProject.id),
    )
    .sort((a, b) => Number(b.sequence) - Number(a.sequence));

  const planNextChapter = () => {
    const lines = brief.outline
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) {
      setNotice({ tone: 'error', text: '请先生成或填写全书大纲。' });
      return;
    }
    const nextIndex = Math.min(currentProjectChapters.length, lines.length - 1);
    const line = lines[nextIndex];
    const [chapterLabel, ...goalParts] = line.split('｜');
    setCompiledPrompt('');
    setBrief((current) => ({
      ...current,
      chapterTitle:
        chapterLabel.replace(/^第\s*\d+\s*章\s*/u, '').trim() || chapterLabel,
      chapterGoal: goalParts.join('｜').trim() || line,
    }));
    setNotice({
      tone: 'ok',
      text: `已载入第 ${nextIndex + 1} 章任务。`,
    });
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="grid min-h-screen grid-cols-[188px_minmax(0,1fr)] max-md:block">
        <Sidebar view={view} onView={setView} />
        <section className="min-w-0">
          <div className="mx-auto w-full max-w-[1060px] px-7 py-7 max-sm:px-4">
            {notice && (
              <div
                className={`mb-5 flex items-start gap-2 border-l-2 px-3 py-2 text-xs ${notice.tone === 'ok' ? 'border-emerald-600 bg-emerald-50 text-emerald-900' : 'border-red-600 bg-red-50 text-red-900'}`}
              >
                {notice.tone === 'ok' ? (
                  <Check className="mt-0.5 size-3.5 shrink-0" />
                ) : (
                  <X className="mt-0.5 size-3.5 shrink-0" />
                )}
                {notice.text}
              </div>
            )}

            {view === 'library' && (
              <LibraryView
                snapshot={snapshot}
                file={file}
                goal={goal}
                rightsBasis={rightsBasis}
                bookTitle={bookTitle}
                bookAuthor={bookAuthor}
                sourceUrl={sourceUrl}
                rightsNote={rightsNote}
                busy={busy}
                onGoal={setGoal}
                onRightsBasis={setRightsBasis}
                onBookTitle={setBookTitle}
                onBookAuthor={setBookAuthor}
                onSourceUrl={setSourceUrl}
                onRightsNote={setRightsNote}
                onChoose={() => fileInput.current?.click()}
                onImport={importAndAnalyze}
                onDemo={runDemo}
                onUpdateMemory={updateMemory}
              />
            )}
            {view === 'studio' && (
              <PromptStudioView
                brief={brief}
                projects={snapshot.projects}
                projectId={projectId}
                compiledPrompt={compiledPrompt}
                confirmedCount={counts.confirmed}
                continuityCount={
                  snapshot.continuityItems.filter(
                    (item) =>
                      String(item.project_id) === String(currentProject?.id) &&
                      item.status === 'active',
                  ).length
                }
                busy={busy}
                onField={setBriefField}
                onCharacter={updateCharacter}
                onAddCharacter={addCharacter}
                onRemoveCharacter={removeCharacter}
                onCompile={compilePrompt}
                onSaveBrief={saveBrief}
                onGenerateOutline={generateOutline}
                onPlanNextChapter={planNextChapter}
                previousChapter={currentProjectChapters[0]}
                onWrite={runWriteReview}
                onProject={selectProject}
                onNewProject={createProject}
              />
            )}
            {view === 'review' && (
              <ReviewView
                snapshot={snapshot}
                projectId={projectId}
                projects={snapshot.projects}
                onProject={selectProject}
                onAddContinuityNote={createContinuity}
                onRunDemo={runDemo}
                onRebuild={rebuildFirstFive}
                busy={busy}
              />
            )}
            <input
              ref={fileInput}
              className="sr-only"
              type="file"
              accept=".txt,.md,.epub,.docx"
              onChange={(event) => setFile(event.target.files?.[0])}
            />
          </div>
        </section>
      </div>
    </main>
  );
}

function Sidebar({
  view,
  onView,
}: {
  view: View;
  onView: (view: View) => void;
}) {
  return (
    <aside className="flex min-h-screen flex-col border-r border-sidebar-border bg-sidebar px-3 py-4 max-md:min-h-0 max-md:border-b max-md:border-r-0">
      <div className="flex h-11 items-center gap-3 px-2">
        <div className="grid size-8 place-items-center rounded-[6px] bg-primary text-primary-foreground">
          <PenLine className="size-4" />
        </div>
        <div>
          <p className="text-[15px] font-semibold leading-none">文脉</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            个人写作工作台
          </p>
        </div>
      </div>
      <nav
        aria-label="主导航"
        className="mt-7 space-y-1 max-md:grid max-md:grid-cols-3 max-md:gap-1"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.view}
              onClick={() => onView(item.view)}
              type="button"
              aria-label={item.label}
              title={item.label}
              className={`flex h-9 w-full items-center gap-3 rounded-[6px] px-3 text-left text-sm transition-colors max-md:justify-center max-md:px-1 ${view === item.view ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground' : 'text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground'}`}
            >
              <Icon className="size-4 shrink-0" />
              <span className="max-md:hidden">{item.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="mt-auto border-t border-sidebar-border pt-4 max-md:hidden">
        <div className="flex items-center justify-between px-3 text-xs text-muted-foreground">
          <span>本地保存</span>
          <span className="size-2 rounded-full bg-emerald-600" />
        </div>
      </div>
    </aside>
  );
}

function PromptStudioView({
  brief,
  projects,
  projectId,
  compiledPrompt,
  confirmedCount,
  continuityCount,
  busy,
  onField,
  onCharacter,
  onAddCharacter,
  onRemoveCharacter,
  onCompile,
  onSaveBrief,
  onGenerateOutline,
  onPlanNextChapter,
  previousChapter,
  onWrite,
  onProject,
  onNewProject,
}: {
  brief: WritingBrief;
  projects: Row[];
  projectId: string;
  compiledPrompt: string;
  confirmedCount: number;
  continuityCount: number;
  busy?: string;
  onField: <K extends keyof WritingBrief>(
    key: K,
    value: WritingBrief[K],
  ) => void;
  onCharacter: (
    index: number,
    key: keyof CharacterPrompt,
    value: string,
  ) => void;
  onAddCharacter: () => void;
  onRemoveCharacter: (index: number) => void;
  onCompile: () => void;
  onSaveBrief: () => void;
  onGenerateOutline: () => void;
  onPlanNextChapter: () => void;
  previousChapter?: Row;
  onWrite: () => void;
  onProject: (projectId: string) => void;
  onNewProject: () => void;
}) {
  const localPrompt = useMemo(() => {
    try {
      return compileWritingPrompt({
        brief: normalizeWritingBrief(brief),
        techniques: [],
      }).assembled;
    } catch {
      return '';
    }
  }, [brief]);
  const preview = compiledPrompt || localPrompt;
  return (
    <>
      <div className="flex items-start justify-between gap-4 max-sm:block">
        <div>
          <p className="mb-2 text-xs font-semibold text-primary">创作台</p>
          <h1 className="text-2xl font-semibold">写下一章</h1>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 max-sm:mt-3 max-sm:justify-start">
          <NativeSelect
            aria-label="切换作品"
            className="w-44"
            value={projectId}
            onChange={(event) => onProject(event.target.value)}
          >
            <NativeSelectOption value="" disabled>
              选择作品
            </NativeSelectOption>
            {projects.map((project) => (
              <NativeSelectOption
                key={String(project.id)}
                value={String(project.id)}
              >
                {String(project.title)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Button
            size="icon-sm"
            variant="outline"
            aria-label="新建作品"
            title="新建作品"
            onClick={onNewProject}
          >
            <Plus />
          </Button>
          <Badge variant="outline" className="rounded-[5px]">
            大脑 {confirmedCount}
          </Badge>
          <Badge variant="outline" className="rounded-[5px]">
            机制跟踪 {continuityCount}
          </Badge>
        </div>
      </div>

      <div className="mt-7 grid grid-cols-[minmax(0,1fr)_360px] items-start gap-6 max-xl:grid-cols-1">
        <section className="space-y-5 rounded-[8px] border border-border bg-card p-5">
          <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
            <PromptField label="作品名" htmlFor="brief-title">
              <Input
                id="brief-title"
                value={brief.title}
                onChange={(event) => onField('title', event.target.value)}
              />
            </PromptField>
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <label
                  htmlFor="brief-chapter-title"
                  className="text-xs font-medium"
                >
                  当前章节名
                </label>
                <button
                  type="button"
                  onClick={onPlanNextChapter}
                  className="flex items-center gap-1 text-[11px] text-primary hover:underline"
                >
                  从大纲载入下一章
                  <ArrowRight className="size-3" />
                </button>
              </div>
              <Input
                id="brief-chapter-title"
                value={brief.chapterTitle}
                onChange={(event) =>
                  onField('chapterTitle', event.target.value)
                }
              />
            </div>
          </div>
          <PromptField label="核心灵感" htmlFor="brief-inspiration">
            <Textarea
              id="brief-inspiration"
              className="min-h-24 resize-y rounded-[6px]"
              value={brief.inspiration}
              onChange={(event) => onField('inspiration', event.target.value)}
              placeholder="一句话也可以：谁，在什么处境下，想做什么，但遇到了什么异常？"
            />
          </PromptField>
          <PromptField label="世界背景" htmlFor="brief-world">
            <Textarea
              id="brief-world"
              className="min-h-20 resize-y rounded-[6px]"
              value={brief.worldSetting}
              onChange={(event) => onField('worldSetting', event.target.value)}
              placeholder="时代、地点、规则、社会状态，以及这个世界和现实最不同的地方。"
            />
          </PromptField>

          <div className="border-t border-border pt-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">全书大纲</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  先定 20 章的功能和转折，再逐章写正文。
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onGenerateOutline}
              >
                <ListTree />
                生成骨架
              </Button>
            </div>
            <label htmlFor="brief-outline" className="sr-only">
              全书大纲内容
            </label>
            <Textarea
              id="brief-outline"
              className="mt-3 min-h-44 resize-y rounded-[6px] font-mono text-xs leading-6"
              value={brief.outline}
              onChange={(event) => onField('outline', event.target.value)}
              placeholder="点击“生成骨架”，或直接粘贴自己的章节规划。"
            />
          </div>

          <div className="border-t border-border pt-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">角色提示词</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  角色目标和内外冲突比外貌描述更影响剧情。
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onAddCharacter}
                disabled={brief.characters.length >= 8}
              >
                <Sparkles />
                添加角色
              </Button>
            </div>
            <div className="mt-4 space-y-4">
              {brief.characters.map((character, index) => (
                <div
                  key={character.id ?? index}
                  className="border-l-2 border-primary/50 pl-4"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold">角色 {index + 1}</p>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`删除角色 ${index + 1}`}
                      disabled={brief.characters.length === 1}
                      onClick={() => onRemoveCharacter(index)}
                    >
                      <X />
                    </Button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-3 max-sm:grid-cols-1">
                    <Input
                      aria-label={`角色 ${index + 1} 姓名`}
                      placeholder="姓名"
                      value={character.name}
                      onChange={(event) =>
                        onCharacter(index, 'name', event.target.value)
                      }
                    />
                    <Input
                      aria-label={`角色 ${index + 1} 身份`}
                      placeholder="身份 / 与主角关系"
                      value={character.role}
                      onChange={(event) =>
                        onCharacter(index, 'role', event.target.value)
                      }
                    />
                    <Input
                      aria-label={`角色 ${index + 1} 目标`}
                      placeholder="当前想要什么"
                      value={character.goal}
                      onChange={(event) =>
                        onCharacter(index, 'goal', event.target.value)
                      }
                    />
                    <Input
                      aria-label={`角色 ${index + 1} 冲突`}
                      placeholder="阻力、秘密或代价"
                      value={character.conflict}
                      onChange={(event) =>
                        onCharacter(index, 'conflict', event.target.value)
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <PromptField label="长线情节方向" htmlFor="brief-plot">
            <Textarea
              id="brief-plot"
              className="min-h-20 resize-y rounded-[6px]"
              value={brief.plotDirection}
              onChange={(event) => onField('plotDirection', event.target.value)}
              placeholder="故事接下来大致往哪里走，哪些方向不能提前写死。"
            />
          </PromptField>
          <PromptField label="当前章节任务" htmlFor="brief-chapter-goal">
            <Textarea
              id="brief-chapter-goal"
              className="min-h-20 resize-y rounded-[6px]"
              value={brief.chapterGoal}
              onChange={(event) => onField('chapterGoal', event.target.value)}
              placeholder="这一章必须发生什么变化？人物做出什么选择？结尾留下什么？"
            />
          </PromptField>
          <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
            <PromptField label="叙事视角" htmlFor="brief-pov">
              <Input
                id="brief-pov"
                value={brief.pointOfView}
                onChange={(event) => onField('pointOfView', event.target.value)}
              />
            </PromptField>
            <PromptField label="语言与节奏" htmlFor="brief-tone">
              <Input
                id="brief-tone"
                value={brief.tone}
                onChange={(event) => onField('tone', event.target.value)}
              />
            </PromptField>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_150px] gap-4 max-sm:grid-cols-1">
            <PromptField label="硬约束（每行一条）" htmlFor="brief-constraints">
              <Textarea
                id="brief-constraints"
                className="min-h-20 resize-y rounded-[6px]"
                value={brief.constraints.join('\n')}
                onChange={(event) =>
                  onField(
                    'constraints',
                    event.target.value.split(/\r?\n/).filter(Boolean),
                  )
                }
              />
            </PromptField>
            <PromptField label="目标字数（硬限 3500–4500）" htmlFor="brief-length">
              <Input
                id="brief-length"
                type="number"
                min={MIN_CHAPTER_LENGTH}
                max={MAX_CHAPTER_LENGTH}
                step={100}
                value={brief.targetLength}
                onChange={(event) =>
                  onField('targetLength', Number(event.target.value))
                }
              />
            </PromptField>
          </div>
          <label className="flex items-center justify-between gap-4 border-y border-border py-3 text-sm">
            <span>
              使用写作大脑
              <span className="ml-2 text-xs text-muted-foreground">
                调用技法、避坑规则和素材
              </span>
            </span>
            <input
              type="checkbox"
              className="size-4 accent-emerald-700"
              checked={brief.useMemories}
              onChange={(event) => onField('useMemories', event.target.checked)}
            />
          </label>
        </section>

        <aside className="sticky top-5 max-xl:static">
          {previousChapter && (
            <details className="mb-5 border-t-2 border-border pt-4">
              <summary className="cursor-pointer text-xs font-medium">
                上一章结尾 · {String(previousChapter.title)}
              </summary>
              <p className="mt-3 max-h-28 overflow-auto whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                {String(previousChapter.content).slice(-360)}
              </p>
            </details>
          )}
          <div className="border-t-2 border-primary pt-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">完整提示词</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  整合后会包含已确认技法及其禁用条件。
                </p>
              </div>
              <Badge variant="secondary" className="rounded-[5px]">
                {formatNumber(preview.length)} 字符
              </Badge>
            </div>
            <pre className="mt-4 max-h-[560px] overflow-auto whitespace-pre-wrap border-y border-border bg-panel p-4 font-sans text-xs leading-6">
              {preview || '填写核心灵感、角色和章节任务后，先整合提示词。'}
            </pre>
            <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
              <Workflow className="size-3.5 text-primary" />
              连续性账本 → 初稿 → 专项审核 → 润色复审 → 双向反哺
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button
                variant="ghost"
                disabled={busy === 'save-brief'}
                onClick={onSaveBrief}
              >
                {busy === 'save-brief' ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Check />
                )}
                保存简报
              </Button>
              <Button
                variant="outline"
                disabled={busy === 'compile'}
                onClick={onCompile}
              >
                {busy === 'compile' ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <ListTree />
                )}
                整合提示词
              </Button>
              <Button disabled={busy === 'write'} onClick={onWrite}>
                {busy === 'write' ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <PenLine />
                )}
                成文并润色
              </Button>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

function PromptField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-2 block text-xs font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}

const continuityKindLabels: Record<string, string> = {
  storyline: '故事线',
  foreshadow: '伏笔/包袱',
  character: '人物习惯',
  relationship: '人物关系',
  environment: '环境状态',
  detail: '关键细节',
};

function LibraryView({
  snapshot,
  file,
  goal,
  rightsBasis,
  bookTitle,
  bookAuthor,
  sourceUrl,
  rightsNote,
  busy,
  onGoal,
  onRightsBasis,
  onBookTitle,
  onBookAuthor,
  onSourceUrl,
  onRightsNote,
  onChoose,
  onImport,
  onDemo,
  onUpdateMemory,
}: {
  snapshot: Snapshot;
  file?: File;
  goal: string;
  rightsBasis: string;
  bookTitle: string;
  bookAuthor: string;
  sourceUrl: string;
  rightsNote: string;
  busy?: string;
  onGoal: (value: string) => void;
  onRightsBasis: (value: string) => void;
  onBookTitle: (value: string) => void;
  onBookAuthor: (value: string) => void;
  onSourceUrl: (value: string) => void;
  onRightsNote: (value: string) => void;
  onChoose: () => void;
  onImport: () => void;
  onDemo: () => void;
  onUpdateMemory: (id: string, status: 'confirmed' | 'rejected') => void;
}) {
  const candidates = snapshot.memories.filter(
    (item) => item.status === 'candidate',
  );
  const confirmed = snapshot.memories.filter(
    (item) => item.status === 'confirmed',
  );
  const memoryLabels: Record<string, string> = {
    technique: '技法',
    structure: '骨架',
    character: '人物',
    core: '内核',
    material: '素材',
    continuity: '连续性',
    weakness: '避坑',
  };
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">参考书</h1>
      </div>
      <div className="mt-5 grid grid-cols-[minmax(0,1fr)_280px] gap-6 max-lg:grid-cols-1">
        <section className="rounded-[8px] border border-border bg-card">
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-sm font-semibold">导入并拆解</h2>
          </div>
          <div className="space-y-5 px-5 py-5">
            <div>
              <span className="mb-2 block text-xs font-medium">
                书籍文件（TXT、MD、EPUB、DOCX）
              </span>
              <button
                type="button"
                onClick={onChoose}
                className="flex min-h-24 w-full items-center justify-center gap-3 rounded-[6px] border border-dashed border-input bg-muted/30 px-4 text-sm hover:bg-muted/60"
              >
                <Upload className="size-4 text-primary" />
                {file ? file.name : '选择书籍文件'}
              </button>
              {file && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {(file.size / 1024 / 1024).toFixed(2)} MB · 支持自动识别
                  UTF-8、GB18030 和 UTF-16
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
              <div>
                <label
                  htmlFor="book-title"
                  className="mb-2 block text-xs font-medium"
                >
                  书名
                </label>
                <Input
                  id="book-title"
                  value={bookTitle}
                  onChange={(event) => onBookTitle(event.target.value)}
                  placeholder={
                    file?.name.replace(/\.[^.]+$/, '') || '自动取文件名'
                  }
                />
              </div>
              <div>
                <label
                  htmlFor="book-author"
                  className="mb-2 block text-xs font-medium"
                >
                  作者
                </label>
                <Input
                  id="book-author"
                  value={bookAuthor}
                  onChange={(event) => onBookAuthor(event.target.value)}
                  placeholder="建议填写"
                />
              </div>
            </div>
            <div>
              <label
                htmlFor="analysis-goal"
                className="mb-2 block text-xs font-medium"
              >
                本次拆解目标
              </label>
              <Input
                id="analysis-goal"
                value={goal}
                onChange={(event) => onGoal(event.target.value)}
                className="rounded-[6px]"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                {[
                  '生活气息与人物塑造',
                  '冲突升级与代价',
                  '章尾钩子与逻辑衔接',
                  '长线伏笔与连续性',
                  '对白、节奏与情绪余味',
                ].map((item) => (
                  <button
                    type="button"
                    key={item}
                    onClick={() => onGoal(item)}
                    className={`rounded-[5px] border px-2 py-1 text-[10px] ${goal === item ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label
                htmlFor="rights-basis"
                className="mb-2 block text-xs font-medium"
              >
                使用依据
              </label>
              <NativeSelect
                id="rights-basis"
                className="w-full"
                value={rightsBasis}
                onChange={(event) => onRightsBasis(event.target.value)}
              >
                <NativeSelectOption value="owned">
                  我持有合法副本
                </NativeSelectOption>
                <NativeSelectOption value="licensed">
                  已获得许可
                </NativeSelectOption>
                <NativeSelectOption value="author-authorized">
                  作者公开授权
                </NativeSelectOption>
                <NativeSelectOption value="public-domain">
                  公版作品
                </NativeSelectOption>
                <NativeSelectOption value="original">
                  原创内容
                </NativeSelectOption>
              </NativeSelect>
            </div>
            <div>
              <label
                htmlFor="source-url"
                className="mb-2 block text-xs font-medium"
              >
                来源地址
              </label>
              <Input
                id="source-url"
                type="url"
                value={sourceUrl}
                onChange={(event) => onSourceUrl(event.target.value)}
                placeholder="可选，公版或授权来源建议保留"
              />
            </div>
            <div>
              <label
                htmlFor="rights-note"
                className="mb-2 block text-xs font-medium"
              >
                版权或授权说明
              </label>
              <Textarea
                id="rights-note"
                className="min-h-16 resize-y"
                value={rightsNote}
                onChange={(event) => onRightsNote(event.target.value)}
                placeholder="例如：作者逝世超过 50 年，文本已进入公版；或记录购买、授权情况。"
              />
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-border bg-muted/35 px-5 py-4">
            <Button
              variant="outline"
              className="rounded-[6px]"
              disabled={busy === 'demo'}
              onClick={onDemo}
            >
              {busy === 'demo' ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <FlaskConical />
              )}
              测试流程
            </Button>
            <Button
              className="rounded-[6px]"
              disabled={!file || !goal.trim() || busy === 'import'}
              onClick={onImport}
            >
              {busy === 'import' ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Sparkles />
              )}
              导入并拆解
            </Button>
          </div>
        </section>
        <aside className="border-t-2 border-primary pt-4">
          <h2 className="text-sm font-semibold">已入库书籍</h2>
          <div className="mt-3 divide-y divide-border">
            {snapshot.books.map((book) => (
              <div className="py-3" key={String(book.id)}>
                <p className="text-xs font-medium">{String(book.title)}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {formatNumber(book.character_count)} 字符 ·{' '}
                  {formatNumber(book.chapter_count)} 个单元
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {rightsLabels[String(book.rights_basis)] ??
                    String(book.rights_basis)}
                </p>
              </div>
            ))}
            {!snapshot.books.length && (
              <p className="text-xs leading-5 text-muted-foreground">
                暂无书籍。原创演示不会使用任何受版权文本。
              </p>
            )}
          </div>
        </aside>
      </div>

      <section className="mt-8 border-t border-border pt-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">写作大脑</h2>
          <span className="text-xs text-muted-foreground">
            已启用 {confirmed.length} 条
          </span>
        </div>
        {candidates.length ? (
          <div className="mt-3 divide-y divide-border border-y border-border">
            {candidates.map((item) => {
              const content = parseJson<Record<string, string>>(
                item.content_json,
                {},
              );
              const loading = busy === `memory-${String(item.id)}`;
              return (
                <div
                  key={String(item.id)}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-4 max-sm:grid-cols-1"
                >
                  <div>
                    <p className="text-sm font-medium">{String(item.title)}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      <span className="mr-2 font-medium text-foreground">
                        {memoryLabels[String(item.kind)] || String(item.kind)}
                      </span>
                      {content.formula || content.rule || content.suggestedFix}
                    </p>
                  </div>
                  <div className="flex gap-2 max-sm:justify-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={loading}
                      onClick={() =>
                        onUpdateMemory(String(item.id), 'rejected')
                      }
                    >
                      <X />
                      不用
                    </Button>
                    <Button
                      size="sm"
                      disabled={loading}
                      onClick={() =>
                        onUpdateMemory(String(item.id), 'confirmed')
                      }
                    >
                      {loading ? (
                        <LoaderCircle className="animate-spin" />
                      ) : (
                        <Check />
                      )}
                      启用
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            没有待处理技法。新书拆解后会出现在这里。
          </p>
        )}
        {confirmed.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {confirmed.map((item) => (
              <Badge key={String(item.id)} variant="secondary">
                {memoryLabels[String(item.kind)] || String(item.kind)} ·{' '}
                {String(item.title)}
              </Badge>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function ContinuityMechanismPanel({
  snapshot,
  projectId,
  chapter,
  mechanism,
  busy,
  onAddNote,
}: {
  snapshot: Snapshot;
  projectId: string;
  chapter: Row;
  mechanism?: {
    name?: string;
    audit?: Array<{
      itemId?: string;
      severity?: string;
      message?: string;
      suggestion?: string;
    }>;
    feedback?: {
      status?: string;
      summary?: string;
      warningCount?: number;
      touchedItemIds?: string[];
    };
  };
  busy?: string;
  onAddNote: (input: Record<string, unknown>) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<'idea' | 'correction'>('idea');
  const [note, setNote] = useState('');
  const items = snapshot.continuityItems.filter(
    (item) => String(item.project_id) === projectId,
  );
  const active = items.filter((item) => item.status === 'active');
  const plotItems = items.filter((item) =>
    ['storyline', 'foreshadow'].includes(String(item.kind)),
  );
  const resolvedCount = plotItems.filter(
    (item) => item.status === 'resolved',
  ).length;
  const warnings =
    mechanism?.audit?.filter((item) => item.severity === 'warning') ?? [];
  const automaticEvents = snapshot.continuityEvents.filter(
    (event) =>
      String(event.chapter_id) === String(chapter.id) &&
      ['auto-feedback', 'auto-captured'].includes(String(event.action)),
  );

  const submit = async () => {
    const saved = await onAddNote({
      mode,
      note,
      sequence: Number(chapter.sequence),
    });
    if (saved) setNote('');
  };

  return (
    <section className="border-t-2 border-primary pt-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Route className="size-4" />
          故事逻辑机制
        </h2>
        <Badge variant="outline">
          {warnings.length ? `${warnings.length} 项需判断` : '本章通过'}
        </Badge>
      </div>
      <div className="mt-3 grid grid-cols-3 border-y border-border text-center">
        <div className="py-3">
          <p className="text-base font-semibold">{active.length}</p>
          <p className="text-[10px] text-muted-foreground">持续跟踪</p>
        </div>
        <div className="border-x border-border py-3">
          <p className="text-base font-semibold">
            {mechanism?.feedback?.touchedItemIds?.length ?? 0}
          </p>
          <p className="text-[10px] text-muted-foreground">本章触达</p>
        </div>
        <div className="py-3">
          <p className="text-base font-semibold">
            {resolvedCount}/{plotItems.length}
          </p>
          <p className="text-[10px] text-muted-foreground">长线已完成</p>
        </div>
      </div>
      <div className="mt-3 text-xs leading-5">
        {warnings.length ? (
          <div className="space-y-3">
            {warnings.map((finding, index) => (
              <div
                key={`${finding.itemId}-${index}`}
                className="border-l-2 border-amber-600 pl-3"
              >
                <p className="font-medium text-amber-900">{finding.message}</p>
                {finding.suggestion && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {finding.suggestion}
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground">
            本章没有发现人物、环境、关系或伏笔的明确断层。
          </p>
        )}
        {mechanism?.feedback?.summary && (
          <details className="mt-3 border-t border-border pt-3">
            <summary className="cursor-pointer text-[11px] font-medium text-primary">
              下一章自动接续摘要
            </summary>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {mechanism.feedback.summary}
            </p>
          </details>
        )}
        <details className="mt-3 border-t border-border pt-3">
          <summary className="cursor-pointer text-[11px] font-medium text-primary">
            机制正在跟踪什么
          </summary>
          <div className="mt-2 space-y-2">
            {active.slice(0, 8).map((item) => (
              <div key={String(item.id)} className="text-[11px]">
                <p className="font-medium">
                  {continuityKindLabels[String(item.kind)] || '故事事实'} ·{' '}
                  {String(item.title)}
                </p>
                <p className="text-muted-foreground">
                  {String(item.current_state)}
                </p>
              </div>
            ))}
            {!active.length && (
              <p className="text-[11px] text-muted-foreground">
                下一次成文时会根据作品设定自动建立基线。
              </p>
            )}
          </div>
        </details>
        <details className="mt-3 border-t border-border pt-3">
          <summary className="cursor-pointer text-[11px] font-medium text-primary">
            补充我的想法或修正
          </summary>
          <div className="mt-3">
            <div className="flex rounded-[6px] bg-muted p-0.5">
              {(
                [
                  ['idea', '补充想法'],
                  ['correction', '修正事实'],
                ] as const
              ).map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  className={`h-7 flex-1 px-2 text-[11px] ${mode === value ? 'rounded-[5px] bg-background font-medium shadow-sm' : 'text-muted-foreground'}`}
                  onClick={() => setMode(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <Textarea
              aria-label="补充故事想法或修正"
              className="mt-2 min-h-20 resize-y"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={
                mode === 'correction'
                  ? '例如：许照从第 12 章起不再怕水，原因是……'
                  : '例如：这枚铜币可以在第 18 章改变两人的关系……'
              }
            />
            <Button
              size="sm"
              className="mt-2 w-full"
              disabled={!note.trim() || busy === 'mechanism-note'}
              onClick={submit}
            >
              {busy === 'mechanism-note' ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Sparkles />
              )}
              写入机制
            </Button>
          </div>
        </details>
        {automaticEvents.length > 0 && (
          <p className="mt-3 text-[10px] text-muted-foreground">
            本章已自动完成 {automaticEvents.length} 次记录与反哺。
          </p>
        )}
      </div>
    </section>
  );
}

function ReviewView({
  snapshot,
  projectId,
  projects,
  onProject,
  onAddContinuityNote,
  onRunDemo,
  onRebuild,
  busy,
}: {
  snapshot: Snapshot;
  projectId: string;
  projects: Row[];
  onProject: (projectId: string) => void;
  onAddContinuityNote: (input: Record<string, unknown>) => Promise<boolean>;
  onRunDemo: () => void;
  onRebuild: () => void;
  busy?: string;
}) {
  const [selectedChapterId, setSelectedChapterId] = useState('');
  const [draftMode, setDraftMode] = useState<'polished' | 'draft'>('polished');
  const projectChapters = snapshot.chapters
    .filter((item) => !projectId || String(item.project_id) === projectId)
    .sort((a, b) => Number(b.sequence) - Number(a.sequence));
  const chapter =
    projectChapters.find((item) => String(item.id) === selectedChapterId) ??
    projectChapters[0];
  const chapterFindings = chapter
    ? snapshot.findings.filter(
        (item) => String(item.chapter_id) === String(chapter.id),
      )
    : [];
  const promptSnapshot = chapter
    ? parseJson<{
        compiledPrompt?: { assembled?: string };
        mechanism?: {
          name?: string;
          stages?: string[];
          draft?: string;
          polished?: string;
          appliedChanges?: string[];
          memoryTitles?: string[];
          findingsBefore?: Array<{ severity?: string }>;
          findingsAfter?: Array<{ severity?: string }>;
        };
        continuityMechanism?: {
          name?: string;
          audit?: Array<{
            itemId?: string;
            severity?: string;
            message?: string;
            suggestion?: string;
          }>;
          feedback?: {
            status?: string;
            summary?: string;
            warningCount?: number;
            touchedItemIds?: string[];
          };
          rules?: string[];
        };
      }>(chapter.prompt_snapshot_json, {})
    : {};
  const usedPrompt = promptSnapshot.compiledPrompt?.assembled ?? '';
  const mechanism = promptSnapshot.mechanism;
  const continuityMechanism = promptSnapshot.continuityMechanism;
  const displayedContent =
    draftMode === 'draft' && mechanism?.draft
      ? mechanism.draft
      : mechanism?.polished ||
        (typeof chapter?.content === 'string' ? chapter.content : '');
  const warningCount = (items?: Array<{ severity?: string }>) =>
    items?.filter((item) => item.severity === 'warning').length ?? 0;
  return (
    <>
      <div className="flex items-start justify-between gap-4 max-sm:block">
        <div>
          <p className="mb-2 text-xs font-semibold text-primary">成稿</p>
          <h1 className="text-2xl font-semibold">成稿与审阅</h1>
        </div>
        {projects.length > 0 ? (
          <div className="flex items-center gap-2 max-sm:mt-3 max-sm:w-full">
            <NativeSelect
              aria-label="切换审阅作品"
              className="w-52 max-sm:w-full"
              value={projectId}
              onChange={(event) => onProject(event.target.value)}
            >
              {projects.map((project) => (
                <NativeSelectOption
                  key={String(project.id)}
                  value={String(project.id)}
                >
                  {String(project.title)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Button
              variant="outline"
              size="sm"
              disabled={busy === 'rebuild' || !projectId}
              onClick={onRebuild}
              title="按大纲重建前五章"
            >
              {busy === 'rebuild' ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <RefreshCw />
              )}
              重建前五章
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            className="rounded-[6px]"
            onClick={onRunDemo}
            disabled={busy === 'demo'}
          >
            <FlaskConical />
            运行原创演示
          </Button>
        )}
      </div>
      {chapter ? (
        <div className="mt-7">
          {projectChapters.length > 1 && (
            <div className="mb-4 flex items-center justify-end gap-3">
              <label
                htmlFor="review-version"
                className="text-xs font-medium text-muted-foreground"
              >
                审阅版本
              </label>
              <NativeSelect
                id="review-version"
                className="w-full max-w-64"
                value={String(chapter.id)}
                onChange={(event) => setSelectedChapterId(event.target.value)}
              >
                {projectChapters.map((item) => (
                  <NativeSelectOption
                    key={String(item.id)}
                    value={String(item.id)}
                  >
                    {String(item.title)} · {formatDateTime(item.updated_at)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          )}
          <div className="grid grid-cols-[190px_minmax(0,1fr)_300px] items-start gap-5 max-xl:grid-cols-[170px_minmax(0,1fr)] max-lg:grid-cols-1">
            <aside className="sticky top-5 max-lg:static">
              <div className="flex items-center gap-2 border-b border-border pb-3 text-xs font-semibold">
                <BookOpen className="size-3.5" />
                往期章节 · {projectChapters.length}
              </div>
              <div className="max-h-[72vh] divide-y divide-border overflow-auto max-lg:flex max-lg:max-h-none max-lg:gap-2 max-lg:divide-y-0 max-lg:overflow-x-auto">
                {projectChapters.map((item) => (
                  <button
                    key={String(item.id)}
                    type="button"
                    onClick={() => {
                      setSelectedChapterId(String(item.id));
                      setDraftMode('polished');
                    }}
                    className={`w-full px-2 py-3 text-left max-lg:min-w-40 max-lg:border max-lg:border-border ${String(item.id) === String(chapter.id) ? 'border-l-2 border-l-primary bg-primary/5' : 'hover:bg-muted/50'}`}
                  >
                    <p className="text-[10px] text-muted-foreground">
                      第 {formatNumber(item.sequence)} 章
                    </p>
                    <p className="mt-1 truncate text-xs font-medium">
                      {String(item.title)}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {formatNumber(String(item.content).length)} 字符
                    </p>
                  </button>
                ))}
              </div>
            </aside>
            <article className="rounded-[8px] border border-border bg-card">
              <div className="border-b border-border px-5 py-4">
                <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <p>第 {formatNumber(chapter.sequence)} 章</p>
                  <p>{formatNumber(displayedContent.length)} 字符</p>
                </div>
                <div className="mt-1 flex items-center justify-between gap-3 max-sm:block">
                  <h2 className="text-base font-semibold">
                    {String(chapter.title)}
                  </h2>
                  {mechanism?.draft && (
                    <div className="flex rounded-[6px] bg-muted p-0.5 max-sm:mt-3">
                      <button
                        type="button"
                        className={`h-7 px-3 text-xs ${draftMode === 'polished' ? 'rounded-[5px] bg-background font-medium shadow-sm' : 'text-muted-foreground'}`}
                        onClick={() => setDraftMode('polished')}
                      >
                        润色稿
                      </button>
                      <button
                        type="button"
                        className={`h-7 px-3 text-xs ${draftMode === 'draft' ? 'rounded-[5px] bg-background font-medium shadow-sm' : 'text-muted-foreground'}`}
                        onClick={() => setDraftMode('draft')}
                      >
                        初稿
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div className="whitespace-pre-wrap px-6 py-6 text-[15px] leading-8">
                {displayedContent}
              </div>
              {mechanism && (
                <details className="border-t border-border px-6 py-4" open>
                  <summary className="cursor-pointer text-xs font-medium text-primary">
                    <span className="inline-flex items-center gap-2">
                      <Workflow className="size-3.5" />
                      {mechanism.name || '成文机制'}
                    </span>
                  </summary>
                  <div className="mt-4 space-y-3 text-xs">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">
                        初审警告 {warningCount(mechanism.findingsBefore)}
                      </Badge>
                      <Badge variant="outline">
                        复审警告 {warningCount(mechanism.findingsAfter)}
                      </Badge>
                      <Badge variant="outline">
                        润色动作 {mechanism.appliedChanges?.length ?? 0}
                      </Badge>
                    </div>
                    {!!mechanism.appliedChanges?.length && (
                      <p className="leading-5 text-muted-foreground">
                        {mechanism.appliedChanges.join(' · ')}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      {mechanism.stages?.map((stage, index) => (
                        <span key={`${stage}-${index}`}>
                          {index + 1}. {stage}
                        </span>
                      ))}
                    </div>
                  </div>
                </details>
              )}
              <details className="border-t border-border px-6 py-4">
                <summary className="cursor-pointer text-xs font-medium text-primary">
                  查看本次使用的完整提示词
                </summary>
                <pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap bg-panel p-4 font-sans text-xs leading-6 text-muted-foreground">
                  {usedPrompt || '这条旧记录没有保存提示词快照。'}
                </pre>
              </details>
            </article>
            <aside className="space-y-4 max-xl:col-start-2 max-lg:col-start-auto">
              <ContinuityMechanismPanel
                snapshot={snapshot}
                projectId={projectId}
                chapter={chapter}
                mechanism={continuityMechanism}
                busy={busy}
                onAddNote={onAddContinuityNote}
              />
              <h2 className="text-sm font-semibold">
                本次审阅 · {chapterFindings.length}
              </h2>
              {chapterFindings.map((item) => (
                <div
                  key={String(item.id)}
                  className="border-t border-border pt-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="outline" className="rounded-[5px]">
                      {String(item.dimension)}
                    </Badge>
                    <span
                      className={`text-[10px] font-medium ${item.severity === 'warning' ? 'text-amber-700' : 'text-emerald-700'}`}
                    >
                      {item.severity === 'warning' ? '需关注' : '通过'}
                    </span>
                  </div>
                  <p className="mt-2 text-xs font-medium leading-5">
                    {String(item.message)}
                  </p>
                  <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                    {String(item.suggestion)}
                  </p>
                </div>
              ))}
            </aside>
          </div>
        </div>
      ) : (
        <div className="mt-7 border-y border-border py-10 text-center">
          <ShieldCheck className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">还没有审阅记录</p>
          <p className="mt-1 text-xs text-muted-foreground">
            确认至少一条技法后运行写作验证，或直接跑原创演示。
          </p>
        </div>
      )}
    </>
  );
}
