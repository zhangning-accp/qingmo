import katex from 'katex';
import remarkMath from 'remark-math';
import { $nodeSchema, $remark, $inputRule } from '@milkdown/kit/utils';
import { nodeRule } from '@milkdown/kit/prose';
import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import 'katex/dist/katex.min.css';

export function renderFormula(value: string, target: HTMLElement, block: boolean, strict = false) {
  katex.render(value, target, { displayMode: block, throwOnError: strict, trust: false, maxExpand: 1000 });
}

function formulaSchema(name: string, block: boolean) {
  return $nodeSchema(name, () => ({
    group: block ? 'block' : 'inline', inline: !block, atom: true,
    attrs: { value: { default: '' } },
    parseDOM: [{ tag: `[data-formula="${name}"]`, getAttrs: (dom: HTMLElement) => ({ value: dom.dataset.value || '' }) }],
    toDOM(node) {
      const element = document.createElement(block ? 'div' : 'span');
      element.dataset.formula = name;
      element.dataset.value = node.attrs.value;
      element.title = '双击编辑公式';
      renderFormula(node.attrs.value, element, block);
      return element;
    },
    parseMarkdown: {
      match: node => node.type === (block ? 'math' : 'inlineMath'),
      runner: (state, node, type) => { state.addNode(type, { value: node.value }); },
    },
    toMarkdown: {
      match: node => node.type.name === name,
      runner: (state, node) => { state.addNode(block ? 'math' : 'inlineMath', undefined, node.attrs.value); },
    },
  }));
}

export const inlineFormula = formulaSchema('math_inline', false);
export const blockFormula = formulaSchema('math_block', true);
const mathParser = $remark('qingmoMath', () => remarkMath);
// Convert only standalone HTML line-break nodes. Other HTML remains literal.
const lineBreaks = $remark('qingmoLineBreaks', () => () => (tree: any) => {
  function visit(node: any) {
    if (node.type === 'html' && /^<br\s*\/?\s*>$/i.test(node.value)) { node.type = 'break'; delete node.value; }
    node.children?.forEach(visit);
  }
  visit(tree);
});
const inlineRule = $inputRule(ctx => nodeRule(/\$([^$\n]+)\$$/, inlineFormula.type(ctx), {
  getAttr: match => ({ value: match[1] }),
}));
export const mathPlugins: MilkdownPlugin[] = [mathParser, lineBreaks, inlineFormula, blockFormula, inlineRule].flat();
