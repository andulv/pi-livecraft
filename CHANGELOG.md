# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-08-05

### Added

- Run Pi Livecraft natively on Windows, including process launching, home-path resolution, terminal and directory completion.
- Manage sessions directly from the sidebar: rename them or close running Pi sessions without losing persisted history; the next nearby active session is selected automatically.
- Reclaim sidebar space by collapsing the sessions panel.
- Keep changes safer with CI checks (typecheck, lint, tests) against the latest Pi version.
- See GitHub project interest at a glance with a stars badge in the README.

### Changed

- Open long conversations much faster: Pi processes are reused instead of restarted; the first three sessions in each workspace keep their own process, and only a process idle for more than three minutes is reassigned afterward. Bursts can temporarily create additional processes.
- Browse conversations faster with cached Markdown rendering and lighter previews.
- Find recent work faster: sessions are sorted by latest activity, with active and ended states clearly distinguished in the sidebar.
- Understand session state at a glance: the sidebar now marks idle sessions that still have an attached Pi process; spacing, alignment and ended-session styling are also clearer.

### Fixed

- Avoid startup race failures: requests now wait briefly for the manager to connect.
- Open long conversations reliably: session histories up to 64 MiB no longer hit the default JSONL record limit.

## [1.0.0] - 2026-08-01

### Added

- Initial release.
