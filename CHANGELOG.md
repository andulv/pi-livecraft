# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-08-04

### Added

- Native Windows support (process launching, home-path resolution, terminal and directory completion).
- Right-click sessions in the sidebar to rename them, or close (exit) running Pi sessions without deleting their persisted history; the next nearby active session is selected automatically.
- Collapsible sessions panel.
- CI checks (typecheck, lint, tests) running against the latest Pi version.
- GitHub stars badge in the README.

### Changed

- Idle Pi processes are now reused across sessions instead of being restarted, and each workspace keeps up to three always-ready Pi processes, making long conversations open much faster.
- Markdown rendering is cached and conversation previews are lighter.
- Sessions are sorted by latest activity and their states (active, ended) are now clearly distinguished in the sidebar.
- Sidebar visual polish: spacing, alignment and ended-session styling harmonized.
- Restored optional coverage of pi-agents in integration tests.

## [1.0.0] - 2026-08-01

### Added

- Initial release.
