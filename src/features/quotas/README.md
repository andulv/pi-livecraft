# Provider quotas widget

The quotas widget gives a quick answer to a practical question: how much of the current provider allowance is used? The rail shows the selected model provider's primary usage percentage, while the panel keeps both supported providers available for comparison.

## What it shows

- OpenAI Codex five-hour and seven-day windows, with used percentage, elapsed-period progress, and reset time;
- GitHub Copilot usage categories, with used and total values, elapsed calendar-month progress, and reset times when available;
- time-bound usage bars stack green, yellow, and red segments to show how much usage is within pace, close to pace, or well ahead of pace; GLM web searches retain the standard bar because their period is unknown;
- Z.AI peak-pricing hours (14:00–18:00 UTC+8, ×3 quota) on a 24-hour local-day bar: hour labels every four hours plus any peak boundaries between them, the word "peak" centered under the window, and a red highlight while the current time is inside it;
- when the reading was last updated, plus the current time so reset times can be read against the local clock;
- a stale marker when the latest refresh failed but an older valid reading is still available;
- provider errors without hiding valid data from the other provider.

The widget never invents a missing limit or treats absent data as zero. An open Pi session is required to request a fresh reading. The last valid snapshot can remain visible while stale, which is more useful than replacing known data with an empty panel.

## Refresh behavior

The refresh button asks Pi for a new provider report and remains disabled while that request is running. The backend deduplicates concurrent refreshes and restores cached readings after its own restart.

For the rail summary, Codex prefers its five-hour window. Copilot uses the first quota category returned by its provider report. The percentage is expressed as used quota. A stale rail value carries an additional warning marker.

## Ownership and data flow

`App.tsx` owns the shared quota snapshot. `QuotaWidget` renders it, and `quota-display.ts` derives the compact rail value for the active provider.

Requests travel through `src/api.ts` and the [quotas backend capability](/server/features/quotas/README.md). Pi Livecraft's quota extension publishes a validated, versioned status payload through Pi rather than reading provider state directly from the browser.

Focused coverage: `test/quotas.test.ts`.
