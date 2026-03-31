# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-03-31

### Added
- Full-screen side-by-side diff viewer with close button
- Lazy-loaded file explorer in sidebar
- Changed files hook and discard file backend
- Process regression spec and updated test configs

### Changed
- Sidebar UI: explorer nav, changed files panel, compact styling
- UX improvements: compact composer, streaming auto-scroll, diff integration
- Sidebar layout improvements and theme toggle cleanup

### Fixed
- Streaming auto-scroll not following agent output
- Theme toggle visual cleanup

## [0.3.15] - 2026-03-30

### Added
- Theme toggle in topbar with combined skills & extensions tabbed view
- Extension system: session spawn guards, extension binding in session supervisor, and extension UI state management
- Expose all pi agent slash commands in desktop chat window
- Ctrl+=/- zoom shortcuts and updated hotkeys list
- Expand/collapse for workspace folders in sidebar
- Single-instance lock and process lifecycle management
- Show session-edited files in Changes panel without requiring git
- Warm Anthropic-style light theme palette
- Windows platform support and security hardening
- Electron-builder config for Windows installer builds
- Playwright tests for Changes tab
- Test harness updates for extension UI and process guards

### Changed
- Upgrade pi-coding-agent to ^0.64.0
- Bump @mariozechner/pi-coding-agent to ^0.63.1
- UI polish: composer fix, scrollbar styling, sidebar branding, app icon
- Serialise refreshState for extension state management
- Update build config and dependencies

### Fixed
- Match title bar overlay colors to active view background
- Infer extension display name from parent dir when file is index.*
- Expand Skills/Extensions views to use full width
- Only show session-derived files in Changes panel
- Send button invisible in dark mode
- Stop button stays active during brief idle gaps between agent turns
- Ensure userData directory exists before first UI state persistence
- Repair two broken smoke tests

## [0.2.0] - Initial Windows Fork

### Added
- Desktop features, bug fixes, and UI improvements
- Windows installer build instructions

[0.4.0]: https://github.com/pvjagtap/pi-desktop/compare/v0.3.15...v0.4.0
[0.3.15]: https://github.com/pvjagtap/pi-desktop/compare/0.2.0...v0.3.15
[0.2.0]: https://github.com/pvjagtap/pi-desktop/releases/tag/0.2.0
