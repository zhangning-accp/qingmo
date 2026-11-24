import type { EditorView } from '@milkdown/kit/prose/view';
import { closeHistory } from '@milkdown/kit/prose/history';
import { renderFormula } from './math';

export function createFormulaEditor(getView: () => EditorView, isSource: () => boolean, changedSource: () => void) {
  const dialog = document.createElement('dialog');
  dialog.id = 'formula-editor';
  dialog.setAttribute('aria-labelledby', 'formula-title');
  dialog.innerHTML = `<h1 id="formula-title">编辑公式</h1>
    <form method="dialog">
      <label for="formula-code">LaTeX 公式</label>
      <textarea id="formula-code" autofocus spellcheck="false" rows="4" aria-describedby="formula-error" placeholder="例如 \\frac{1}{2} + x^{2}"></textarea>
      <div class="formula-options"><label><input id="formula-block" type="checkbox">独立成行</label><span>双击正文中的公式可以修改</span></div>
      <div class="formula-examples" aria-label="常用公式"></div>
      <div id="formula-preview" aria-label="公式预览"></div>
      <p id="formula-error" role="status"></p>
      <div class="formula-actions"><button value="cancel" formnovalidate>取消</button><button id="formula-apply" value="apply" class="primary">应用公式</button></div>
    </form>`;
  document.body.append(dialog);
  const code = dialog.querySelector<HTMLTextAreaElement>('#formula-code')!;
  const block = dialog.querySelector<HTMLInputElement>('#formula-block')!;
  const apply = dialog.querySelector<HTMLButtonElement>('#formula-apply')!;
  const error = dialog.querySelector<HTMLElement>('#formula-error')!;
  let source = false, from = 0, to = 0;
  function preview() {
    try {
      renderFormula(code.value, dialog.querySelector('#formula-preview')!, block.checked, true);
      apply.disabled = !code.value.trim(); error.textContent = '';
    } catch (problem) {
      apply.disabled = true;
      error.textContent = `公式语法有误，请检查括号或命令。${String(problem).replace(/^.*?KaTeX parse error:/, '')}`;
    }
  }
  code.oninput = preview; block.onchange = preview;
  const examples = [ ['分数', '\\frac{1}{2}'], ['次方', 'x^{2}'], ['根号', '\\sqrt{x}'], ['乘除', '(-2) \\times (-3) \\div 4'], ['方程', 'x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}'] ];
  for (const [label, latex] of examples) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    button.onclick = () => { code.setRangeText(latex, code.selectionStart, code.selectionEnd, 'end'); preview(); code.focus(); };
    dialog.querySelector('.formula-examples')!.append(button);
  }
  dialog.querySelector('form')!.onsubmit = event => {
    if ((event as SubmitEvent).submitter !== apply) return;
    event.preventDefault(); preview(); if (apply.disabled) return;
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
  dialog.onclose = () => { dialog.returnValue = ''; };
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
    preview(); dialog.returnValue = ''; dialog.showModal();
  };
}
