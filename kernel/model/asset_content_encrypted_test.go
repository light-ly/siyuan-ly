// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/gulu"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	encryptedAssetBoxID = "20261010000000-encbox1"
	normalAssetBoxID    = "20261010000000-nrmbox1"
)

// TestEncryptedAssetPathsSkipPlaintextContentIndex 验证加密笔记本资源在增量索引、删除和全量重建三条路径上
// 都不进入全局明文资源索引队列，普通笔记本资源仍会入队。
func TestEncryptedAssetPathsSkipPlaintextContentIndex(t *testing.T) {
	restoreDataDir := useAssetIndexDataDir(t)
	defer restoreDataDir()
	writeAssetIndexBoxConf(t, encryptedAssetBoxID, true)
	writeAssetIndexBoxConf(t, normalAssetBoxID, false)
	if !IsEncryptedBox(encryptedAssetBoxID) || IsEncryptedBox(normalAssetBoxID) {
		t.Fatal("测试笔记本的加密身份未按 conf.json 生效")
	}

	encryptedAbs := writeAssetIndexFile(t, encryptedAssetBoxID, "secret.txt", "encrypted plaintext stays out")
	normalAbs := writeGlobalAssetFile(t, "public.txt", "ordinary asset content")
	if !IsEncryptedAssetPath(encryptedAbs) || IsEncryptedAssetPath(normalAbs) {
		t.Fatalf("资源路径的加密判断与笔记本身份不一致：encrypted=%v normal=%v",
			IsEncryptedAssetPath(encryptedAbs), IsEncryptedAssetPath(normalAbs))
	}
	parsed := installAssetContentParseProbe(t)

	t.Run("incremental index", func(t *testing.T) {
		sql.DiscardAssetContentOperationsForTest()
		before := sql.AssetContentOperationCountForTest()
		HandleAssetsChangeEvent(encryptedAbs)
		if got := sql.AssetContentOperationCountForTest() - before; got != 0 {
			t.Fatalf("加密资源增量索引不应写入明文索引队列，实际新增 %d 个操作", got)
		}

		before = sql.AssetContentOperationCountForTest()
		HandleAssetsChangeEvent(normalAbs)
		if got := sql.AssetContentOperationCountForTest() - before; got != 2 {
			t.Fatalf("普通资源增量索引应入队删除和索引两个操作，实际新增 %d 个", got)
		}
		assertParsedAssetPaths(t, parsed, []string{normalAbs})
	})

	t.Run("delete", func(t *testing.T) {
		sql.DiscardAssetContentOperationsForTest()
		before := sql.AssetContentOperationCountForTest()
		HandleAssetsRemoveEvent(encryptedAbs)
		if got := sql.AssetContentOperationCountForTest() - before; got != 0 {
			t.Fatalf("加密资源删除不应写入明文索引队列，实际新增 %d 个操作", got)
		}

		before = sql.AssetContentOperationCountForTest()
		HandleAssetsRemoveEvent(normalAbs)
		if got := sql.AssetContentOperationCountForTest() - before; got != 1 {
			t.Fatalf("普通资源删除应入队一个操作，实际新增 %d 个", got)
		}
		assertParsedAssetPaths(t, parsed, nil)
	})

	t.Run("full reindex", func(t *testing.T) {
		sql.DiscardAssetContentOperationsForTest()
		before := sql.AssetContentOperationCountForTest()
		assetContentSearcher.FullIndex()
		if got := sql.AssetContentOperationCountForTest() - before; got != 1 {
			t.Fatalf("全量重建应只为普通资源入队一个索引操作，实际新增 %d 个", got)
		}
		assertParsedAssetPaths(t, parsed, []string{normalAbs})
	})
}

type recordingAssetParser struct {
	parsed *[]string
}

func (parser *recordingAssetParser) Parse(absPath string) *AssetParseResult {
	*parser.parsed = append(*parser.parsed, absPath)
	return &AssetParseResult{Content: "ordinary asset content"}
}

func installAssetContentParseProbe(t *testing.T) *[]string {
	t.Helper()
	parsed := []string{}
	assetContentSearcher.lock.Lock()
	previous := assetContentSearcher.parsers[".txt"]
	assetContentSearcher.parsers[".txt"] = &recordingAssetParser{parsed: &parsed}
	assetContentSearcher.lock.Unlock()
	t.Cleanup(func() {
		assetContentSearcher.lock.Lock()
		assetContentSearcher.parsers[".txt"] = previous
		assetContentSearcher.lock.Unlock()
	})
	return &parsed
}

func assertParsedAssetPaths(t *testing.T, parsed *[]string, want []string) {
	t.Helper()
	if len(*parsed) != len(want) {
		t.Fatalf("解析的资源路径数量不正确：got %v, want %v", *parsed, want)
	}
	for i, path := range want {
		if filepath.Clean((*parsed)[i]) != filepath.Clean(path) {
			t.Fatalf("解析了非预期资源：got %v, want %v", *parsed, want)
		}
	}
	*parsed = nil
}

func useAssetIndexDataDir(t *testing.T) func() {
	t.Helper()
	oldDataDir := util.DataDir
	util.DataDir = t.TempDir()
	return func() {
		forgetRuntimeEncryptedBox(encryptedAssetBoxID)
		forgetRuntimeNormalBox(encryptedAssetBoxID)
		forgetRuntimeEncryptedBox(normalAssetBoxID)
		forgetRuntimeNormalBox(normalAssetBoxID)
		util.DataDir = oldDataDir
	}
}

func writeAssetIndexBoxConf(t *testing.T, boxID string, encrypted bool) {
	t.Helper()
	confDir := filepath.Join(util.DataDir, boxID, ".siyuan")
	if err := os.MkdirAll(confDir, 0755); err != nil {
		t.Fatal(err)
	}
	boxConf := conf.NewBoxConf()
	boxConf.Encrypted = encrypted
	data, err := gulu.JSON.MarshalIndentJSON(boxConf, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(confDir, "conf.json"), data, 0644); err != nil {
		t.Fatal(err)
	}
}

func writeGlobalAssetFile(t *testing.T, name, content string) string {
	t.Helper()
	assetsDir := util.GetDataAssetsAbsPath()
	if err := os.MkdirAll(assetsDir, 0755); err != nil {
		t.Fatal(err)
	}
	absPath := filepath.Join(assetsDir, name)
	if err := os.WriteFile(absPath, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
	return absPath
}

func writeAssetIndexFile(t *testing.T, boxID, name, content string) string {
	t.Helper()
	assetsDir := filepath.Join(util.DataDir, boxID, "assets")
	if err := os.MkdirAll(assetsDir, 0755); err != nil {
		t.Fatal(err)
	}
	absPath := filepath.Join(assetsDir, name)
	if err := os.WriteFile(absPath, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
	return absPath
}
