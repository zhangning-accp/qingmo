---
name: 轻墨
description: 深蓝灰纸面、蓝橙边缘光与微微凸起的文档标签。
colors: { blue: "#86bdff", warm: "#ffbb8b", bg: "#0c121c", paper: "#131e2b", text: "#dce6f3", muted: "#a0b1c7", primary-ink: "#e6f2ff", source-text: "#c8d9ed", tab-text: "#b7c8dc", tab-active-text: "#edf6ff", notice-bg: "#35302d", notice-text: "#ffdabd" }
typography:
  headline: { fontFamily: '"Segoe UI", "Microsoft YaHei UI", sans-serif', fontSize: "30px", fontWeight: 600, lineHeight: 1.45, letterSpacing: "-0.4px" }
  title: { fontFamily: '"Segoe UI", "Microsoft YaHei UI", sans-serif', fontSize: "21px", fontWeight: 600, lineHeight: 1.5 }
  body: { fontFamily: '"Segoe UI", "Microsoft YaHei UI", sans-serif', fontSize: "16px", lineHeight: 1.85 }
  label: { fontFamily: '"Segoe UI", "Microsoft YaHei UI", sans-serif', fontSize: "13px", lineHeight: 1.4 }
  code: { fontFamily: 'Consolas, "Microsoft YaHei", monospace', fontSize: "14px", lineHeight: "26.6px" }
rounded: { control: "6px", tab: "7px", code: "8px", notice: "9px", window: "12px", dialog: "14px" }
spacing: { window-inset: "10px", tab-gap: "7px", paragraph: "16px", main-min-inline: "18px", main-max-inline: "48px" }
components:
  button-primary: { textColor: "{colors.primary-ink}", typography: "{typography.label}", rounded: "{rounded.control}", padding: "7px 11px" }
  button-ghost: { backgroundColor: "transparent", textColor: "{colors.text}", typography: "{typography.label}", rounded: "{rounded.control}", padding: "7px 11px" }
  source-field: { backgroundColor: "transparent", textColor: "{colors.source-text}", typography: "{typography.code}", padding: "32px 4px 32px 58px", width: "100%" }
  document-tab: { textColor: "{colors.tab-text}", rounded: "{rounded.tab}" }
  document-tab-active: { textColor: "{colors.tab-active-text}", rounded: "{rounded.tab}" }
  notice: { backgroundColor: "{colors.notice-bg}", textColor: "{colors.notice-text}", rounded: "{rounded.notice}", padding: "14px 16px" }
---

# Design System: 轻墨

## Overview
**Creative North Star: "深蓝灰桌面与蓝橙边缘光"**

轻墨是本地 Windows Markdown 编辑器。当前主题以深蓝灰承载长文，蓝色强调交互与选中状态，橙色用于窗口右侧边光及外部修改提示。通过静态 CSS 渐变、顶部高光和接触阴影，让标签呈现浅浅凸起的质感。

**Key Characteristics:**
- 深蓝灰编辑纸面与清晰的浅色文字。
- 蓝橙光线收在窗口边缘，标签选中态具有底部蓝光。
- 保留现有编辑布局与操作行为，光效不拦截鼠标事件。

依据：`src/style.css`、`index.html`、`src-tauri/tauri.conf.json`。前置 token 为实际样式；sidecar 的 tonalRamp 仅为面板生成的色阶预览，不是新增产品用色。

## Colors
**Primary — 清亮蓝（blue）**：键盘焦点和编辑器主色。**Secondary — 暖橙（warm）**：外部修改标签底光，与窗口暖边呼应。**Neutral**：深夜底色（bg）、蓝灰纸面（paper）、浅灰正文（text）及柔灰辅助文字（muted）。局部颜色由对应组件 token 表达，渐变保持源 CSS 写法。

## Typography
界面与正文使用 Segoe UI、Microsoft YaHei UI；源码使用 Consolas、Microsoft YaHei。一级、二级标题与正文分别对应 `headline`、`title`、`body`；三级标题（18px），标签与目录（12px），状态栏通常（11px）。品牌字标（19px、600、2px 字距），印章字符使用 STKaiti、KaiTi（23px）。

## Layout
纵向排列顶栏、标签、编辑区和状态栏；左侧为目录。原生窗口初始（1150 × 800）、最小（760 × 520），主题为 `Dark`。顶栏、标签栏、状态栏最小高度分别（70px、54px、32px），目录宽（216px）。主区水平内边距为 `clamp(18px, 3%, 48px)`，正文、表格与源码使用剩余宽度，窗口放大时同步展开。专注模式仅隐藏目录，释放出的宽度归编辑区，不再限制正文为固定窄栏。

断点（1000px）收紧布局、目录宽降至（180px）；（800px）隐藏顶栏文件名；（620px）隐藏目录、顶栏和状态栏换行、主区边距降至（18px）。最后一个断点适用于窄浏览器视口，低于原生最小宽度。标签可横向滚动，工具栏吸附在编辑区顶部。

## Elevation & Depth
窗口具有蓝橙双色边光；选中标签由顶部高光、底部蓝线和接触阴影构成浅凸面，外部修改状态改用暖橙底线。准确阴影及组件渐变见 sidecar 的源样式摘录。

**The 静态边光 Rule.** 边光保持静态；装饰伪元素使用 `pointer-events: none`。按钮只使用（160ms ease-out）颜色和阴影过渡，减少动态效果偏好会关闭过渡与动画。

## Shapes
沿用前置圆角 token：控件、标签、代码块、通知、窗口、对话框分别对应各自形状。外框为（1px），选中标签底线为（2px）；材质不依赖位图。

## Components
- **程序图标**：`icon.svg` 重现顶栏的“墨”字徽章。深蓝斜向渐变、细亮边、底部阴影和字形周围的柔光构成立体感。派生 ICO 含 16、24、32、48、64、256px。
- **按钮**：普通按钮透明。主按钮采用深蓝斜向渐变、细高光和柔蓝外光，字重为 600。悬停加亮，按下时用内阴影。禁用态不透明度为 0.6，键盘焦点显示 2px 蓝轮廓。
- **标签**：最大宽（270px）、最小高（36px），选中时加强高光与底光。标签按钮焦点向内偏移（-3px）；关闭按钮悬停采用暖色反馈。
- **源码区**：透明底、等宽字、左侧行号；聚焦显示内侧（1px）蓝灰线，保留垂直缩放和滚动。
- **纸面与浮层**：正文保持宽松行距；代码块及表格使用编辑器暗色变量。通知采用暖灰底和暖色描边；对话框采用蓝灰渐变及深阴影。

## Do's and Don'ts
### Do:
- **Do** 保持启动画面、原生深色主题和编辑器暗色变量一致。
- **Do** 用顶部高光、底部蓝光与接触阴影表达选中标签的凸起感。
- **Do** 保留按钮键盘焦点和减少动态效果支持。

### Don't:
- **Don't** 让边框光效遮挡正文或拦截交互。
- **Don't** 将静态边光改为循环动画，或引入生成位图作为当前材质依赖。

## 公式编辑

0.4.6 的公式窗口沿用原生 dialog、深蓝灰表面和现有字体。LaTeX 输入、行内／独立模式、模板、实时预览与错误提示从上到下排列，主按钮在底部右侧。双击正文公式打开，Esc 或取消返回正文。
