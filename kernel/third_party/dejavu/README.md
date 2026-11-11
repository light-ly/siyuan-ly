# Vendored dejavu

本目录内嵌 [siyuan-note/dejavu](https://github.com/siyuan-note/dejavu) 的完整源码，通过
`kernel/go.mod` 中的 `replace github.com/siyuan-note/dejavu => ./third_party/dejavu` 生效。

## 为什么内嵌

上游 `cloud/s3.go` 的按前缀列举只使用 ListObjects(V1) Marker 手工翻页。部分 S3 兼容服务端
对 V1 翻页支持异常（忽略 marker 导致 `list objects marker did not advance`，表现为
「清理数据仓库失败」，见上游 issue siyuan-note/siyuan#19961 的同类兼容问题），而另一些服务端
（如腾讯 COS）恰恰相反，只支持 V1、对 V2 返回 404（siyuan-note/siyuan#19109）。
单方面切换 V1/V2 都会修好一部分服务端、破坏另一部分，因此本 fork 采用
**V2 优先、失败回退 V1** 的双路径分页，覆盖两类服务端。

## 本 fork 的补丁

- `cloud/s3.go`：`listS3Objects` 拆为 `listS3ObjectsV2`（ContinuationToken 翻页）+
  `listS3ObjectsV1`（原 Marker 翻页），入口先尝试 V2，失败时记录警告并回退 V1。
  `listObjectsAPIClient` 接口相应新增 `ListObjectsV2` 方法。
  V2 翻页带终止保护：续传令牌重复（恒定或循环）或页数超过上限时显式报错回退，
  避免实现不规范的服务端导致死循环空转 CPU、挂死同步与快照等云端请求。
- `cloud/s3_test.go`：桩同时实现两个列举接口；新增 V2 优先、V2 不支持时回退 V1、
  V2 空续传令牌、V2 令牌重复四个用例，原有 V1 用例通过强制 V2 报错的桩继续覆盖 V1 路径。

## 同步上游步骤

每次合并上游、dejavu 版本变化时：

1. 从 `kernel/go.mod` 原本应使用的 dejavu 版本（合并前上游 go.mod 中的伪版本号）取出源码：
   目录通常在 `$GOPATH/pkg/mod/github.com/siyuan-note/dejavu@<version>`
2. 用上游源码整体覆盖本目录（保留本 README），随后重放上述补丁（可用
   `git log --oneline -- kernel/third_party/dejavu` 找到补丁提交对照重放）
3. 在 `kernel/third_party/dejavu` 下运行 `go test ./cloud/`
4. 在 `kernel/` 下运行 `go build -tags "fts5 sqlcipher" ./...`

当前基线：dejavu `v0.0.0-20261109165330-317610e0795e`（2026-11-09）。

## 已知服务商行为（本机 AList v3.66.0 实测）

- AList 的 S3 服务基于 gofakes3，V1 Marker 翻页存在缺陷：排序按修改时间、
  `NextMarker` 可能返回目录占位条目，翻页会原样重复第一页并触发
  "list objects marker did not advance"（对象数超过单页时必然出现）。
- 同一版本 AList 的 ListObjectsV2 翻页正常（ContinuationToken 按页前进）。
  旧版本 AList 的 V2 可能返回循环续传令牌，已由上面的终止保护兜住并回退 V1。
- 因此 V2 优先 + V1 回退 + 令牌重复终止是当前对 AList 全版本最稳的组合；
  升级 AList 到较新版本可让清理数据仓库走完整的 V2 分页。
