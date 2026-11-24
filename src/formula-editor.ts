import type { EditorView } from '@milkdown/kit/prose/view';
import { closeHistory } from '@milkdown/kit/prose/history';
import { renderFormula } from './math';
import type { MathfieldElement } from 'mathlive';
import 'mathlive/fonts.css';

export function createFormulaEditor(getView: () => EditorView, isSource: () => boolean, changedSource: () => void) {
  const dialog = document.createElement('dialog');
  dialog.id = 'formula-editor';
  dialog.setAttribute('aria-labelledby', 'formula-title');
  dialog.innerHTML = `<h1 id="formula-title">编辑公式</h1>
    <form method="dialog">
      <div id="formula-field-host"></div>
      <p id="formula-loading" role="status">正在加载公式编辑器…</p>
      <div class="formula-options"><label><input id="formula-block" type="checkbox">独立成行</label><span>双击正文中的公式可以修改</span></div>
      <div class="formula-examples" aria-label="常用公式"></div>
      <div id="formula-keyboard" role="group" aria-label="数学符号键盘"></div>
      <details id="formula-source"><summary>LaTeX 源码</summary>
        <label for="formula-code">LaTeX 公式</label>
        <textarea id="formula-code" spellcheck="false" rows="2"></textarea>
        <div id="formula-preview" aria-label="公式预览"></div>
      </details>
      <p id="formula-error" role="status"></p>
      <div class="formula-actions"><button value="cancel" formnovalidate>取消</button><button id="formula-apply" value="apply" class="primary">应用公式</button></div>
    </form>`;
  document.body.append(dialog);
  const code = dialog.querySelector<HTMLTextAreaElement>('#formula-code')!;
  const block = dialog.querySelector<HTMLInputElement>('#formula-block')!;
  const apply = dialog.querySelector<HTMLButtonElement>('#formula-apply')!;
  const error = dialog.querySelector<HTMLElement>('#formula-error')!;
  let source = false, from = 0, to = 0;
  let field: MathfieldElement | undefined;
  let generation = 0;
  let restoreKeyboard = () => {};
  const loading = dialog.querySelector<HTMLElement>('#formula-loading')!;
  const keyboardHost = dialog.querySelector<HTMLElement>('#formula-keyboard')!;
  function feedback(message = '', invalid = false) {
    error.textContent = message;
    error.classList.toggle('formula-hint', !invalid);
    for (const input of [code, field]) {
      if (!input) continue;
      input.setAttribute('aria-invalid', String(invalid));
      if (message) input.setAttribute('aria-describedby', 'formula-error');
      else input.removeAttribute('aria-describedby');
    }
  }
  function preview(showErrors = false) {
    const target = dialog.querySelector<HTMLElement>('#formula-preview')!;
    const blanks = code.value.match(/\\placeholder\b/g)?.length ?? 0;
    if (blanks) {
      apply.disabled = true;
      target.replaceChildren();
      feedback(`还有 ${blanks} 个空白框待填写。点击空白框输入，或按 Tab 切换，填完后即可应用。`);
      return;
    }
    try {
      renderFormula(code.value, target, block.checked, true);
      apply.disabled = !field || !code.value.trim(); feedback();
    } catch {
      apply.disabled = true;
      target.replaceChildren();
      feedback(showErrors
        ? '公式语法有误，请检查括号是否配对，或展开 LaTeX 源码检查命令。'
        : '公式尚未完成，请继续输入。完成后即可应用。', showErrors);
    }
  }
  code.oninput = () => { if (field) field.value = code.value; preview(); };
  code.onblur = () => preview(true);
  block.onchange = () => preview();
  const examples = [ ['分数', '\\frac{#?}{#?}'], ['上标', '#?^{#?}'], ['下标', '#?_{#?}'], ['根号', '\\sqrt{#?}'], ['求和', '\\sum_{#?}^{#?}'] ];
  for (const [label, latex] of examples) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    button.onclick = () => { if (!field) return; field.insert(latex); code.value = field.value; preview(); field.focus(); };
    dialog.querySelector('.formula-examples')!.append(button);
  }
  dialog.querySelector('form')!.onsubmit = event => {
    if ((event as SubmitEvent).submitter !== apply) return;
    event.preventDefault(); preview(true); if (apply.disabled) return;
    if (source) {
      const input = document.querySelector<HTMLTextAreaElement>('#source')!;
      const value = block.checked ? `\n\n$$\n${code.value.trim()}\n$$\n\n` : `$${code.value.trim()}$`;
      input.setRangeText(value, from, to, 'end'); changedSource();
    } else {
      const view = getView();
      const type = view.state.schema.nodes[block.checked ? 'math_block' : 'math_inline'];
      const transaction = closeHistory(view.state.tr).replaceWith(from, to, type.create({ value: code.value.trim() }));
      view.dispatch(transaction.scrollIntoView());
    }
    dialog.close();
  };
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (event.composedPath().some(node => node instanceof Element && node.getAttribute('role') === 'menu')) event.preventDefault();
    // MathLive otherwise consumes Escape before the native dialog can dismiss.
    else event.stopPropagation();
  }, true);
  dialog.onclose = () => {
    generation++;
    restoreKeyboard(); restoreKeyboard = () => {};
    field?.remove(); field = undefined;
    dialog.returnValue = '';
  };
  async function loadField(request: number) {
    try {
      const { MathfieldElement } = await import('mathlive');
      if (!dialog.open || request !== generation) return;
      MathfieldElement.fontsDirectory = null;
      MathfieldElement.soundsDirectory = null;
      MathfieldElement.computeEngine = null;
      field = new MathfieldElement();
      field.setAttribute('aria-label', '可视化公式输入');
      field.value = code.value;
      field.mathVirtualKeyboardPolicy = 'manual';
      field.addEventListener('input', () => { code.value = field!.value; preview(); });
      field.addEventListener('blur', () => preview(true));
      dialog.querySelector('#formula-field-host')!.append(field);
      const keyboard = window.mathVirtualKeyboard;
      const container = keyboard.container;
      const layouts = keyboard.layouts;
      keyboard.container = keyboardHost;
      keyboard.layouts = ['numeric', 'symbols', 'alphabetic', 'greek'];
      const resize = () => { keyboardHost.style.height = `${keyboard.visible ? keyboard.boundingRect.height : 0}px`; };
      keyboard.addEventListener('geometrychange', resize);
      restoreKeyboard = () => {
        keyboard.removeEventListener('geometrychange', resize);
        keyboard.hide({ animate: false });
        keyboard.container = container; keyboard.layouts = layouts;
        keyboardHost.style.height = '0px';
      };
      loading.hidden = true; preview();
      field.focus(); keyboard.show({ animate: false }); resize();
    } catch {
      if (!dialog.open || request !== generation) return;
      loading.textContent = '公式编辑器加载失败，请关闭后重试。'; apply.disabled = true;
    }
  }
  return (position?: number) => {
    source = isSource(); code.value = ''; block.checked = false;
    if (source) {
      const input = document.querySelector<HTMLTextAreaElement>('#source')!;
      from = input.selectionStart; to = input.selectionEnd;
      const text = input.value.slice(from, to);
      block.checked = text.startsWith('$$');
      code.value = text.replace(/^\$\$?\s*|\s*\$\$?$/g, '');
    } else {
      const { state } = getView(); from = state.selection.from; to = state.selection.to;
      const node = state.doc.nodeAt(position ?? from);
      if (node && ['math_inline', 'math_block'].includes(node.type.name)) {
        from = position ?? from; to = from + node.nodeSize; code.value = node.attrs.value;
        block.checked = node.type.name === 'math_block';
      } else code.value = state.doc.textBetween(from, to);
    }
    loading.textContent = '正在加载公式编辑器…'; loading.hidden = false;
    dialog.querySelector<HTMLDetailsElement>('#formula-source')!.open = false;
    preview(); dialog.returnValue = ''; dialog.showModal();
    void loadField(++generation);
  };
}
