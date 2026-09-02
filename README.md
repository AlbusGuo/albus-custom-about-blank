![](https://socialify.git.ci/AlbusGuo/albus-custom-about-blank/image?font=Inter&name=1&owner=1&pattern=Transparent&theme=Light)

[简体中文](README.md) | [English](README_EN.md)

# Custom About Blank

把 Obsidian 新标签页变成稳定, 高效且具有个人风格的工作入口.

Custom About Blank 直接增强 Obsidian 的空白新标签页. 它将搜索, 快捷方式, Logo, 文件统计和年度热力图组织在同一个页面中, 并提供两套可即时切换的完整布局. 插件优先复用 Obsidian API 和核心视图, 不会创建独立的主页文件.

## 主要特性

### 两种完整的新标签页布局

- **3D 视图**. 以等距 3D 年度热力图为视觉中心, 统计项作为符合相同透视关系的平台分布在热力图两侧. Logo, 标题, 搜索框和快捷方式保持紧凑对齐.
- **2D 视图**. 以 Logo 和标题为中心, 搭配平面年度热力图与两侧统计轨道. Logo 和标题可以渲染为支持指针扰动与默认动画的彩色粒子点阵.
- 点击新标签页页首的切换按钮即可直接切换样式, 无需打开额外菜单.

### Obsidian 原生搜索

- 在新标签页中嵌入 Obsidian 的搜索视图, 保留搜索语法, 搜索提示, 历史记录和结果交互.
- 搜索结果使用固定高度面板. 下方空间不足时自动向上展开.
- 只有点击搜索区域外部才会收起, 避免输入或操作提示时意外退出.

### 快捷方式

- 执行任意 Obsidian 命令.
- 打开库内文件.
- 在桌面端通过 Obsidian Web Viewer 打开网页或本地 HTML 文件.
- 支持名称, 图标, 确认提示与拖拽排序.
- 命令和文件使用联想输入, 显示可读名称而不是内部 ID.

### Logo 与粒子效果

- 安装 [Custom Icons](https://github.com/AlbusGuo/albus-custom-icons) 后, 可直接通过其公开 API 选择 Logo 和快捷方式图标.
- 未安装 Custom Icons 时, Logo 自动退回系统文件选择器, 其他图标退回 Obsidian 默认选择能力.
- 2D 视图支持交互式粒子 Logo, 彩色逐像素采样, 自定义统一颜色, 粒子密度, 大小, 缩放, 扰动范围和扰动强度.
- 提供波浪, 浮动, 错落浮动, 心跳, 涟漪与呼吸等低开销默认动画.
- 3D 视图使用紧凑 Logo 与小标题, 并与搜索框保持垂直对齐.

### 文件与日期统计

- 内置文件数量和库空间统计.
- 自定义文件统计支持类似 Obsidian Bases 的嵌套条件组, 属性联想, 多种比较运算符和真实库属性来源.
- 日期统计支持纪念日和倒计时.
- 点击自定义文件统计项可以打开匹配文件列表.
- 统计项支持拖拽交换位置, 2D 与 3D 视图使用各自匹配的排序动画.
- 内置统计, 自定义文件统计和日期统计具有稳定且可区分的颜色语义.

### 2D 与 3D 年度热力图

- 数据来源可以选择文件创建时间, 修改时间或笔记中的日期属性.
- 支持自定义颜色分段和空白格颜色.
- 点击有效日期可以查看当日文件列表.
- 年份按钮紧邻年份显示, 2D 和 3D 视图分别使用连续的小格与柱体过渡动画.
- Tooltip 使用 Obsidian 官方交互样式.

## 使用要求

- Obsidian `1.11.4` 或更高版本.
- 仅支持桌面端.
- 本地 HTML 需要启用 Obsidian 的 Web Viewer 核心插件.
- Custom Icons 是可选依赖. 未安装时插件仍可正常使用.

## 安装

### Obsidian 社区插件市场

1. 打开 `设置 -> 第三方插件 -> 浏览`.
2. 搜索 `Custom About Blank`.
3. 安装并启用插件.

### BRAT

在 BRAT 中添加以下仓库:

```text
https://github.com/AlbusGuo/albus-custom-about-blank
```

### 手动安装

从 [Releases](https://github.com/AlbusGuo/albus-custom-about-blank/releases) 下载以下三个文件, 放入库中的 `.obsidian/plugins/albus-custom-about-blank/`:

```text
main.js
manifest.json
styles.css
```

然后重新加载 Obsidian 并启用插件.

## 基本使用

1. 打开一个新的空白标签页.
2. 点击页首按钮切换 2D 或 3D 新标签页样式.
3. 在插件设置中配置快捷方式, Logo, 粒子效果, 统计项目和热力图数据来源.
4. 直接拖拽快捷方式或统计项调整顺序.

所有核心组件由布局统一管理. 插件不会要求用户分别维护多套组件开关.

## 兼容性与边界

- 同一时间启用多个 "替换新标签页" 的插件可能产生冲突.
- 插件只增强 Obsidian 空白视图, 不会修改普通 Markdown 页面.
- 本地 HTML 通过仅绑定本机的临时桥接地址交给 Web Viewer 打开, 该功能仅适用于桌面端.
- 语义搜索和外部模型不包含在当前版本中. 搜索仍使用 Obsidian 原生能力.

## 开发

```bash
npm install
npm run build
```

生产构建会执行 TypeScript 检查并生成 `main.js` 和 `styles.css`.

## 致谢与参考

- 本项目 fork 自 [About Blank](https://github.com/Ai-Jani/about-blank) `1.2.0`, 原项目由 [Ai-Jani](https://github.com/Ai-Jani) 开发并以 MIT 许可证发布.
- [Home Tab Plus](https://github.com/Moyf/home-tab-plus) 为新标签页的信息组织, 搜索入口和粒子字标体验提供了重要参考.
- [Home Tab](https://github.com/olrenso/Obsidian-home-tab) 是 Home Tab Plus 的原始项目, 其浏览器式新标签页理念同样给予了启发.
- 粒子交互概念参考了 [Arknights-FlowingPoints](https://github.com/BlackCoder0/Arknights-FlowingPoints). 本插件针对 Obsidian DOM, 多窗口环境与性能边界进行了独立实现.
- 3D 热力图的视觉方向参考了 [github-badge-collection](https://github.com/AlbusGuo/github-badge-collection) 中的等距提交日历.
- 感谢 Obsidian 社区及以上项目的作者和贡献者.

## 许可证

[MIT License](LICENSE). Copyright (c) 2025 Ai-Jani and 2026 Albus.
