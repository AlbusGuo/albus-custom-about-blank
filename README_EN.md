![](https://socialify.git.ci/AlbusGuo/albus-custom-about-blank/image?font=Inter&name=1&owner=1&pattern=Transparent&theme=Light)

[简体中文](README.md) | [English](README_EN.md)

# Custom About Blank

Turn Obsidian's new tab into a stable, efficient, and personal workspace entry point.

Custom About Blank enhances Obsidian's empty new tab directly. It brings search, shortcuts, a custom logo, vault statistics, and a yearly heatmap into one page, with two complete layouts that can be switched instantly. The plugin favors Obsidian APIs and core views and does not require a dedicated home note.

## Highlights

### Two complete new-tab layouts

- **3D view**. An isometric yearly heatmap is the visual focus. Statistics become perspective-matched platforms arranged around the calendar, while the logo, subtitle, search, and shortcuts stay compact and aligned.
- **2D view**. A logo-led composition combines a flat yearly heatmap with statistics rails on both sides. The logo and title can become a colored particle wordmark with pointer interaction and ambient motion.
- Switch layouts directly from the new-tab header with a single click and no intermediate menu.

### Native Obsidian search

- Embeds Obsidian's Search view inside the new tab, preserving search syntax, suggestions, history, and result interactions.
- Search results use a fixed-height panel and open upward when there is not enough room below.
- The search panel stays open while interacting inside it and closes only after clicking outside.

### Shortcuts

- Run any Obsidian command.
- Open a file in the vault.
- Open web pages or local HTML files through the Obsidian Web Viewer on desktop.
- Configure names, icons, confirmation prompts, and drag ordering.
- Command and file targets use suggestions and show readable names instead of internal IDs.

### Logo and particle effects

- When [Custom Icons](https://github.com/AlbusGuo/albus-custom-icons) is installed, its public API provides the logo and shortcut icon picker.
- Without Custom Icons, logo selection falls back to the system file picker and other icons fall back to Obsidian's default icon capability.
- The 2D view supports an interactive particle logo with per-pixel color sampling, an optional uniform color, density, size, scale, disturbance radius, and disturbance strength controls.
- Low-cost ambient modes include wave, float, staggered float, heartbeat, ripple, and breathe.
- The 3D view uses a compact logo and subtitle aligned with the search box.

### File and date statistics

- Built-in file count and vault storage statistics.
- Custom file statistics with nested condition groups, property suggestions, multiple comparison operators, and properties discovered from the actual vault, following the interaction model of Obsidian Bases.
- Anniversary and countdown date statistics.
- Click a custom file statistic to open its matching file list.
- Drag statistics to exchange positions, with layout-specific motion for both 2D and 3D views.
- Built-in, custom file, and date statistics use stable and distinct color semantics.

### 2D and 3D yearly heatmaps

- Use file creation time, modification time, or a note date property as the data source.
- Customize value segments and empty-cell colors.
- Click a populated date to inspect its files.
- Year controls stay beside the year label. The 2D and 3D views use continuous cell and pillar transitions respectively.
- Tooltips use Obsidian's native interaction style.

## Requirements

- Obsidian `1.11.4` or newer.
- Desktop only.
- Opening local HTML requires the Obsidian Web Viewer core plugin.
- Custom Icons is optional. The plugin remains usable without it.

## Installation

### Obsidian community plugins

1. Open `Settings -> Community plugins -> Browse`.
2. Search for `Custom About Blank`.
3. Install and enable the plugin.

### BRAT

Add this repository in BRAT:

```text
https://github.com/AlbusGuo/albus-custom-about-blank
```

### Manual installation

Download these three files from [Releases](https://github.com/AlbusGuo/albus-custom-about-blank/releases) and place them in `.obsidian/plugins/albus-custom-about-blank/` inside your vault:

```text
main.js
manifest.json
styles.css
```

Reload Obsidian and enable the plugin.

## Basic usage

1. Open a new empty tab.
2. Use the header action to switch between the 2D and 3D new-tab styles.
3. Configure shortcuts, the logo, particles, statistics, and the heatmap data source in plugin settings.
4. Drag shortcuts or statistics to reorder them directly.

The selected layout manages every core component as one composition. There is no separate set of component visibility switches to maintain.

## Compatibility and boundaries

- Running multiple plugins that replace the new tab can cause conflicts.
- The plugin enhances only Obsidian's empty view and does not alter normal Markdown pages.
- Local HTML is handed to Web Viewer through a temporary loopback bridge and is available on desktop only.
- Semantic search and external models are not included. Search continues to use Obsidian's native capability.

## Development

```bash
npm install
npm run build
```

The production build type-checks TypeScript and generates `main.js` and `styles.css`.

## Acknowledgments and references

- This project is forked from [About Blank](https://github.com/Ai-Jani/about-blank) `1.2.0`, created by [Ai-Jani](https://github.com/Ai-Jani) and released under the MIT License.
- [Home Tab Plus](https://github.com/Moyf/home-tab-plus) was an important reference for new-tab information architecture, search entry design, and the particle wordmark experience.
- [Home Tab](https://github.com/olrenso/Obsidian-home-tab) is the original project behind Home Tab Plus and inspired the browser-like new-tab concept.
- The particle interaction concept also references [Arknights-FlowingPoints](https://github.com/BlackCoder0/Arknights-FlowingPoints). This plugin implements its own engine for the Obsidian DOM, multi-window behavior, and performance constraints.
- The isometric commit calendar in [github-badge-collection](https://github.com/AlbusGuo/github-badge-collection) informed the visual direction of the 3D heatmap.
- Thanks to the Obsidian community and all authors and contributors of the projects above.

## License

[MIT License](LICENSE). Copyright (c) 2025 Ai-Jani and 2026 Albus.
