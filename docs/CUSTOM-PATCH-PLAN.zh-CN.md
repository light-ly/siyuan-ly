# v3.8.6 定制 Patch 实施计划

[English](CUSTOM-PATCH-PLAN.md)

## 1. 目标与基线

本计划基于 `v3.8.6` 标签和分支 `patch/v3.8.6-custom`，目标是构建一个不依赖思源官方账号和官方云服务、支持自有同步后端、开放本地 AI 能力、关闭更新检查与不必要后台外联、取消品牌附加水印的定制版本。

当前基线提交为 `158812497497c6fa8a6d1031bfa2f025a61ee5c2`，计划创建时工作区干净。2026-10-10 更新：阶段 A、B、C 及部分 E 已以提交 `bcf8e5408a` 落地，本文档相应补充了 Windows 打包 release 环境；阶段 D、F 的实施与阶段 G 整体验证仍在进行。

## 2. 已确认的范围决策

| 事项 | 决策 |
|---|---|
| 官方账号 | 完全隐藏账号登录、注册、找回密码、会员、购买、激活码和续费入口；不生成、不模拟、不持久化虚假账号 |
| 官方云服务 | 完全隐藏官方云同步、官方云空间、官方云备份、收集箱及依赖官方账号的入口；旧配置和旧数据读取必须保持安全，不自动删除 |
| 第三方同步 | 支持 S3、WebDAV 和本地文件系统同步；同步权限由提供商配置和本地数据仓库密钥决定，不由官方会员状态决定 |
| 本地文件系统同步 | 保留并明确为可选的本地目录同步，不等同于操作系统实时文件夹同步 |
| AI | 开放已有 AI、Agent、Embedding、Rerank、MCP 和技能入口；不预填 API Key，不自动启用有外部费用的模型调用 |
| 导出水印 | 取消品牌或产品强制附加；保留用户主动配置的自定义 PDF 和图片水印能力 |
| 资源全文搜索 | 开放并确保资源内容索引、搜索入口、重建索引和移动端入口可用；加密资源不得进入全局明文索引 |
| 更新和遥测 | 关闭自动更新、手动更新检查、更新包下载和不必要的版本公告外联；保留本地版本信息、日志和本地运行统计 |

## 3. 本地文件系统同步的含义

本地文件系统同步使用现有 `ProviderLocal`（值为 `4`）和 `Sync.Local.Endpoint` 配置，将思源的数据仓库快照及加密同步对象写入用户指定的另一个目录；它不是把工作区目录实时镜像到目标目录，也不是把两个工作区直接用文件复制保持双向一致。

同步内容仍经过数据仓库的快照、加密、索引、冲突和恢复流程，目标目录是同步仓库目录而不是当前工作区的 `data/` 目录；因此不得把目标目录设置为当前工作区或其子目录。

本地文件系统同步适合以下场景：同一台机器上的第二个备份目录、外接磁盘、NAS 挂载目录或由操作系统提供的网络文件系统目录；如果多个设备通过同一个共享目录访问，仍必须遵守同一数据仓库的并发和锁定要求，不应把它当作无锁多主同步服务。

本地文件系统同步与 S3、WebDAV 的区别是：S3 使用对象存储协议，WebDAV 使用远程文件协议，本地提供商直接访问本机或已挂载文件系统路径；三者都使用思源的数据仓库同步模型，而不是同步原始工作区文件。

本地文件系统同步不需要官方账号、官方会员状态或官方云端服务，但仍需要初始化本地数据仓库密钥，并且仍受工作区只读、加密笔记本、同步锁和资源完整性保护。

## 4. 实施阶段

### 阶段 A：能力边界和配置模型

1. 将官方云提供商、第三方提供商和本地提供商在内核中明确分组，避免使用全局 `IsSubscriber()` 返回真或模拟用户对象绕过权限。
2. 对 S3、WebDAV 和 Local 的同步、快照、备份、历史、按需资源下载路径分别解除官方账号和会员检查，同时保留数据仓库密钥、同步锁、冲突检测、资源完整性和只读检查。
3. 对已有 `ProviderSiYuan` 配置执行安全迁移策略：停止官方云同步并保留原配置数据，不自动删除官方云凭据、数据仓库密钥或本地快照；用户需要显式选择 S3、WebDAV 或 Local 后再启用同步。
4. 不把官方云快照自动复制到第三方位置；如需要迁移，提供明确的导出、导入或恢复步骤，避免在未知云端状态下覆盖数据。
5. 为免账号同步、认证失败、重启、资源按需下载、冲突和恢复增加内核回归测试。

主要源码范围：`kernel/model/sync.go`、`kernel/model/repository.go`、`kernel/model/asset_download.go`、`kernel/model/cloud_account_auth.go`、`kernel/conf/sync.go`、`app/src/config/tabs/syncUi.ts`、`app/src/config/tabs/syncTab.ts`、`app/src/util/needSubscribe.ts`、`app/src/sync/syncGuide.ts`。

### 阶段 B：完全移除官方云和账号入口

1. 从同步设置中移除官方云提供商、官方云空间、官方云备份、云端目录管理和账号设置组，只保留 S3、WebDAV、本地文件系统、本地数据仓库和同步通用选项。
2. 移除顶栏会员标识、账号点击跳转、账号与同步中的官方登录入口、登录注册找回密码、会员状态、购买、激活码、续费和注销入口。
3. 移除新手引导和空状态中要求官方登录的文案和按钮。
4. 关闭依赖官方账号的收集箱、官方云空间统计、官方云流量和官方云服务入口；对已有本地收集箱数据不做破坏性删除。
5. 保留工作区锁屏密码、发布访问账号、API Token、OIDC 和管理员角色。这些是本地或部署安全机制，不属于思源官方账号登录。
6. 如果删除或隐藏可配置菜单、Dock 或工具栏项，同步维护 `app/src/config/entryVisibility/catalog.ts` 及相关测试，保留旧配置迁移能力。

主要源码范围：`app/src/config/tabs/accountUi.ts`、`app/src/config/tabs/syncTab.ts`、`app/src/config/setting/tabs.ts`、`app/src/layout/topBar.ts`、`app/src/onboarding/`、`app/src/util/needSubscribe.ts`、`app/src/config/entryVisibility/`、相关移动端菜单和侧栏模块，以及官方账号相关的 `kernel/api` 和 `kernel/model` 调用入口。

### 阶段 C：关闭更新检查和不必要后台外联

1. 关闭启动时、定时任务和手动按钮触发的更新检查。
2. 关闭更新包自动下载、安装包校验后的安装提示和更新通道设置。
3. 关闭只用于官方公告、官方版本信息或官方账号刷新且不再需要的后台请求。
4. 保留本地 About 页面中的当前版本、运行时信息、变更日志和本地日志查看；不得把本地运行统计、磁盘空间检查或 PDF.js 空遥测接口误删为遥测上报。
5. 对网络请求做测试或请求拦截验证，确保启动、空闲、唤醒和手动操作不会访问官方更新与遥测端点。

主要源码范围：`kernel/job/cron.go`、`kernel/util/rhy.go`、`kernel/model/updater.go`、`kernel/model/updater_release.go`、`kernel/model/cloud_service.go`、`kernel/api/system.go`、`app/src/config/tabs/aboutTab.ts`、`app/electron/`。

### 阶段 D：开放和梳理 AI 功能

1. 保持 `disabledFeatures` 机制本身不变，只在定制桌面或移动启动配置中不再默认禁用 `ai`。
2. 检查 AI 设置、编辑器选区菜单、块菜单、斜杠菜单、命令面板、Dock、移动底栏、移动侧栏和快捷键的入口一致性。
3. 未配置提供商或模型时，入口应显示明确的配置引导，而不是静默失败；引导指向 `设置 - 人工智能 - API 提供商` 或对应功能分组。
4. 开放 Agent、工作区技能、外部技能、MCP、Embedding、Rerank 和图片生成入口，但保留工具审批、权限、超时、取消、只读和加密笔记本隔离。
5. 不自动写入 API Key，不自动打开 Embedding 全库索引，不自动启用远程 MCP 或有费用的模型调用。
6. 桌面端和移动端分别验证入口；如果原生移动容器仍传入 `disabledFeatures`，需要在对应移动工程同步调整，不能只改网页前端。

主要源码范围：`app/src/config/tabs/ai/`、`app/src/ai/`、`app/src/layout/dock/agent/`、`app/src/protyle/toolbar/`、`app/src/protyle/gutter/`、`app/src/mobile/agent/`、`app/src/mobile/util/`、`kernel/model/ai.go`、`kernel/model/embedding.go`、`kernel/agent/`、`kernel/mcp/`。

### 阶段 E：导出取消品牌附加并保留自定义水印

1. 明确 PDF、图片、HTML、Word 和 Markdown 导出不自动添加思源品牌水印或其他强制水印。
2. 保留 `export.pdfWatermarkStr`、`export.pdfWatermarkDesc`、`export.imageWatermarkStr` 和 `export.imageWatermarkDesc` 作为用户主动配置的自定义水印设置。
3. 保留用户在单次 PDF 或图片导出对话框中主动勾选水印的行为。
4. 增加导出回归检查：默认配置导出的 PDF 和图片不包含品牌附加；显式配置自定义水印时仍然生成；已有配置不得被静默清空。

主要源码范围：`kernel/model/export.go`、`kernel/apicontract/export.go`、`app/src/config/tabs/exportTab.ts`、`app/src/protyle/export/index.ts`、`app/src/protyle/export/util.ts`、相关导出测试。

### 阶段 F：启用资源全文搜索

1. 确认文本、代码、DOCX、PPTX、XLSX、PDF 和 EPUB 的解析器与索引队列在启动、增量修改、删除和同步下载后正常工作。
2. 确认设置 - 搜索中的资源索引与搜索资源内容入口可见，资源搜索对桌面端和移动端均可到达。
3. 保留资源内容数据库的异步队列、重建索引入口和失败恢复；对超大文件、解析失败和按需未下载资源给出可理解的结果。
4. 加密笔记本资源继续跳过全局明文资源内容索引，不得为了开放搜索而突破加密边界。
5. 资源路径索引 `indexAssetPath` 与资源正文全文索引分别验证，避免把两个开关混为一谈。

主要源码范围：`kernel/model/asset_content.go`、`kernel/model/assets.go`、`kernel/sql/asset_content.go`、`kernel/sql/database.go`、`kernel/api/search.go`、`kernel/api/asset.go`、`app/src/search/`、`app/src/config/tabs/searchTab.ts`、移动端搜索入口及相关测试。

### 阶段 G：整体验证和发布前检查

1. 验证普通笔记本、加密笔记本、已有旧配置、空工作区、只读工作区、远程内核和发布模式。
2. 验证 S3、WebDAV、Local 三种同步提供商的首次同步、重启、断网、冲突、历史、备份、按需资源和恢复。
3. 验证完全无官方账号时，任何设置、顶栏、菜单、Dock、引导和移动入口都不会要求登录官方账号。
4. 验证启动及定时运行不会触发官方更新、公告、账号刷新和遥测请求。
5. 验证 AI 入口、模型未配置、请求取消、工具确认、权限拒绝和移动端入口。
6. 验证导出默认无品牌附加、自定义水印可用、资源全文搜索可用且加密资源不泄漏。
7. 执行前端 `pnpm run lint`、前端测试、API 契约检查、语言键检查以及相关 Go 测试；Go 源码修改后先运行 `gofmt`。

## 5. 依赖关系

| 前置阶段 | 后续阶段 | 依赖原因 |
|---|---|---|
| 阶段 A | 阶段 B | 先确定官方云与第三方同步的能力边界，再安全隐藏入口 |
| 阶段 A | 阶段 C | 更新和账号后台请求需要明确哪些官方服务仍被保留 |
| 阶段 A | 阶段 D | AI 不能通过会员模拟开放，必须先确定干净的本地能力策略 |
| 阶段 A | 阶段 E | 导出权限和默认值应与账号移除策略解耦 |
| 阶段 A | 阶段 F | 资源索引不能绕过加密和按需资源边界 |
| 阶段 B 至 F | 阶段 G | 整体验证需要所有入口和后端能力完成后进行 |

## 6. 你需要准备的开发环境

### 必需工具

| 工具 | 要求 | 说明 |
|---|---|---|
| Git | 可用并能切换分支 | 当前分支已经创建，不需要重新克隆 |
| Node.js | 24.x | 与 CI 和项目开发配置一致；本机通过 nvm 安装 v24.21.0 |
| npm | 随 Node.js 安装 | 本机为 npm 11.19.0，用于安装项目要求的 pnpm |
| pnpm | `12.6.0` | 以 `app/package.json` 的 `packageManager` 字段为准，不要使用 Corepack 或独立 `@pnpm/exe` |
| Go | `1.26.5` 或满足 `kernel/go.mod` 的版本 | 本机安装在 `~/sdk/go1.26.5`，项目 `go.mod` 声明为 `go 1.26.5` |
| C 编译器 | 系统 gcc | 本机为 gcc 11.5.0；Go CGO 在本机默认启用，无需额外设置 CC/CXX |
| Python | 3.11 建议版本 | 使用 Conda 环境 `siyuan-ly-env` 的 Python 3.11.17 |

### Linux 环境变量和 PATH

1. 操作系统为 Ubuntu，Linux x86_64；系统 gcc 为 11.5.0，Go CGO 在本机默认启用（`go env CGO_ENABLED` 返回 `1`），不需要设置 `CC`、`CXX` 或 `CGO_ENABLED`。
2. Node.js `v24.21.0` 通过 nvm 安装在 `~/.nvm`，本机已安装；每个新 shell 使用 `source ~/.nvm/nvm.sh && nvm use 24` 切换到 Node 24。
3. npm 为 `11.19.0`，pnpm `12.6.0` 已全局安装在该 Node 下，与 `app/package.json` 的 `packageManager` 字段一致；不要使用 Corepack，也不要使用独立 `@pnpm/exe`。
4. Go `1.26.5` 安装在 `~/sdk/go1.26.5`，为用户级安装，无需 sudo；由于 go.dev 直连不可达，工具链本身从 golang.google.cn 镜像下载。按进程使用：`export PATH="$HOME/sdk/go1.26.5/bin:$PATH"`。
5. 仓库本地缓存：`GOCACHE=$PWD/.go-cache`，`GOTMPDIR=$PWD/.go-tmp`；这两个目录已加入 `.git/info/exclude`。
6. Python 使用 Conda 环境 `siyuan-ly-env`，Python `3.11.17`，解释器为 `/home/lfx/miniconda3/envs/siyuan-ly-env/bin/python`；运行 `scripts/check-lang-keys.py` 等脚本时固定使用该绝对路径。
7. 网络：npm registry `https://registry.npmjs.org/` 可直连；Go 模块默认代理 `proxy.golang.org` 在本机反复连接超时，执行 Go 构建或测试时需在命令级设置 `GOPROXY=https://goproxy.cn,direct`，仅首次下载模块时需要。仅 Go 工具链本身的下载需要 golang.google.cn 镜像。本机没有配置代理，不要把代理设置写入仓库文件。
8. 本机是 headless 服务器，Electron UI 测试和任何浏览器/Electron UI 验证需要显示环境（例如 xvfb），或必须由开发者在带图形界面的机器上完成。

### 本机环境的使用方式

以下命令仅设置当前 shell 的环境，不修改用户或系统 PATH，不安装项目依赖。

```bash
source ~/.nvm/nvm.sh && nvm use 24;
node --version;
npm --version;
pnpm --version;
export PATH="$HOME/sdk/go1.26.5/bin:$PATH";
go version;
```

Python 的调用方式：Agent 的每次 shell 调用是新进程，因此固定使用下面的绝对路径，避免依赖前一次 `conda activate` 状态。

```bash
~/miniconda3/envs/siyuan-ly-env/bin/python --version;
# 在仓库根目录运行，等明确开始并修改多语言后再执行
~/miniconda3/envs/siyuan-ly-env/bin/python scripts/check-lang-keys.py;
```

Go CGO 在本机默认可用，系统 gcc 即可完成 CGO 编译，无需设置 `CGO_ENABLED`、`CC` 或 `CXX`；执行 Go 测试时使用下面的仓库本地缓存。

```bash
export PATH="$HOME/sdk/go1.26.5/bin:$PATH";
export GOCACHE="$PWD/.go-cache";
export GOTMPDIR="$PWD/.go-tmp";
go env CGO_ENABLED;
```

### 网络

npm registry `https://registry.npmjs.org/` 可直连；Go 模块默认代理 `proxy.golang.org` 在本机反复连接超时，执行 Go 构建或测试时需在命令级设置 `GOPROXY=https://goproxy.cn,direct`，仅首次下载模块时需要。仅 Go 工具链本身的下载需要 golang.google.cn 镜像。本机没有配置代理，不要把代理凭据或仅限本机的代理配置写入仓库文件。

### 前端依赖安装

1. 在 `app/` 目录执行 `pnpm install --frozen-lockfile --store-dir ../.pnpm-store-temp`；该 store 目录已加入 `.git/info/exclude`，不修改项目配置。
2. 在 `app/` 目录执行 `pnpm run install:electron`，下载 Linux Electron 二进制。
3. 安装完成后确认 `app/node_modules` 存在，并确认 Electron 依赖已下载。
4. 不要执行 `pnpm build` 作为本任务验证命令；前端代码检查使用 `pnpm run lint`。

### 内核开发和运行环境

1. 本机 Go CGO 默认启用，系统 gcc 可直接完成 CGO 编译，无需额外配置工具链。
2. 内核按照 `.github/CONTRIBUTING.zh-CN.md` 使用 `fts5 sqlcipher` 标签编译，再由开发者手动启动内核。
3. Agent 在本任务中不会编译完整内核二进制或重启正在运行的内核；这一步由开发者手动执行。
4. 运行前准备一个专用测试工作区，不要直接使用生产工作区；测试前复制或备份 `conf/`、`data/`、`repo/`、`history/`。

### 同步测试环境

| 场景 | 准备内容 |
|---|---|
| S3 | 一个专用 S3 兼容服务或本地 MinIO，准备独立 bucket、Access Key、Secret Key、Region 和 Endpoint |
| WebDAV | 一个专用 WebDAV 服务或测试容器，准备独立用户名、密码和 Endpoint；优先使用 HTTPS |
| Local | 一个不在思源工作区内的空目录，例如 `/home/lfx/siyuan-sync-test`；不要设置为工作区本身、工作区父目录或其子目录 |
| 多设备模拟 | 两个独立测试工作区，共用同一个数据仓库密钥和测试同步目标，不要并发写入同一目标目录 |
| 断网和冲突 | 可控制网络连接的测试环境，准备两个工作区对同一文档产生不同修改 |
| 按需资源 | 准备包含图片、PDF、视频和文件附件的测试工作区，并分别测试已下载和未下载状态 |

### AI 测试环境

1. 准备至少一个 OpenAI 兼容 API 的测试提供商和一个可用模型；API Key 只写入本地配置，不提交到 Git。
2. 如需测试 Embedding，准备对应 Embedding 模型和独立 API Key，并确认服务端维度与配置一致。
3. 如需测试 Rerank，准备 Cohere 或 DashScope 兼容的测试服务。
4. 如需测试 MCP，准备一个无敏感数据的本地 stdio MCP 或受控 HTTP MCP 服务，并使用最小权限配置。
5. 如需测试技能，准备独立测试技能目录；不要把包含密钥或生产脚本的技能目录用于功能验证。

### 验证工具和可选环境

1. 运行 API 契约生成或检查时，如需同步 `petal` 声明，应在仓库同级准备 `petal` 工作区；当前目录没有 `../petal`，本次计划文件生成不要求它。
2. 如需浏览器验证，必须访问 `/stage/build/desktop/`，不要直接访问根路径；当前工作区还没有生成 `app/stage/build/`。
3. 如需检查无更新和无遥测请求，可使用 `tcpdump`、mitmproxy 或本地 HTTP mock 服务记录出站请求；不要把真实生产 API Key 放入抓包环境。
4. 如需执行全量 Go 测试，准备足够磁盘空间和时间；测试使用 `fts5 sqlcipher` 标签，并且不应连接生产同步服务。

### Windows 打包 release 环境（本机）

定制版打包 Windows 安装包使用仓库自带的本机脚本 `scripts/win-build.bat`；不需要官方发布编排脚本 `scripts/build-release.py`（它强制 YubiKey 代码签名并固定 ARM64 编译器路径，只适用于官方发布机）。

**必需工具**

| 工具 | 要求 | 说明与本机状态 |
|---|---|---|
| Git | 任意近期版本 | 本机已安装 2.55.0 |
| Node.js | 24.x | 与 CI 一致；本机已安装 v24.18.1 |
| pnpm | `12.6.0` | 以 `app/package.json` 的 `packageManager` 字段为准，不要使用 Corepack 或独立 `@pnpm/exe`；本机已安装 12.6.0 |
| Go | `1.26.5` | `kernel/go.mod` 声明；本机已安装 go1.26.5 windows/amd64 |
| gcc 或 clang（MinGW 工具链） | 任意近期版本 | CGO 编译 sqlite/sqlcipher 必需；本机已安装 MSYS2 clang64 工具链（clang 22.1.8，目标 `x86_64-w64-windows-gnu`，自带 lld 链接器），位于 `C:\msys64\clang64\bin`；由于该目录不在 PATH 且系统无 gcc，Go 默认 `CGO_ENABLED=0`，执行内核编译或测试时需在命令级设置 `CC=/c/msys64/clang64/bin/cc.exe` 和 `CGO_ENABLED=1`，或把该 `bin` 目录加入系统 PATH；2026-10-12 CGO 探针通过 |
| Python | 3.11 以上 | 仅运行 `scripts/build-release.py` 时需要，推荐打包路径不需要；本机已安装 3.14.7 |

Windows 下 sqlcipher 不需要单独安装 OpenSSL：`kernel/go.mod` 替换的 go-sqlite3 内置 SQLCipher 与 libtomcrypt，内核编译只需要 `CGO_ENABLED=1` 和一个能编译 C 的 MinGW gcc。打包 ARM64 安装包时另需 llvm-mingw 的 `aarch64-w64-mingw32-gcc.exe`，默认路径可在 `scripts/win-build.bat` 中修改。

**打包步骤（AMD64）**

在仓库根目录执行：

```bat
scripts\win-build.bat --target=amd64
```

脚本依次完成：删除旧的 `app/build` 与 `app/kernel*`；在 `app/` 执行 `pnpm install`、`pnpm run install:electron`、`pnpm run build`（四个 webpack 生产构建）；安装 goversioninfo 并生成 Windows 版本资源；在 `kernel/` 执行 `go build -tags "fts5 sqlcipher"` 输出 `app\kernel\SiYuan-Kernel.exe`；复制 `app\elevator\elevator-amd64.exe` 为 `app\kernel\elevator.exe`；在 `app/` 执行 `pnpm run dist`（electron-builder 生成 NSIS 安装包）。

产物为 `app\build\siyuan-<版本>-win.exe`，解包目录为 `app\build\win-unpacked`；ARM64 使用 `--target=arm64`，产物为 `siyuan-<版本>-win-arm64.exe`。

**注意事项**

1. Electron 42 起 `pnpm install` 不再自动下载 Electron 二进制，必须执行 `pnpm run install:electron`；下载受限时可先设置 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
2. 打包前确认 `kernel/util/working.go` 的 `Ver` 与 `app/package.json` 的 `version` 一致且 `Mode` 为 `prod`；发布正式版还需要 `app/changelogs/v<版本>/` 目录
3. 不要把 `siyuan.exe` 放进 `app/kernel/` 后再运行 electron-builder，安装阶段由 NSIS 创建硬链接
4. `pnpm run dist` 不强制代码签名；如需签名，设置 electron-builder 的 `CSC_LINK` 与 `CSC_KEY_PASSWORD` 环境变量
5. 安装器拒绝 Windows 10 以下系统，并拒绝安装到包含 `data` 工作区的目录
6. 与 AGENTS.md 约束一致：日常改动验证使用 `pnpm run lint`；`win-build.bat` 内部执行 `pnpm run build`，与开发者手动运行的 `pnpm dev` 冲突，需错开执行

## 7. 当前环境状态、基线验证和实施闸门

用户已明确授权环境准备与基线测试，但尚未授权六项功能实施。Node.js `v24.21.0`、pnpm `12.6.0`、Go `1.26.5` 和 Conda Python `3.11.17` 已在本机 Linux 环境确认可用。

### 已执行结果

| 项目 | 命令或验证方式 | 结果 |
|---|---|---|
| 前端依赖 | 在 `app/` 执行 `pnpm install --frozen-lockfile --store-dir ../.pnpm-store-temp` | 通过；安装 574 个包，lockfile 未改动 |
| Electron | 在 `app/` 执行 `pnpm run install:electron` | 通过；下载 Linux 版 Electron 44.4.5，`app/node_modules/electron/dist/electron` 存在；不等同于 UI 测试通过 |
| 前端 Lint 和类型检查 | 在 `app/` 执行 `pnpm run lint` | 通过；包含两套 TypeScript 检查与 ESLint，没有产生跟踪源码改动 |
| 前端全量测试 | 在 `app/` 执行 `xvfb-run -a pnpm test`（xvfb 提供虚拟显示，chrome-sandbox 已修复为 root:root 4755） | 通过；3368 通过、0 失败、7 跳过（跳过为测试自身声明的环境限制）；修复前在无显示环境下 50 项 Electron 集成测试因环境问题失败，与断言无关 |
| API 契约声明检查 | 在 `app/` 执行 `pnpm run api:check`，命令级设置 `GOPROXY=https://goproxy.cn,direct` | 通过；检查 697 条类型化方法/路径；默认 `proxy.golang.org` 超时，与镜像无关的问题不存在；没有运行 `api:generate`，没有同步外部 Petal 声明 |
| Go 格式检查 | 在 `kernel/` 执行 `gofmt -l .` | 没有输出，未发现需要格式化的 Go 文件；没有运行 `gofmt -w` |
| CGO 探针 | 临时 Go 程序调用简单 C 函数（`C.add` 与 `C.strlen`） | 通过；Linux 下系统 gcc 可直接完成 CGO 编译与运行，临时目录已清理 |
| 纯 Go API 契约测试 | 在 `kernel/` 执行 `go test ./apicontract/...`，命令级设置 `GOPROXY=https://goproxy.cn,direct` | 通过；首次因模块下载超时失败，镜像重试后通过，失败与代码无关 |
| 同步和资源 Go 基线 | 在 `kernel/` 执行 `go test -tags 'fts5 sqlcipher' ./model ./api -run 'Test(CheckSync\|SyncProvider\|AssetDownload\|APIContractSync)' -count=1`，命令级设置 `GOPROXY=https://goproxy.cn,direct` | 通过；`model`、`api` 在 fts5 sqlcipher 标签下编译成功，20 个顶层测试与 9 个子测试全部通过、0 失败；同步测试中的云端对象缺失日志是预期负路径 |
| 语言包检查 | 在仓库根目录执行 `~/miniconda3/envs/siyuan-ly-env/bin/python scripts/check-lang-keys.py` | 通过；检查 22 个语言文件、2999 个预期键，0 个非预期键，键完整且 Go 占位符兼容 |
| Windows CGO 工具链 | 在 Windows 本机命令级设置 `CC=/c/msys64/clang64/bin/cc.exe CGO_ENABLED=1` 编译运行临时 cgo 程序 | 通过（2026-10-12）；MSYS2 clang64（clang 22.1.8，目标 `x86_64-w64-windows-gnu`，自带 lld），内核测试与打包可用 |
| 资源索引 Go 回归测试 | 在 `kernel/` 执行 `go test -tags "fts5 sqlcipher" ./sql -run TestFlushAssetContentQueue -count=1` 和 `go test -tags "fts5 sqlcipher" ./model -run TestEncryptedAssetPathsSkipPlaintextContentIndex -count=1`，命令级设置 `CC`/`CGO_ENABLED`/`GOPROXY=https://goproxy.cn,direct` | 通过（2026-10-12）；队列操作失败发布重建事件、提交失败不重建、加密资源在增量索引/删除/全量重建三路径均不入明文索引 |
| AI 禁用回归测试 | 在 `kernel/` 执行 `go test -tags "fts5 sqlcipher" ./api -run TestAPIContractAIDisabled -count=1`、`./model -run TestAIDisabledBackgroundFeatures -count=1`、`./mcp/client -run TestAIDisabledMCPConnections -count=1` | 通过（2026-10-12）；显式禁用 `ai` 后 API 契约、后台功能与 MCP 连接均正确失效 |

### 本机缓存和权限

仓库本地缓存目录有三个：`.pnpm-store-temp`（前端依赖 store）、`.go-cache`（Go 构建缓存）和 `.go-tmp`（Go 临时目录）。三者只加入 `.git/info/exclude` 私有忽略，未修改共享 `.gitignore`，不应提交。

### 剩余环境问题

1. 本机是 headless 服务器，已安装 xvfb 并将 chrome-sandbox 修复为 root:root 4755；在 `xvfb-run -a pnpm test` 下前端全量测试 3368 通过、0 失败、7 跳过，UI 测试已能在本机完整通过。注意重新执行 `pnpm install` 或更新 Electron 后，chrome-sandbox 权限会被重置，需要再次修复。
2. 尚未生成 `app/stage/build`，尚未编译内核二进制，也没有重启任何正在运行的内核。
3. 同级 `../petal` 工作区尚未准备，因此 `api:check` 不包含外部 Petal 声明同步验证。

计划创建时没有功能源码、lockfile 或生成声明改动，也没有提交或推送。2026-10-10 更新：实施闸门已通过，阶段 A、B、C 及部分 E 以提交 `bcf8e5408a` 落地。2026-10-12 更新：阶段 D（编辑器 AI 未配置引导）与阶段 F（资源全文搜索回归测试）已实施，Windows 本机已安装 MSYS2 clang64 工具链并完成内核侧回归验证（见上表）；Go 测试在本机需命令级设置 `CC`/`CGO_ENABLED`。阶段 G 整体验证待完成。

## 8. 完成标准

只有同时满足以下条件，定制版本才视为完成：无官方账号和官方云入口、无模拟账号、S3/WebDAV/Local 能在无官方账号状态下正常同步、更新和不必要后台外联已关闭、AI 入口可配置使用、默认导出无品牌附加且自定义水印保留、资源全文搜索可用、加密数据兼容与隔离未被破坏，并且相关前端、内核、API、语言和跨端测试通过。
