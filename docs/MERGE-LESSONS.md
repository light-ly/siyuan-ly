# Lessons and checklists for merging upstream

This document records the defects introduced when merging upstream v3.8.8, how they were fixed, and the checklist that must be followed for every future upstream merge.

[简体中文](MERGE-LESSONS.zh-CN.md)

## 1. Incident review

After merging `v3.8.8` into `patch/custom` (merge commit `4528754bba`), the running app showed an **endless startup loading screen** on the main window (a "Click to Refresh" button after ~7 seconds, looping on click). The review confirmed a systematic conflict-resolution failure. Final tally:

- **25 lost upstream wirings across 8 frontend files** (8 in each desktop entry, 4 in `config/index.ts`, 3 in `appRuntime.ts`, 4 in `syncTab.ts`, 3 in `onMessage.ts`, 2 in `syncGuide.ts`, 6 in `mobile/index.ts`, plus the ~500-line third-party sync settings UI rewrite lost wholesale)
- **1 loss on the Go side** (a diagnostic log on the exit path in `conf.go`)
- **2 regression suites dropped along the way** (`syncUi.test.ts` fell from the upstream 527 lines to the old 139-line version; the `refreshUser` case in `cloud_account_auth_test.go`)

## 2. Root cause

Conflict resolution used a lazy "keep ours wholesale" strategy: to preserve the account-removal customization, every upstream addition inside the same conflict hunks — startup lifecycle wrappers, settings hot-sync, message cases, the third-party sync settings rewrite, mobile touch/layout enhancements — was discarded even though none of it related to the customization target.

The specific failure patterns:

1. **Wrong conflict-hunk granularity**: "remove the account logic" expanded into "remove everything upstream in this hunk"
2. **Compilation verified, wiring not**: modules still existed in the repo, but their call sites were gone ("a module existing ≠ a feature being wired")
3. **Test synchronization failed**: upstream's new/rewritten tests were dropped together with the sources, removing the last line of defense
4. **Unverified delegation**: conflict resolution was delegated to subagents without an independent semantic review; "zero conflict markers + clean compile" was trusted blindly

## 3. The correct conflict-resolution method

Handle every conflicted file as follows (validated during this fix):

1. **Measure both deltas first**: `git diff <merge-base> <ours> -- <file>` for the customization, `git diff <merge-base> <theirs> -- <file>` for upstream
2. **Judge each hunk semantically**: ask "is this upstream change related to the customization target?" — keep everything unrelated, delete or rewrite only what is related
3. **Small customization + large upstream rewrite**: take the upstream file wholesale (`git show <theirs>:<file> > <file>`) and re-apply the custom removals (used for AgentChat/topBar/breadcrumb/syncUi/mobile)
4. **Large customization + small upstream change**: keep our structure and graft each upstream addition in (used for the index/config entry files)
5. **Tests move with their source**: follow upstream for upstream-changed tests, drop the cases covering removed behavior — never keep an old test file wholesale
6. **Use the plan document as the semantic baseline**: what "should be deleted" is defined by `docs/CUSTOM-PATCH-PLAN.zh-CN.md`, not by what "looks account-related"

## 4. Mandatory post-merge checklist

Complete all of the following after every upstream merge, before committing:

### 4.1 Startup chain (highest priority — this caused a production incident)

- [ ] `app/src/index.ts` and `app/src/window/index.ts` wrap the boot flow with `initWindowWithLoading` (guarded by `app/src/boot/startupWiring.test.ts`)
- [ ] Both entries wire the `refreshSettingConfig` connect callback and the `settingChanged` message case
- [ ] The `closeBox`/`removeBox` cases call `closeNotebookLivePhotos`
- [ ] The main entry calls `exitAfterSettingsReset()` when ready
- [ ] The BROWSER branch registers `registerDesktopBackNavigation()`
- [ ] All three entries (index/window/mobile) call `installPluginStorageFetchAppId` with the new four-argument signature
- [ ] Mobile keeps `ensureLute` staged boot, touch/layout-save/URI-deeplink wiring

### 4.2 Feature comparison

- [ ] Run the three-way comparison from section 3 for every file (at least all conflicted files plus files both sides touched under auto-merge)
- [ ] Every upstream-added message case exists in the current code
- [ ] All call sites of upstream-refactored functions use the new signatures
- [ ] The custom-removal list is verified item by item: only plan-scope items (account/official cloud/updater) removed, no overreach

### 4.3 Verification

- [ ] `pnpm run lint` passes
- [ ] `python scripts/check-lang-keys.py` passes
- [ ] Guard tests and affected module tests pass
- [ ] For kernel changes: `go build -tags "fts5 sqlcipher" ./...` plus the relevant `go test`
- [ ] **Launch the real app and verify the startup screen, the settings page and the sync page**

## 5. New defenses added

- `app/src/boot/startupWiring.test.ts`: 8 source assertions guarding in both directions (upstream wiring not lost, account logic not reintroduced)
- This document as the per-merge checklist

## 6. Known intentional removals (do not "fix" these back)

The following removals are in scope for the custom edition — do not restore them during reviews:

- `RefreshRhyResultJob` in `kernel/util/rhy.go` (plan phase C: periodic background polling disabled; bazaar hash still resolves on demand)
- All `updater*.go` files (plan phase C)
- `refreshUser`/`refreshAnnouncement` and other official account/announcement refresh jobs (phases B/C)
- `getCloudUser`/`onSetaccount` calls at every entry point (phase B)
