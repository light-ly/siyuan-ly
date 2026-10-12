# v3.8.6 Custom Patch Implementation Plan

[简体中文](CUSTOM-PATCH-PLAN.zh-CN.md)

## 1. Goal and baseline

This plan is based on the `v3.8.6` tag and the `patch/v3.8.6-custom` branch. The target is a custom build that does not depend on SiYuan official accounts or official cloud services, supports user-owned synchronization backends, exposes local AI capabilities, disables update checks and unnecessary background network activity, and removes forced brand watermarks from exports.

The baseline commit is `158812497497c6fa8a6d1031bfa2f025a61ee5c2`. The workspace was clean when this plan was created. 2026-10-10 update: phases A, B, C and part of E have landed in commit `bcf8e5408a`, and this document now also covers the local Windows release-packaging environment; phases D and F are in progress and the phase G integration verification is pending.

## 2. Confirmed scope decisions

| Area | Decision |
|---|---|
| Official account | Completely hide account login, registration, password recovery, membership, purchase, activation-code and renewal entries; do not create, simulate or persist a fake account |
| Official cloud | Completely hide official cloud sync, official cloud space, official cloud backup, Inbox and other official-account-dependent entries; safely read existing configuration and data without deleting them automatically |
| Third-party sync | Support S3, WebDAV and local file-system synchronization; authorization is based on provider configuration and the local data-repository key, not official membership status |
| Local file-system sync | Keep it as an optional local-directory synchronization provider; it is not operating-system real-time folder mirroring |
| AI | Expose existing AI, Agent, Embedding, Rerank, MCP and skill entries; do not prefill API keys or automatically enable paid model calls |
| Export watermark | Remove forced product or brand additions; keep user-configured custom PDF and image watermark capabilities |
| Full-text asset search | Ensure asset indexing, search, rebuild and mobile entry points work; encrypted assets must not enter the global plaintext index |
| Updates and telemetry | Disable automatic updates, manual update checks, update-package downloads and unnecessary version-announcement requests; retain local version information, logs and local runtime statistics |

## 3. Meaning of local file-system synchronization

Local file-system synchronization uses the existing `ProviderLocal` value `4` and `Sync.Local.Endpoint` to write SiYuan data-repository snapshots and encrypted synchronization objects to another user-selected directory. It does not mirror the workspace directory in real time and does not directly keep two workspaces consistent by copying files.

The synchronized content still goes through the data-repository snapshot, encryption, indexing, conflict and recovery workflow. The target is a synchronization-repository directory rather than the current workspace `data/` directory; therefore the target must not be the workspace itself or a child directory of the workspace.

Local synchronization is suitable for a second backup directory on the same machine, an external disk, a NAS mount or an operating-system-provided network file-system path. If several devices access the same shared directory, the normal data-repository locking and concurrency rules still apply; it must not be treated as a lock-free multi-master synchronization service.

The difference from S3 and WebDAV is that S3 uses an object-storage protocol, WebDAV uses a remote file protocol, and the local provider accesses a local or mounted file-system path directly. All three use SiYuan's data-repository synchronization model rather than synchronizing raw workspace files.

Local file-system synchronization does not need an official account, official membership status or official cloud service. It still requires an initialized local data-repository key and remains subject to read-only checks, encrypted-notebook isolation, synchronization locks and asset-integrity checks.

## 4. Implementation phases

### Phase A: Capability boundaries and configuration model

1. Separate official, third-party and local providers in the kernel; do not return true globally from `IsSubscriber()` or use a simulated user object to bypass permissions.
2. Remove official-account and membership checks independently from S3, WebDAV and Local synchronization, snapshots, backups, history and on-demand asset downloads while retaining repository keys, locks, conflict detection, integrity checks and read-only checks.
3. For existing `ProviderSiYuan` configurations, stop official-cloud synchronization safely while retaining the old configuration, official-cloud credentials, repository key and local snapshots. The user must explicitly select S3, WebDAV or Local before enabling synchronization.
4. Do not automatically copy official-cloud snapshots to a third-party target. Provide an explicit export, import or recovery path when migration is required.
5. Add kernel regressions for account-free synchronization, authentication failures, restart, on-demand assets, conflicts and recovery.

Main source areas: `kernel/model/sync.go`, `kernel/model/repository.go`, `kernel/model/asset_download.go`, `kernel/model/cloud_account_auth.go`, `kernel/conf/sync.go`, `app/src/config/tabs/syncUi.ts`, `app/src/config/tabs/syncTab.ts`, `app/src/util/needSubscribe.ts` and `app/src/sync/syncGuide.ts`.

### Phase B: Remove official cloud and account entries

1. Remove the official provider, official cloud space, official cloud backup, cloud-directory management and account settings group from synchronization settings. Keep S3, WebDAV, Local, the local repository and generic synchronization options.
2. Remove the top-bar membership indicator, account navigation, official login, registration, password recovery, membership status, purchase, activation-code, renewal and account-deactivation entries.
3. Remove official-login prompts and buttons from onboarding and empty states.
4. Disable official-account-dependent Inbox, cloud-space statistics, cloud-traffic and official-cloud entries without destructively deleting existing local Inbox data.
5. Keep workspace lock-screen passwords, publish-access accounts, API tokens, OIDC and administrator roles. These are local or deployment security controls, not SiYuan official-account login.
6. If configurable menu, dock or toolbar entries are removed or hidden, update `app/src/config/entryVisibility/catalog.ts` and the related tests while preserving old-profile migration.

Main source areas: `app/src/config/tabs/accountUi.ts`, `app/src/config/tabs/syncTab.ts`, `app/src/config/setting/tabs.ts`, `app/src/layout/topBar.ts`, `app/src/onboarding/`, `app/src/util/needSubscribe.ts`, `app/src/config/entryVisibility/`, related mobile menus and side panels, and official-account-related kernel API/model entry points.

### Phase C: Disable update checks and unnecessary background network activity

1. Disable startup, scheduled and manual update checks.
2. Disable automatic update-package downloads, package-install prompts and update-channel settings.
3. Disable background requests used only for official announcements, official version metadata or official-account refresh when those services are no longer part of the build.
4. Keep the local About page's current version, runtime information, changelog and local-log views. Do not confuse local statistics, disk-space checks or PDF.js's empty telemetry hook with telemetry reporting.
5. Add request interception or mock-based verification to ensure startup, idle, wake and manual actions do not access official update or telemetry endpoints.

Main source areas: `kernel/job/cron.go`, `kernel/util/rhy.go`, `kernel/model/updater.go`, `kernel/model/updater_release.go`, `kernel/model/cloud_service.go`, `kernel/api/system.go`, `app/src/config/tabs/aboutTab.ts` and `app/electron/`.

### Phase D: Expose and organize AI capabilities

1. Keep the `disabledFeatures` mechanism itself unchanged; do not pass `ai` as a default disabled feature in the custom desktop or mobile startup configuration.
2. Check AI settings, editor selection menus, block menus, slash menus, command palette, dock, mobile bottom bar, mobile side panel and shortcuts for consistent entry availability.
3. When no provider or model is configured, show a clear configuration path instead of failing silently. The path should point to `Settings - Artificial Intelligence - API Providers` or the relevant group.
4. Expose Agent, workspace skills, external skills, MCP, Embedding, Rerank and image-generation entries while retaining approvals, permissions, timeouts, cancellation, read-only restrictions and encrypted-notebook isolation.
5. Do not write API keys automatically, enable full-workspace Embedding automatically, or enable remote MCP or paid model calls automatically.
6. Verify desktop and mobile entries separately. If a native mobile container still passes `disabledFeatures`, update the corresponding mobile project rather than changing only the web frontend.

Main source areas: `app/src/config/tabs/ai/`, `app/src/ai/`, `app/src/layout/dock/agent/`, `app/src/protyle/toolbar/`, `app/src/protyle/gutter/`, `app/src/mobile/agent/`, `app/src/mobile/util/`, `kernel/model/ai.go`, `kernel/model/embedding.go`, `kernel/agent/` and `kernel/mcp/`.

### Phase E: Remove forced export branding while keeping custom watermarks

1. Ensure PDF, image, HTML, Word and Markdown exports do not automatically add a SiYuan brand watermark or any other forced watermark.
2. Keep `export.pdfWatermarkStr`, `export.pdfWatermarkDesc`, `export.imageWatermarkStr` and `export.imageWatermarkDesc` as user-controlled custom watermark settings.
3. Keep the per-export PDF and image watermark controls when the user explicitly enables them.
4. Add export regressions: default PDF and image exports contain no forced branding; explicitly configured custom watermarks still work; existing settings are not silently cleared.

Main source areas: `kernel/model/export.go`, `kernel/apicontract/export.go`, `app/src/config/tabs/exportTab.ts`, `app/src/protyle/export/index.ts`, `app/src/protyle/export/util.ts` and related export tests.

### Phase F: Enable full-text asset search

1. Verify parsers and indexing queues for text, code, DOCX, PPTX, XLSX, PDF and EPUB on startup, incremental changes, deletion and synchronized asset downloads.
2. Ensure the asset-index setting and asset-content search entry are visible and reachable on desktop and mobile.
3. Keep the asynchronous content database queue, rebuild action and failure recovery; provide understandable behavior for oversized files, parse failures and on-demand assets that are not downloaded locally.
4. Continue skipping encrypted-notebook assets from the global plaintext content index.
5. Verify `indexAssetPath` separately from the asset-body full-text index.

Main source areas: `kernel/model/asset_content.go`, `kernel/model/assets.go`, `kernel/sql/asset_content.go`, `kernel/sql/database.go`, `kernel/api/search.go`, `kernel/api/asset.go`, `app/src/search/`, `app/src/config/tabs/searchTab.ts`, mobile search entries and related tests.

### Phase G: Integration verification and release checks

1. Verify normal notebooks, encrypted notebooks, existing configurations, empty workspaces, read-only workspaces, remote kernels and publish mode.
2. Verify first synchronization, restart, offline recovery, conflicts, history, backups, on-demand assets and recovery for S3, WebDAV and Local.
3. Verify that no settings, top-bar, menu, dock, onboarding or mobile entry requests an official account.
4. Verify that startup and scheduled execution do not trigger official updates, announcements, account refreshes or telemetry.
5. Verify AI entries, missing-model guidance, cancellation, tool confirmation, permission denial and mobile access.
6. Verify exports have no forced branding, custom watermarks still work, asset full-text search works and encrypted assets are not exposed.
7. Run `pnpm run lint`, frontend tests, API contract checks, language-key checks and relevant Go tests; run `gofmt` after Go source changes.

## 5. Dependencies

| Prerequisite | Following phase | Reason |
|---|---|---|
| Phase A | Phase B | Define official and third-party capability boundaries before hiding entries |
| Phase A | Phase C | Identify remaining official services before disabling background requests |
| Phase A | Phase D | AI must be exposed through local capability configuration, not membership simulation |
| Phase A | Phase E | Export behavior and watermark defaults are independent of account removal |
| Phase A | Phase F | Asset indexing must preserve encryption and on-demand boundaries |
| Phases B-F | Phase G | Integration verification requires all capability and entry changes |

## 6. Environment preparation required from you

### Required tools

| Tool | Requirement | Notes |
|---|---|---|
| Git | Available and able to switch branches | The patch branch already exists; no reclone is required |
| Node.js | 24.x | Matches the CI and project development configuration; this machine uses nvm with v24.21.0 |
| npm | Comes with Node.js | This machine has npm 11.19.0, used to install the required pnpm package |
| pnpm | `12.6.0` | Use the `packageManager` field in `app/package.json`; do not use Corepack or standalone `@pnpm/exe` |
| Go | `1.26.5` or a version satisfying `kernel/go.mod` | Installed at `~/sdk/go1.26.5`; `go.mod` declares `go 1.26.5` |
| C compiler | System gcc | This machine has gcc 11.5.0; Go CGO is enabled by default here, so no extra CC/CXX setting is needed |
| Python | 3.11 recommended | Use Conda environment `siyuan-ly-env` with Python 3.11.17 |

### Linux environment variables and PATH

1. The OS is Ubuntu, Linux x86_64; the system gcc is 11.5.0 and Go CGO is enabled by default on this machine (`go env CGO_ENABLED` returns `1`), so `CC`, `CXX` and `CGO_ENABLED` do not need to be set.
2. Node.js `v24.21.0` is installed through nvm at `~/.nvm` and is already present on this machine; each new shell switches to Node 24 with `source ~/.nvm/nvm.sh && nvm use 24`.
3. npm is `11.19.0`, and pnpm `12.6.0` is installed globally under that Node, matching the `packageManager` field in `app/package.json`; do not use Corepack or standalone `@pnpm/exe`.
4. Go `1.26.5` is installed at `~/sdk/go1.26.5` as a user-local install without sudo; because go.dev was unreachable directly, the toolchain itself was downloaded from the golang.google.cn mirror. Use it per process with `export PATH="$HOME/sdk/go1.26.5/bin:$PATH"`.
5. Repository-local caches: `GOCACHE=$PWD/.go-cache` and `GOTMPDIR=$PWD/.go-tmp`; both directories are listed in `.git/info/exclude`.
6. Python uses the Conda environment `siyuan-ly-env`, Python `3.11.17`, with the interpreter at `/home/lfx/miniconda3/envs/siyuan-ly-env/bin/python`; always use this absolute path for `scripts/check-lang-keys.py` and similar scripts.
7. Network: the npm registry `https://registry.npmjs.org/` is reachable directly; the default Go module proxy `proxy.golang.org` repeatedly times out on this machine, so set `GOPROXY=https://goproxy.cn,direct` at the command level for Go builds and tests (only needed for the first module download). Only the Go toolchain itself needed the golang.google.cn mirror. No proxy is configured on this machine, so do not write proxy settings into repository files.
8. This machine is a headless server, so Electron UI tests and any browser/Electron UI verification need a display (for example xvfb) or must be done by the developer on a machine with a GUI.

### Using this machine's environment

These commands affect only the current shell. They do not change the user or system PATH or install project dependencies.

```bash
source ~/.nvm/nvm.sh && nvm use 24;
node --version;
npm --version;
pnpm --version;
export PATH="$HOME/sdk/go1.26.5/bin:$PATH";
go version;
```

For Python, each agent shell invocation is a fresh process, so use the absolute interpreter path below rather than relying on an earlier `conda activate` state.

```bash
~/miniconda3/envs/siyuan-ly-env/bin/python --version;
# Run from the repository root after explicit implementation authorization and language changes
~/miniconda3/envs/siyuan-ly-env/bin/python scripts/check-lang-keys.py;
```

Go CGO is available by default on this machine and the system gcc is enough for CGO compilation, so `CGO_ENABLED`, `CC` and `CXX` do not need to be set; use the repository-local caches below when running Go tests.

```bash
export PATH="$HOME/sdk/go1.26.5/bin:$PATH";
export GOCACHE="$PWD/.go-cache";
export GOTMPDIR="$PWD/.go-tmp";
go env CGO_ENABLED;
```

### Network

The npm registry `https://registry.npmjs.org/` is reachable directly; the default Go module proxy `proxy.golang.org` repeatedly times out on this machine, so set `GOPROXY=https://goproxy.cn,direct` at the command level for Go builds and tests (only needed for the first module download). Only downloading the Go toolchain itself needed the golang.google.cn mirror. No proxy is configured on this machine, so do not write proxy credentials or machine-local proxy configuration into repository files.

### Frontend dependencies

1. From `app/`, run `pnpm install --frozen-lockfile --store-dir ../.pnpm-store-temp`; that store directory is listed in `.git/info/exclude` and project configuration is not changed.
2. From `app/`, run `pnpm run install:electron` to download the Linux Electron binary.
3. Confirm that `app/node_modules` exists and that the Electron binary has been downloaded.
4. Do not use `pnpm build` as the task verification command; use `pnpm run lint` for frontend checks.

### Kernel development and runtime

1. Go CGO is enabled by default on this machine and the system gcc can complete CGO compilation, so no extra toolchain setup is needed.
2. Build the kernel with the `fts5 sqlcipher` tags following `.github/CONTRIBUTING.zh-CN.md`, then start the kernel manually.
3. The agent will not compile the full kernel binary or restart a running kernel as part of this task; the developer does that manually.
4. Prepare a dedicated test workspace rather than using production data; back up `conf/`, `data/`, `repo/` and `history/` first.

### Synchronization test services

| Scenario | Preparation |
|---|---|
| S3 | A dedicated S3-compatible service or local MinIO with an isolated bucket, Access Key, Secret Key, Region and Endpoint |
| WebDAV | A dedicated WebDAV service or test container with an isolated user, password and Endpoint; HTTPS is preferred |
| Local | An empty directory outside the SiYuan workspace, such as `/home/lfx/siyuan-sync-test`; never use the workspace, its parent or a child directory |
| Multi-workspace simulation | Two independent test workspaces sharing one repository key and test target; do not perform concurrent writes to the same target without testing the lock behavior intentionally |
| Offline and conflict tests | A controllable network environment and two workspaces making different edits to the same document |
| On-demand assets | A test workspace containing images, PDFs, videos and file assets, covering downloaded and not-downloaded states |

### AI test services

1. Prepare at least one OpenAI-compatible test provider and model; keep API keys in local configuration and never commit them.
2. For Embedding tests, prepare an Embedding model and a separate API key, and ensure the service dimension matches the configuration.
3. For Rerank tests, prepare a Cohere- or DashScope-compatible test service.
4. For MCP tests, prepare a local stdio MCP or controlled HTTP MCP service with no sensitive data and minimum permissions.
5. For skill tests, use a dedicated test skill directory and never use production scripts or secrets.

### Optional verification environment

1. If API declaration synchronization is required, place a `petal` checkout next to this repository; `../petal` does not currently exist, and it is not needed to create this plan.
2. For browser verification, use `/stage/build/desktop/` rather than the root path; `app/stage/build/` does not currently exist.
3. To verify the absence of updates and telemetry, use `tcpdump`, mitmproxy or a local HTTP mock to record outbound requests; never put production API keys into a capture environment.
4. For the full Go suite, allow sufficient disk space and time; use the `fts5 sqlcipher` tags and never connect tests to production synchronization services.

### Windows release packaging environment (this machine)

Package the custom Windows installer with the repository's own local script `scripts/win-build.bat`; the official release orchestration script `scripts/build-release.py` is not required (it enforces YubiKey code signing and a fixed ARM64 compiler path, and suits only the official release machine).

**Required tools**

| Tool | Requirement | Notes and this machine |
|---|---|---|
| Git | Any recent version | Installed: 2.55.0 |
| Node.js | 24.x | Matches CI; installed: v24.18.1 |
| pnpm | `12.6.0` | Follow the `packageManager` field in `app/package.json`; do not use Corepack or standalone `@pnpm/exe`; installed: 12.6.0 |
| Go | `1.26.5` | Declared by `kernel/go.mod`; installed: go1.26.5 windows/amd64 |
| gcc or clang (MinGW toolchain) | Any recent version | Required for CGO sqlite/sqlcipher; this machine has the MSYS2 clang64 toolchain (clang 22.1.8, target `x86_64-w64-windows-gnu`, with the lld linker) at `C:\msys64\clang64\bin`; because that directory is not on PATH and no system gcc exists, Go defaults to `CGO_ENABLED=0` — set `CC=/c/msys64/clang64/bin/cc.exe` and `CGO_ENABLED=1` at the command level for kernel builds and tests, or add that `bin` directory to the system PATH; CGO probe passed on 2026-10-12 |
| Python | 3.11 or later | Only needed for `scripts/build-release.py`; not needed for the recommended path; installed: 3.14.7 |

On Windows, sqlcipher does not require a separate OpenSSL installation: the go-sqlite3 replacement in `kernel/go.mod` bundles SQLCipher with libtomcrypt, so kernel compilation only needs `CGO_ENABLED=1` and a working MinGW gcc. Packaging an ARM64 installer additionally requires the `aarch64-w64-mingw32-gcc.exe` from llvm-mingw; its default path can be changed in `scripts/win-build.bat`.

**Packaging steps (AMD64)**

Run from the repository root:

```bat
scripts\win-build.bat --target=amd64
```

The script performs, in order: deleting stale `app/build` and `app/kernel*`; from `app/`: `pnpm install`, `pnpm run install:electron`, `pnpm run build` (the four webpack production builds); installing goversioninfo and generating the Windows version resource; from `kernel/`: `go build -tags "fts5 sqlcipher"` producing `app\kernel\SiYuan-Kernel.exe`; copying `app\elevator\elevator-amd64.exe` to `app\kernel\elevator.exe`; from `app/`: `pnpm run dist` (electron-builder producing the NSIS installer).

The artifact is `app\build\siyuan-<version>-win.exe`, unpacked at `app\build\win-unpacked`; for ARM64 use `--target=arm64`, producing `siyuan-<version>-win-arm64.exe`.

**Notes**

1. Since Electron 42, `pnpm install` no longer downloads the Electron binary automatically; `pnpm run install:electron` is mandatory. When downloads are slow, set `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` first.
2. Before packaging, confirm that `Ver` in `kernel/util/working.go` matches the `version` in `app/package.json` and that `Mode` is `prod`; a stable release also requires the `app/changelogs/v<version>/` directory.
3. Do not place `siyuan.exe` into `app/kernel/` before running electron-builder; the NSIS installer creates the hard link at install time.
4. `pnpm run dist` does not enforce code signing; to sign, set the electron-builder `CSC_LINK` and `CSC_KEY_PASSWORD` environment variables.
5. The installer refuses Windows versions below Windows 10 and refuses to install into a directory that already contains a `data` workspace.
6. Consistent with AGENTS.md: use `pnpm run lint` for routine change verification; `win-build.bat` runs `pnpm run build` internally, which conflicts with a manually running `pnpm dev`, so run them at separate times.

## 7. Environment status, baseline verification and implementation gate

The user authorized environment preparation and baseline testing, but not the six feature changes. Node.js `v24.21.0`, pnpm `12.6.0`, Go `1.26.5` and Conda Python `3.11.17` are confirmed available on this Linux machine.

### Executed results

| Check | Command or method | Result |
|---|---|---|
| Frontend dependencies | From `app/`: `pnpm install --frozen-lockfile --store-dir ../.pnpm-store-temp` | Passed: 574 packages installed, lockfile unchanged |
| Electron | From `app/`: `pnpm run install:electron` | Passed: downloaded the Linux Electron 44.4.5 binary; `app/node_modules/electron/dist/electron` exists; this does not count as a UI test pass |
| Frontend lint and typecheck | From `app/`: `pnpm run lint` | Passed: both TypeScript configs and ESLint, no tracked source changes |
| Full frontend tests | From `app/`: `xvfb-run -a pnpm test` (xvfb provides a virtual display; chrome-sandbox has been fixed to root:root 4755) | Passed: 3368 passed, 0 failed, 7 skipped (the skips are environment limits declared by the tests themselves); before the fix, 50 Electron integration tests failed for environmental reasons in the display-less environment, unrelated to assertions |
| API contract declaration check | From `app/`: `pnpm run api:check` with `GOPROXY=https://goproxy.cn,direct` at the command level | Passed: 697 typed method/path pairs checked; the default `proxy.golang.org` timed out, there was no CGO-related failure; `api:generate` was not run and no external Petal declarations were synced |
| Go formatting | From `kernel/`: `gofmt -l .` | No output, no Go files need formatting; `gofmt -w` was not run |
| CGO probe | A temporary Go program calling trivial C functions (`C.add` and `C.strlen`) | Passed: the system gcc compiles and runs CGO directly on Linux; the temporary directory was removed |
| Pure-Go API contract tests | From `kernel/`: `go test ./apicontract/...` with `GOPROXY=https://goproxy.cn,direct` at the command level | Passed: the first attempt failed only on module-download timeouts and passed on retry via the mirror; the failure was unrelated to code |
| Sync and asset Go baseline | From `kernel/`: `go test -tags 'fts5 sqlcipher' ./model ./api -run 'Test(CheckSync\|SyncProvider\|AssetDownload\|APIContractSync)' -count=1` with `GOPROXY=https://goproxy.cn,direct` at the command level | Passed: `model` and `api` compiled under the fts5 sqlcipher tags, 20 top-level tests and 9 subtests passed with 0 failures; missing-cloud-object log lines during sync tests are expected negative paths |
| Language packs | From the repository root: `~/miniconda3/envs/siyuan-ly-env/bin/python scripts/check-lang-keys.py` | Passed: 22 language files and 2999 expected keys, 0 unexpected keys, with complete keys and compatible Go placeholders |
| Windows CGO toolchain | On the Windows machine, compile and run a temporary cgo program with `CC=/c/msys64/clang64/bin/cc.exe CGO_ENABLED=1` at the command level | Passed (2026-10-12); MSYS2 clang64 (clang 22.1.8, target `x86_64-w64-windows-gnu`, with lld), usable for kernel tests and packaging |
| Asset-index Go regressions | From `kernel/`: `go test -tags "fts5 sqlcipher" ./sql -run TestFlushAssetContentQueue -count=1` and `go test -tags "fts5 sqlcipher" ./model -run TestEncryptedAssetPathsSkipPlaintextContentIndex -count=1`, with `CC`/`CGO_ENABLED`/`GOPROXY=https://goproxy.cn,direct` set at the command level | Passed (2026-10-12); a failed queue operation publishes the rebuild event, a commit failure does not, and encrypted assets stay out of the plaintext index on incremental index, delete and full reindex |
| AI-disabled regressions | From `kernel/`: `go test -tags "fts5 sqlcipher" ./api -run TestAPIContractAIDisabled -count=1`, `./model -run TestAIDisabledBackgroundFeatures -count=1` and `./mcp/client -run TestAIDisabledMCPConnections -count=1` | Passed (2026-10-12); with `ai` explicitly disabled, the API contract, background features and MCP connections correctly fail |

### Local caches and access

There are three repository-local cache directories: `.pnpm-store-temp` (frontend dependency store), `.go-cache` (Go build cache) and `.go-tmp` (Go temporary directory). All three are listed only in `.git/info/exclude`, not the shared `.gitignore`, and must not be committed.

### Remaining environment issues

1. This machine is a headless server; xvfb is installed and chrome-sandbox has been fixed to root:root 4755. Under `xvfb-run -a pnpm test` the full frontend suite reports 3368 passed, 0 failed and 7 skipped, so UI tests now pass in full on this machine. Note that rerunning `pnpm install` or updating Electron resets the chrome-sandbox permissions and the fix must be applied again.
2. `app/stage/build` has not been generated, no kernel binary has been compiled, and no running kernel has been restarted.
3. The sibling `../petal` workspace is not prepared, so `api:check` does not verify external Petal declaration synchronization.

When this plan was created, no functional source, lockfile or generated declaration had changed, and no commit or push had been performed. 2026-10-10 update: the implementation gate has passed — phases A, B, C and part of E landed in commit `bcf8e5408a`. 2026-10-12 update: phases D (editor AI unconfigured guidance) and F (full-text asset-search regressions) are implemented, the MSYS2 clang64 toolchain is installed on the Windows machine, and the kernel-side regression verification has passed (see the table above); Go tests on this machine require `CC`/`CGO_ENABLED` at the command level. The phase G integration verification is still pending.

## 8. Completion criteria

The custom build is complete only when official account and official-cloud entries are absent, no simulated account is used, S3/WebDAV/Local synchronize without an official account, update and unnecessary background network activity are disabled, AI entries are configurable, default exports have no forced branding while custom watermarks remain available, full-text asset search works, encrypted-data compatibility and isolation remain intact, and the relevant frontend, kernel, API, language and cross-platform tests pass.
