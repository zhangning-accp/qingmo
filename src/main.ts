import { CrepeBuilder } from '@milkdown/crepe/builder';
import { table } from '@milkdown/crepe/feature/table';
import { toolbar } from '@milkdown/crepe/feature/toolbar';
import { listItem } from '@milkdown/crepe/feature/list-item';
import { cursor } from '@milkdown/crepe/feature/cursor';
import { editorViewCtx } from '@milkdown/kit/core';
import { uploadConfig } from '@milkdown/kit/plugin/upload';
import { replaceAll, insert } from '@milkdown/kit/utils';
import { addRowAfter, addColumnAfter, deleteRow, deleteColumn, deleteTable, isInTable } from '@milkdown/kit/prose/tables';
import { closeHistory } from '@milkdown/kit/prose/history';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import type { EditorState } from '@milkdown/kit/prose/state';
import '@milkdown/crepe/theme/common/prosemirror.css';
import '@milkdown/crepe/theme/common/reset.css';
import '@milkdown/crepe/theme/common/cursor.css';
import '@milkdown/crepe/theme/common/list-item.css';
import '@milkdown/crepe/theme/common/toolbar.css';
import '@milkdown/crepe/theme/common/table.css';
import '@milkdown/crepe/theme/frame.css';
import './style.css';

const welcome = `# 写下，思绪就清晰了。

欢迎使用 **轻墨**。这里就是你的纸面：直接输入，直接看到排版。

## 写作，不必切换预览

在行首输入 \`# \` 创建标题，输入 \`- \` 开始列表。选中文字，可以设置加粗、斜体或链接。

## 表格，像表格一样编辑

点击下面的单元格直接修改内容，用顶部按钮增删行列。按 **Tab** 移到下一格。

| 今天要做的事 | 状态 | 备注 |
| --- | --- | --- |
| 整理本周计划 | 进行中 | 从最重要的事开始 |
| 记录一个好想法 | 待开始 | 留一点空白给灵感 |

> Ctrl + S 保存 · Ctrl + O 打开 · Ctrl + / 切换源码

这是一份示例。点击左上角「新建」，开始你自己的文档。
`;

// CommonMark treats the closing ** after 】 as literal punctuation when text follows
// immediately. An entity gives the editor and Word converter a zero-width boundary.
function chineseLabelBoundary(markdown: string, restore = false): string {
  let fence: { marker: string; length: number } | null = null;
  return markdown.replace(/^[^\r\n]*/gm, line => {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = { marker: marker[0], length: marker.length };
      else if (marker[0] === fence.marker && marker.length >= fence.length) fence = null;
      return line;
    }
    if (fence || /^ {4}/.test(line)) return line;
    const prefix = /^([ \t]{0,3}(?:(?:[-*+]|\d+\.)[ \t]+)?)(\*\*【[^】*\r\n]+】\*\*)/u;
    const match = prefix.exec(line);
    if (!match) return line;
    const end = match[0].length;
    if (restore) {
      const boundary = line.slice(end).match(/^(?:\u200B|&#8203;)/u)?.[0];
      return boundary ? line.slice(0, end) + line.slice(end + boundary.length) : line;
    }
    return /^[\p{L}\p{N}]/u.test(line.slice(end))
      ? line.slice(0, end) + '&#8203;' + line.slice(end)
      : line;
  });
}

const frontmatterPattern = /^(?:\uFEFF)?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?=\r?\n|$)/;
function editorMarkdown(markdown: string): string {
  const frontmatter = frontmatterPattern.exec(markdown)?.[0];
  if (!frontmatter) return chineseLabelBoundary(markdown);
  let fence = '```';
  while (frontmatter.split(/\r?\n/).some(line => line.startsWith(fence))) fence += '`';
  return chineseLabelBoundary(`${fence}yaml\n${frontmatter}\n${fence}${markdown.slice(frontmatter.length)}`);
}
function restoreFrontmatter(markdown: string, original: string): string {
  if (!frontmatterPattern.test(original)) return markdown;
  const code = /^(`{3,}|~{3,})yaml[^\r\n]*\r?\n([\s\S]*?)\r?\n\1(?=\r?\n|$)/i.exec(markdown);
  if (!code || frontmatterPattern.exec(code[2])?.[0].length !== code[2].length) return markdown;
  return code[2] + markdown.slice(code[0].length);
}

document.querySelector('#app')!.innerHTML = `
  <header><div class="brand"><span class="brand-mark">墨</span><b>轻墨</b><span class="version">0.4.4</span></div>
  <nav><button id="new" title="Ctrl+N">新建</button><button id="open" title="Ctrl+O">打开</button><button id="save" class="primary" title="Ctrl+S">保存</button><button id="save-as">另存为</button><button id="export-word">导出 Word</button></nav>
  <div class="filename" id="filename">未命名.md</div><button id="mode" title="Ctrl+/">〈/〉 源码</button><button id="focus" title="隐藏侧栏">专注</button></header>
  <div id="tabs" role="tablist" aria-label="打开的文档"></div>
  <div id="drop-hint" hidden>松开鼠标，打开文件<br><small>支持一次拖入多个 Markdown / TXT 文件</small></div>
  <div class="layout"><aside><div class="aside-label">文档大纲 <span>OUTLINE</span></div><div id="outline"></div><div class="aside-bottom"><span class="dot"></span> 本地写作<br><small>拖入文件即可打开</small></div></aside>
  <main><div class="paper-top"><span>一页空白，无限可能</span><span>MARKDOWN / 轻墨</span></div>
  <div class="table-tools"><button id="insert-table">＋ 插入表格</button><span class="divider"></span><button data-table="row">＋ 行</button><button data-table="column">＋ 列</button><button data-table="deleteRow">删行</button><button data-table="deleteColumn">删列</button><button data-table="deleteTable">删除表格</button><span class="table-hint">点击单元格后可增删行列</span></div>
  <div id="notice" role="status" hidden><span id="notice-text"></span><button id="reload-external" hidden>重新载入</button><button id="notice-close" aria-label="关闭提示">×</button></div><div id="editor"></div><div id="source-shell" hidden><div id="line-gutter" aria-hidden="true"></div><textarea id="source" aria-label="Markdown 源码" spellcheck="false" wrap="off"></textarea></div>
  </main></div><footer><span id="status">正在准备纸面…</span><span id="count"></span><span id="selected-count" hidden></span><span id="lines"></span><span id="startup"></span><span>UTF-8 · Markdown</span></footer>
  <dialog id="unsaved"><h2>保存这次修改？</h2><p>文档有尚未保存的内容。</p><div><button value="cancel">继续编辑</button><button value="discard">放弃修改</button><button value="save" class="primary">保存</button></div></dialog>
  <dialog id="external-confirm"><h2>重新载入外部文件？</h2><p>这会放弃当前标签尚未保存的修改，改用磁盘上的文件内容。</p><div><button value="cancel">保留当前修改</button><button value="reload" class="primary">放弃修改并重新载入</button></div></dialog>`;

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const native = isTauri();
let content = welcome, saved = welcome, path: string | null = null, sourceMode = false, switching = false, busy = false;
let draftTimer: ReturnType<typeof setTimeout>;
let draftError = false;
let closing = false;
type Tab = { id: string; title: string; path: string | null; content: string; saved: string; sourceMode: boolean; fastOpen: boolean; state?: EditorState; scroll: number; sourceSelection: [number, number]; externalChanged?: boolean; externalError?: string };
let untitled = 0;
function countLines(text: string): number {
  let lines = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++;
  return lines;
}
const countCharacters = (text: string): number => text.replace(/\s/g, '').length;
function fastOpen(text: string): boolean {
  if (text.length >= 80_000) return true;
  let breaks = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10 && ++breaks >= 1_500) return true;
  return false;
}
function makeTab(text = '', filePath: string | null = null, id: string = crypto.randomUUID(), title?: string): Tab {
  const large = fastOpen(text);
  return { id, title: title || filePath?.split(/[\\/]/).pop() || `未命名 ${++untitled}.md`, path: filePath, content: text, saved: text, sourceMode: large, fastOpen: large, scroll: 0, sourceSelection: [0, 0] };
}
const tabs: Tab[] = [];
try {
  const drafts = JSON.parse(localStorage.getItem('qingmo.drafts.v2') || 'null');
  if (Array.isArray(drafts)) for (const draft of drafts) {
    if (typeof draft?.content === 'string') { const tab = makeTab(draft.content, null, undefined, typeof draft.title === 'string' ? `${draft.title}（恢复）` : undefined); tab.saved = '\0' + draft.content; tabs.push(tab); }
  }
  if (!tabs.length) {
    const draft = JSON.parse(localStorage.getItem('qingmo.draft') || 'null');
    if (typeof draft?.content === 'string') { const tab = makeTab(draft.content); tab.saved = '\0' + draft.content; tabs.push(tab); }
  }
} catch { /* An unreadable draft must not prevent opening the app. */ }
const restored = tabs.length > 0;
if (!tabs.length) tabs.push(makeTab(welcome, null, undefined, '使用入门.md'));
let activeId = tabs[0].id;
const activeTab = () => tabs.find(tab => tab.id === activeId)!;
content = activeTab().content; saved = activeTab().saved; sourceMode = activeTab().sourceMode;
let sourceLineCount = countLines(content);
const crepe = new CrepeBuilder({ root: '#editor', defaultValue: sourceMode ? '' : editorMarkdown(content) })
  .addFeature(table).addFeature(toolbar, { boldLabel: '加粗', italicLabel: '斜体', codeLabel: '行内代码', linkLabel: '链接', strikethroughLabel: '删除线' }).addFeature(listItem).addFeature(cursor);
crepe.editor.config(ctx => ctx.update(uploadConfig.key, config => ({ ...config, uploader: async () => {
  notice('此预览版尚未支持图片粘贴，请暂用源码编辑图片链接。'); return [];
}})));
let lastDoc: object | undefined;
let editorReady = false;
let editorTabId: string | null = sourceMode ? null : activeId;
function syncContent() {
  if (switching || sourceMode) return;
  const doc = crepe.editor.action(ctx => ctx.get(editorViewCtx).state.doc);
  if (doc !== lastDoc) {
    lastDoc = doc;
    content = restoreFrontmatter(chineseLabelBoundary(crepe.getMarkdown(), true), content);
    sourceLineCount = countLines(content);
  }
}
const dirty = () => content !== saved;
function notice(message: string, canReload = false) { $('#notice-text').textContent = message; $('#reload-external').hidden = !canReload; $('#notice').hidden = !message; }
$('#notice-close').onclick = () => notice('');
function showExternalNotice(tab: Tab) {
  if (tab.externalError) notice(`“${tab.title}”的磁盘文件暂时无法读取：${tab.externalError}。当前内容已保留。`);
  else notice(`“${tab.title}”已被外部修改。轻墨中还有未保存的内容；请先另存为，或点击“重新载入”放弃本地修改。`, true);
}
function persistDraft() {
  if (closing) return;
  syncContent();
  checkpoint();
  clearTimeout(draftTimer);
  try {
    const drafts = tabs.filter(tab => tab.content !== tab.saved).map(tab => ({ title: tab.title, content: tab.content }));
    if (drafts.length) localStorage.setItem('qingmo.drafts.v2', JSON.stringify(drafts));
    else localStorage.removeItem('qingmo.drafts.v2');
    localStorage.removeItem('qingmo.draft');
    draftError = false;
  } catch { draftError = true; notice('草稿缓存失败，请及时按 Ctrl+S 保存到文件。'); }
  refresh();
}
function updateSelectedCount() {
  if (!editorReady) return;
  let selected = '';
  let hasSelection = false;
  if (sourceMode) {
    const source = $<HTMLTextAreaElement>('#source');
    hasSelection = source.selectionStart !== source.selectionEnd;
    if (hasSelection) selected = source.value.slice(source.selectionStart, source.selectionEnd);
  } else {
    const { doc, selection } = crepe.editor.action(ctx => ctx.get(editorViewCtx).state);
    hasSelection = !selection.empty;
    if (hasSelection) selected = doc.textBetween(selection.from, selection.to, '\n');
  }
  const display = $('#selected-count');
  display.hidden = !hasSelection;
  if (hasSelection) display.textContent = `已选 ${countCharacters(selected).toLocaleString()} 字符`;
}
function refresh() {
  checkpoint(); renderTabs();
  const name = activeTab().title;
  $('#filename').textContent = `${dirty() ? '● ' : ''}${name}`;
  $('#filename').title = path || name;
  $('#count').textContent = `${countCharacters(content).toLocaleString()} 字符`;
  updateSelectedCount();
  $('#lines').textContent = `${sourceLineCount.toLocaleString()} 行`;
  $('#status').textContent = dirty() ? (draftError ? '有未保存的修改' : '有修改 · 本地草稿保护') : '已保存';
  if (!path && !dirty()) $('#status').textContent = content === welcome ? '示例文档 · 随时开始' : '空白文档';
  if (activeTab().externalChanged) $('#status').textContent = activeTab().externalError ? '外部文件不可读取 · 当前内容已保留' : '外部文件已修改 · 当前内容已保留';
  if (native) void getCurrentWindow().setTitle(`${dirty() ? '● ' : ''}${name} — 轻墨`);
}
function updateOutline() {
  const box = $('#outline'); box.replaceChildren();
  const headings = document.querySelectorAll<HTMLElement>('#editor .ProseMirror h1, #editor .ProseMirror h2, #editor .ProseMirror h3');
  headings.forEach((heading) => {
    const item = document.createElement('button'); item.textContent = heading.textContent;
    item.style.paddingLeft = `${12 + (Number(heading.tagName[1]) - 1) * 12}px`;
    item.onclick = () => heading.scrollIntoView({ behavior: 'smooth', block: 'start' }); box.append(item);
  });
  if (!headings.length) box.textContent = '添加标题后，大纲会显示在这里。';
}
function tableState() {
  const active = !sourceMode && crepe.editor.action(ctx => isInTable(ctx.get(editorViewCtx).state));
  document.querySelectorAll<HTMLButtonElement>('[data-table]').forEach(button => { button.disabled = !active; });
}
crepe.on(listener => listener.markdownUpdated(() => {
  if (switching || sourceMode) return;
  syncContent(); refresh(); updateOutline(); tableState();
  clearTimeout(draftTimer); draftTimer = setTimeout(persistDraft, 500);
}));
await crepe.create();
editorReady = true;
lastDoc = crepe.editor.action(ctx => ctx.get(editorViewCtx).state.doc);
$('#editor').hidden = sourceMode; $('#source-shell').hidden = !sourceMode;
if (sourceMode) { $<HTMLTextAreaElement>('#source').value = content; $('#mode').textContent = '◉ 排版'; $<HTMLButtonElement>('#insert-table').disabled = true; $('#outline').style.visibility = 'hidden'; }
refresh(); if (!sourceMode) updateOutline(); tableState();
document.addEventListener('selectionchange', () => requestAnimationFrame(updateSelectedCount));
$('#source').addEventListener('select', updateSelectedCount);
if (restored) notice('已恢复上次未保存的草稿，每份草稿各占一个标签。请另存为文件。');
const elapsed = native ? await invoke<number>('editor_ready') : Math.round(performance.now());
$('#startup').textContent = `编辑就绪 ${(elapsed / 1000).toFixed(2)} s`;

function updateLineNumbers() {
  const source = $<HTMLTextAreaElement>('#source');
  if (!sourceMode) return;
  const lineHeight = 26.6;
  const first = Math.min(sourceLineCount - 1, Math.max(0, Math.floor((source.scrollTop - 32) / lineHeight)));
  const visible = Math.min(sourceLineCount - first, Math.ceil((source.clientHeight + 32) / lineHeight) + 2);
  const gutter = $('#line-gutter');
  gutter.textContent = Array.from({ length: Math.max(visible, 0) }, (_, i) => String(first + i + 1)).join('\n');
  gutter.style.transform = `translateY(${32 + first * lineHeight - source.scrollTop}px)`;
}
function changedSource() { content = $<HTMLTextAreaElement>('#source').value; sourceLineCount = countLines(content); activeTab().state = undefined; if (editorTabId === activeId) editorTabId = null; updateLineNumbers(); refresh(); clearTimeout(draftTimer); draftTimer = setTimeout(persistDraft, 500); }
$('#source').addEventListener('input', changedSource);
$('#source').addEventListener('scroll', updateLineNumbers);
new ResizeObserver(updateLineNumbers).observe($<HTMLTextAreaElement>('#source'));
updateLineNumbers();
async function setContent(value: string) {
  switching = true;
  try {
    crepe.editor.action(replaceAll(editorMarkdown(value), true));
    lastDoc = crepe.editor.action(ctx => ctx.get(editorViewCtx).state.doc);
    editorTabId = activeId;
    content = value; $<HTMLTextAreaElement>('#source').value = value; sourceLineCount = countLines(value);
  }
  finally { switching = false; }
  refresh();
}
async function toggleMode() {
  if (sourceMode && editorTabId !== activeId) {
    if (activeTab().state) {
      switching = true;
      try {
        crepe.editor.action(ctx => ctx.get(editorViewCtx).updateState(activeTab().state!));
        lastDoc = crepe.editor.action(ctx => ctx.get(editorViewCtx).state.doc);
        editorTabId = activeId;
      } finally { switching = false; }
    } else {
      if (activeTab().fastOpen) {
        notice('正在生成排版，内容较多，请稍候…');
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      }
      await setContent(content);
      if (activeTab().fastOpen) notice('');
    }
  }
  sourceMode = !sourceMode;
  $('#editor').hidden = sourceMode; $('#source-shell').hidden = !sourceMode;
  if (sourceMode) { $<HTMLTextAreaElement>('#source').value = content; sourceLineCount = countLines(content); $('#source').focus(); }
  updateLineNumbers();
  $('#mode').textContent = sourceMode ? '◉ 排版' : '〈/〉 源码';
  $<HTMLButtonElement>('#insert-table').disabled = sourceMode;
  $('#outline').style.visibility = sourceMode ? 'hidden' : 'visible';
  if (!sourceMode) updateOutline();
  tableState();
  updateSelectedCount();
}
function checkpoint() {
  Object.assign(activeTab(), { content, saved, path, sourceMode });
}
function renderTabs() {
  const bar = $('#tabs');
  if (bar.children.length !== tabs.length || tabs.some((tab, i) => (bar.children[i] as HTMLElement)?.dataset.id !== tab.id)) {
    bar.replaceChildren();
    for (const tab of tabs) {
      const item = document.createElement('div'); item.className = 'tab'; item.dataset.id = tab.id;
      const select = document.createElement('button'); select.className = 'tab-select'; select.setAttribute('role', 'tab');
      select.onclick = () => void run(() => activate(tab.id));
      const close = document.createElement('button'); close.className = 'tab-close'; close.textContent = '×';
      close.onclick = () => void run(() => closeTab(tab.id));
      item.append(select, close); bar.append(item);
    }
  }
  tabs.forEach((tab, i) => {
    const item = bar.children[i] as HTMLElement; item.classList.toggle('active', tab.id === activeId); item.classList.toggle('external', !!tab.externalChanged);
    const select = item.firstElementChild as HTMLButtonElement;
    select.textContent = `${tab.content !== tab.saved ? '● ' : ''}${tab.externalChanged ? '↻ ' : ''}${tab.title}`;
    select.title = tab.path || tab.title; select.setAttribute('aria-selected', String(tab.id === activeId));
    item.lastElementChild!.setAttribute('aria-label', `关闭 ${tab.title}`);
  });
}
function revealActiveTab() {
  const bar = $('#tabs');
  const active = $<HTMLElement>('#tabs .active');
  const left = active.offsetLeft - bar.offsetLeft;
  const right = left + active.offsetWidth;
  if (left < bar.scrollLeft) bar.scrollLeft = left;
  else if (right > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = right - bar.clientWidth;
}
async function activate(id: string) {
  if (id === activeId) { if (activeTab().externalChanged) showExternalNotice(activeTab()); return; }
  syncContent(); checkpoint();
  const previous = activeTab();
  if (editorTabId === previous.id) previous.state = crepe.editor.action(ctx => ctx.get(editorViewCtx).state);
  previous.scroll = $('main').scrollTop;
  previous.sourceSelection = [$<HTMLTextAreaElement>('#source').selectionStart, $<HTMLTextAreaElement>('#source').selectionEnd];
  activeId = id; const next = activeTab();
  content = next.content; saved = next.saved; path = next.path; sourceMode = next.sourceMode;
  renderTabs(); revealActiveTab();
  if (!sourceMode) {
    switching = true;
    try {
      if (next.state) crepe.editor.action(ctx => ctx.get(editorViewCtx).updateState(next.state!));
      else crepe.editor.action(replaceAll(editorMarkdown(content), true));
      lastDoc = crepe.editor.action(ctx => ctx.get(editorViewCtx).state.doc);
      editorTabId = id;
    } finally { switching = false; }
  }
  $<HTMLTextAreaElement>('#source').value = content;
  sourceLineCount = countLines(content);
  $<HTMLTextAreaElement>('#source').setSelectionRange(...next.sourceSelection);
  $('#editor').hidden = sourceMode; $('#source-shell').hidden = !sourceMode;
  $('#mode').textContent = sourceMode ? '◉ 排版' : '〈/〉 源码';
  $<HTMLButtonElement>('#insert-table').disabled = sourceMode;
  $('#outline').style.visibility = sourceMode ? 'hidden' : 'visible';
  refresh(); if (!sourceMode) updateOutline();
  tableState(); updateLineNumbers();
  if (next.scroll || previous.scroll !== next.scroll) $('main').scrollTop = next.scroll;
  if (next.externalChanged) showExternalNotice(next);
}
async function save(saveAs = false): Promise<boolean> {
  const snapshot = content;
  if (native) {
    const result = await invoke<string | null>('save_document', { id: activeId, content: snapshot, saveAs });
    if (!result) return false; path = result; activeTab().title = result.split(/[\\/]/).pop()!;
  } else {
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([snapshot], { type: 'text/markdown;charset=utf-8' }));
    link.download = activeTab().title; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
  saved = snapshot; activeTab().externalChanged = false; activeTab().externalError = undefined; persistDraft(); notice(''); return true;
}
async function exportWord() {
  if (!native) { notice('请在 Windows 桌面版中导出 Word。'); return; }
  if (!content.trim()) { notice('当前标签没有可导出的内容。'); return; }
  notice('请选择 Word 文档的保存位置…');
  const result = await invoke<string | null>('export_word', {
    content: chineseLabelBoundary(content), title: activeTab().title, sourcePath: path, destination: null,
  });
  notice(result || '已取消 Word 导出。');
}
async function allowDiscard(): Promise<boolean> {
  if (!dirty()) return true;
  $('#unsaved p').textContent = `“${activeTab().title}”有尚未保存的内容。`;
  const dialog = $<HTMLDialogElement>('#unsaved'); dialog.returnValue = 'cancel'; dialog.showModal();
  const choice = await new Promise<string>(resolve => {
    dialog.onclose = () => resolve(dialog.returnValue);
    dialog.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.onclick = () => dialog.close(button.value); });
  });
  return choice === 'discard' || (choice === 'save' && await save());
}
type Opened = { id: string; path: string; content: string };
async function acceptOpened(documents: Opened[]): Promise<boolean> {
  let lastId: string | null = null;
  for (const doc of documents) {
    if (!tabs.some(tab => tab.id === doc.id)) tabs.push(makeTab(doc.content, doc.path, doc.id));
    lastId = doc.id;
  }
  if (lastId) await activate(lastId);
  persistDraft();
  return !!lastId && activeTab().fastOpen && sourceMode;
}
async function openPaths(paths?: string[]) {
  const result = await invoke<{ documents: Opened[]; errors: string[] }>('open_documents', { paths: paths ?? null });
  const fast = await acceptOpened(result.documents);
  notice([...result.errors, ...(fast ? ['大文档已先以源码打开。点击右上角「排版」生成预览，转换可能需要几秒。'] : [])].join('\n'));
}
async function openBrowserFiles(files: File[]) {
  const documents: Opened[] = [], errors: string[] = [];
  for (const file of files) {
    try {
      if (!/\.(md|markdown|txt)$/i.test(file.name)) throw new Error('仅支持 Markdown / TXT 文件');
      if (file.size > 10 * 1024 * 1024) throw new Error('文件超过 10 MB');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      documents.push({ id: `browser:${file.name}:${file.size}:${file.lastModified}`, path: file.name, content: text });
    } catch (error) { errors.push(`${file.name}：${String(error)}`); }
  }
  const fast = await acceptOpened(documents);
  notice([...errors, ...(fast ? ['大文档已先以源码打开。点击右上角「排版」生成预览，转换可能需要几秒。'] : [])].join('\n'));
}
async function open() {
  if (native) {
    await openPaths();
  } else {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.md,.markdown,.txt'; input.multiple = true;
    input.onchange = () => void run(() => openBrowserFiles(Array.from(input.files || []))); input.click();
  }
}
async function newDocument() {
  const tab = makeTab(); tabs.push(tab); await activate(tab.id); persistDraft(); notice('');
}
async function closeTab(id: string) {
  await activate(id);
  if (!await allowDiscard()) return;
  if (native) await invoke('close_document', { id });
  const index = tabs.findIndex(tab => tab.id === id);
  if (tabs.length === 1) tabs.push(makeTab());
  const next = tabs[index + 1] || tabs[index - 1];
  await activate(next.id); tabs.splice(index, 1); persistDraft(); notice('');
}
async function run(action: () => Promise<unknown>) {
  if (busy) { notice('正在处理上一项操作，请稍后再试。'); return; } busy = true;
  syncContent();
  // Native dialogs are asynchronous: freeze edits so discard/save decisions stay valid.
  const view = crepe.editor.action(ctx => ctx.get(editorViewCtx));
  view.setProps({ editable: () => false }); $<HTMLTextAreaElement>('#source').readOnly = true;
  try { await action(); } catch (error) { notice(String(error), !!activeTab().externalChanged && !activeTab().externalError); }
  finally { busy = false; view.setProps({ editable: () => true }); $<HTMLTextAreaElement>('#source').readOnly = false; refresh(); }
}
type ExternalChange = { id: string; error: string | null };
function markExternal(tab: Tab, error?: string) {
  const changed = !tab.externalChanged || tab.externalError !== error;
  if (!changed) return;
  tab.externalChanged = true; tab.externalError = error;
  refresh();
  if (tab.id === activeId) showExternalNotice(tab);
}
async function reloadExternal(id: string, discardLocal = false) {
  syncContent(); checkpoint();
  const tab = tabs.find(item => item.id === id);
  if (!tab) return;
  if (tab.content !== tab.saved && !discardLocal) { markExternal(tab); return; }
  const opened = await invoke<Opened>('reload_document', { id });
  const large = fastOpen(opened.content);
  Object.assign(tab, { content: opened.content, saved: opened.content, path: opened.path, state: undefined, fastOpen: large, sourceMode: tab.sourceMode || large, externalChanged: false, externalError: undefined });
  if (id === activeId) {
    const scroll = $('main').scrollTop;
    content = opened.content; saved = opened.content; path = opened.path; sourceMode = tab.sourceMode;
    if (sourceMode) {
      editorTabId = null;
      $<HTMLTextAreaElement>('#source').value = content;
      sourceLineCount = countLines(content);
    } else await setContent(content);
    $('#editor').hidden = sourceMode; $('#source-shell').hidden = !sourceMode;
    $('#mode').textContent = sourceMode ? '◉ 排版' : '〈/〉 源码';
    $<HTMLButtonElement>('#insert-table').disabled = sourceMode;
    $('#outline').style.visibility = sourceMode ? 'hidden' : 'visible';
    if (!sourceMode) updateOutline();
    tableState(); updateLineNumbers(); refresh();
    $('main').scrollTop = scroll;
    notice(`“${tab.title}”已按磁盘上的最新内容更新。`);
  } else refresh();
  persistDraft();
}
let checkingExternal = false;
async function checkExternal() {
  if (!native || busy || checkingExternal || document.hidden) return;
  checkingExternal = true;
  try {
    const changes = await invoke<ExternalChange[]>('check_documents');
    if (busy) return;
    syncContent(); checkpoint();
    for (const change of changes) {
      const tab = tabs.find(item => item.id === change.id);
      if (!tab) continue;
      if (change.error) { markExternal(tab, change.error); continue; }
      if (tab.content !== tab.saved) { markExternal(tab); continue; }
      if (busy) break;
      await run(async () => {
        syncContent(); checkpoint();
        try { await reloadExternal(change.id); }
        catch (error) { markExternal(tab, String(error)); }
      });
    }
  } catch (error) { notice(`检查外部文件修改失败：${String(error)}`); }
  finally { checkingExternal = false; }
}
$('#reload-external').onclick = () => void run(async () => {
  if (!activeTab().externalChanged) return;
  const dialog = $<HTMLDialogElement>('#external-confirm'); dialog.returnValue = 'cancel'; dialog.showModal();
  const choice = await new Promise<string>(resolve => {
    dialog.onclose = () => resolve(dialog.returnValue);
    dialog.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.onclick = () => dialog.close(button.value); });
  });
  if (choice === 'reload') await reloadExternal(activeId, true);
});
if (native) setInterval(() => void checkExternal(), 2500);
window.addEventListener('focus', () => void checkExternal());
$('#new').onclick = () => void run(newDocument); $('#open').onclick = () => void run(open);
$('#save').onclick = () => void run(() => save()); $('#save-as').onclick = () => void run(() => save(true));
$('#export-word').onclick = () => void run(exportWord);
$('#mode').onclick = () => void run(toggleMode); $('#focus').onclick = () => document.body.classList.toggle('focused');
$('#insert-table').onpointerdown = event => event.preventDefault();
$('#insert-table').onclick = () => { if (!busy) crepe.editor.action(insert('\n\n| 标题一 | 标题二 |\n| --- | --- |\n| 内容 | 内容 |\n\n')); };
const commands = { row: addRowAfter, column: addColumnAfter, deleteRow, deleteColumn, deleteTable };
document.querySelectorAll<HTMLButtonElement>('[data-table]').forEach(button => {
  button.onpointerdown = event => event.preventDefault();
  button.onclick = () => {
    if (busy) return;
    crepe.editor.action(ctx => { const view = ctx.get(editorViewCtx); commands[button.dataset.table as keyof typeof commands](view.state, tr => view.dispatch(closeHistory(tr))); view.focus(); });
    tableState();
  };
});
$('#editor').addEventListener('keyup', tableState); $('#editor').addEventListener('pointerup', () => setTimeout(tableState));
$('#editor').addEventListener('paste', event => {
  if (sourceMode || busy) return;
  syncContent();
  const raw = event.clipboardData?.getData('text/plain') || '';
  const blockMarkup = /^(?:\s{0,3}(?:#{1,6}\s|[-*+]\s|>\s|\d+\.\s|```|~~~|\|.+\|))/m.test(raw);
  const inlineMarkup = /(?:\*\*[^*\n]+\*\*|__[^_\n]+__|\[[^\]\n]+\]\([^)]+\)|`[^`\n]+`|\$[^$\n]+\$)/.test(raw);
  if (content.trim() || !(blockMarkup || inlineMarkup)) return;
  event.preventDefault(); event.stopImmediatePropagation();
  switching = true;
  try { crepe.editor.action(replaceAll(editorMarkdown(raw))); lastDoc = crepe.editor.action(ctx => ctx.get(editorViewCtx).state.doc); }
  finally { switching = false; }
  content = raw; sourceLineCount = countLines(raw); refresh(); updateOutline(); tableState(); persistDraft();
}, true);
document.addEventListener('keydown', event => {
  if (event.isComposing || !(event.ctrlKey || event.metaKey)) return;
  const key = event.key.toLowerCase();
  if (key === 'tab') {
    event.preventDefault(); const index = tabs.findIndex(tab => tab.id === activeId);
    void run(() => activate(tabs[(index + (event.shiftKey ? tabs.length - 1 : 1)) % tabs.length].id)); return;
  }
  const actions: Record<string, () => Promise<unknown>> = { s: () => save(event.shiftKey), o: open, n: newDocument, w: () => closeTab(activeId), '/': toggleMode };
  if (actions[key]) { event.preventDefault(); void run(actions[key]); }
});
window.addEventListener('beforeunload', event => { if (closing) return; persistDraft(); if (!native && tabs.some(tab => tab.content !== tab.saved)) { event.preventDefault(); event.returnValue = ''; } });
document.addEventListener('visibilitychange', () => { if (document.hidden) persistDraft(); else void checkExternal(); });
if (native) await getCurrentWindow().onCloseRequested(event => {
  event.preventDefault(); void run(async () => {
    checkpoint();
    for (const tab of tabs.filter(tab => tab.content !== tab.saved)) {
      await activate(tab.id);
      if (!await allowDiscard()) return;
    }
    closing = true; clearTimeout(draftTimer);
    localStorage.removeItem('qingmo.draft'); localStorage.removeItem('qingmo.drafts.v2');
    await getCurrentWindow().destroy();
  });
});
if (native) await getCurrentWebview().onDragDropEvent(({ payload }) => {
  $('#drop-hint').hidden = payload.type !== 'enter' && payload.type !== 'over';
  if (payload.type === 'drop') {
    if (busy) { notice('正在处理其他操作，请稍后重新拖入文件。'); return; }
    void run(() => openPaths(payload.paths));
  }
});
// Capture file drops before the editor can insert filenames or navigate away.
document.addEventListener('dragover', event => {
  if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); $('#drop-hint').hidden = false; }
}, true);
document.addEventListener('dragleave', event => { if (!event.relatedTarget) $('#drop-hint').hidden = true; }, true);
document.addEventListener('drop', event => {
  if (!event.dataTransfer?.files.length) return;
  event.preventDefault(); event.stopPropagation(); $('#drop-hint').hidden = true;
  if (!native) {
    if (busy) notice('正在处理其他操作，请稍后重新拖入文件。');
    else void run(() => openBrowserFiles(Array.from(event.dataTransfer!.files)));
  }
}, true);
// Links in a document must never navigate away from the editor.
$('#editor').addEventListener('click', event => { if ((event.target as HTMLElement).closest('a')) event.preventDefault(); }, true);
