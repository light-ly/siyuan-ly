# 合并上游代码的教训与检查清单

本文记录 2026-10-21 合并上游 v3.8.8 时引入的缺陷、修复过程与防复发清单，供后续每次合并上游时对照执行。

[English](MERGE-LESSONS.md)

## 1. 事故回顾

合并 `v3.8.8` 到 `patch/custom`（合并提交 `4528754bba`）后，运行时发现**主窗口启动遮罩无法结束**（约 7 秒后只显示"点击刷新"，点击后循环重启）。复查确认根因是冲突解决的系统性失误，最终统计：

- **前端丢失上游接线 25 项**，分布在 8 个文件（两个桌面入口各 8 处、`config/index.ts` 4 处、`appRuntime.ts` 3 处、`syncTab.ts` 4 处、`onMessage.ts` 3 处、`syncGuide.ts` 2 处、`mobile/index.ts` 6 处、同步设置 UI 上游重构约 500 行整体丢失）
- **Go 侧丢失 1 处**（`conf.go` 退出路径的诊断日志）
- **回归测试被连带删除 2 处**（`syncUi.test.ts` 从上游 527 行退回 139 行旧版、`cloud_account_auth_test.go` 的 `refreshUser` 用例）

## 2. 根因

冲突解决时采用了"整块保留我方（keep HEAD）"的偷懒策略：为保留"去官方账号"的定制改写，把同一冲突块中**上游新增的、与定制目标完全无关的功能**（启动生命周期包装、设置热同步刷新、消息分支、第三方同步配置 UI 重构、移动端触摸/布局增强等）一并丢弃。

具体问题模式：

1. **冲突块粒度误判**：把"删除账号逻辑"扩大成"删除整个冲突块的上游内容"
2. **只验证编译，不验证接线**：模块都还在仓库里，但调用点丢了（"模块存在 ≠ 功能接通"）
3. **测试同步失守**：上游新增/重构的测试随源码一起被丢弃，丢失了发现问题的最后防线
4. **委托无校验**：冲突解决交给子 agent 后没有安排独立的语义复查，直接信任"冲突标记清零 + 编译通过"

## 3. 正确的冲突解决方法

按以下方法对每个冲突文件逐一处理（本次修复验证有效）：

1. **先算清双方增量**：`git diff <merge-base> <ours> -- <file>` 看定制改了什么；`git diff <merge-base> <theirs> -- <file>` 看上游改了什么
2. **逐块判断语义**：每个冲突块问"上游这部分改动与定制目标有关吗"——无关则必须保留，有关才删除或改写
3. **小定制 + 大上游重构的文件**：取上游整文件为底（`git show <theirs>:<file> > <file>`），再重放定制删除（AgentChat/topBar/breadcrumb/syncUi/mobile 均用此法修复）
4. **大定制 + 小上游改动的文件**：保留我方结构，把上游新增点逐项嫁接进来（index.ts/config 等入口文件用此法）
5. **测试同进退**：上游改的测试跟着上游走，定制删除的测试一起删，绝不整体保留旧测试文件
6. **保留语义以计划文档为准**：判断"该删什么"的依据是 `docs/CUSTOM-PATCH-PLAN.zh-CN.md` 的范围决策，不是"看起来像账号相关"的直觉

## 4. 合并后的强制检查清单

每次合并上游后、提交前必须完成：

### 4.1 启动链路（最高优先级，出过生产事故）

- [ ] `app/src/index.ts` 与 `app/src/window/index.ts` 调用 `initWindowWithLoading` 包装启动流程（守护测试：`app/src/boot/startupWiring.test.ts`）
- [ ] 两个入口的 `mainWs.connect` 有 `refreshSettingConfig` 回调与 `settingChanged` 消息分支
- [ ] `closeBox`/`removeBox` 分支调用 `closeNotebookLivePhotos`
- [ ] 主入口启动完成处调用 `exitAfterSettingsReset()`
- [ ] BROWSER 分支注册 `registerDesktopBackNavigation()`
- [ ] 三个入口（index/window/mobile）的 `installPluginStorageFetchAppId` 为四参数新签名
- [ ] 移动端保留 `ensureLute` 阶段化启动、触摸/布局保存/URI 深链等接线

### 4.2 功能对照

- [ ] 逐文件运行第 3 节的三方对比法（至少覆盖全部冲突文件 + 自动合并但双方同改过的文件）
- [ ] 上游新增的消息分支（switch case）在当前代码中都能找到
- [ ] 上游重构过的函数，所有调用点都用了新签名
- [ ] 定制删除清单逐项核对：只删了计划范围内的（账号/官方云/更新器），没有扩大化

### 4.3 验证

- [ ] `pnpm run lint` 通过
- [ ] `python scripts/check-lang-keys.py` 通过
- [ ] 守护测试与受影响模块测试通过
- [ ] 涉及内核：`go build -tags "fts5 sqlcipher" ./...` + 相关 `go test`
- [ ] **实际启动应用验证启动遮罩、设置页、同步页三个页面**

## 5. 本次新增的防线

- `app/src/boot/startupWiring.test.ts`：8 项源码断言，双向守护（上游接线不丢 + 账号逻辑不回流）
- 本文档作为每次合并的检查清单

## 6. 已知的有意删除（不要当 bug 恢复）

以下删除属于定制版计划范围，复查时看到不要恢复：

- `kernel/util/rhy.go` 的 `RefreshRhyResultJob` 定时刷新（计划阶段 C：关闭定时后台外联；集市哈希按需获取不受影响）
- `updater*.go` 全部更新器文件（计划阶段 C）
- `refreshUser`/`refreshAnnouncement` 等官方账号/公告刷新（阶段 B/C）
- 各入口的 `getCloudUser`/`onSetaccount` 调用（阶段 B）
