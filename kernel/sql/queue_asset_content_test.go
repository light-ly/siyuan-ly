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

package sql

import (
	gosql "database/sql"
	"sync"
	"testing"

	"github.com/siyuan-note/eventbus"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestFlushAssetContentQueuePublishesRebuildWhenOperationFails(t *testing.T) {
	restore := useAssetContentQueueDB(t)
	defer restore()

	rebuilds := 0
	var rebuildsLock sync.Mutex
	if err := eventbus.Subscribe(util.EvtSQLAssetContentRebuild, func() {
		rebuildsLock.Lock()
		rebuilds++
		rebuildsLock.Unlock()
	}); err != nil {
		t.Fatal(err)
	}

	IndexAssetContentsQueue([]*AssetContent{{
		ID:      "20261010000001-asset01",
		Name:    "missing",
		Ext:     ".txt",
		Path:    "assets/missing.txt",
		Size:    7,
		Updated: 1,
		Content: "missing",
	}})
	FlushAssetContentQueue()

	rebuildsLock.Lock()
	got := rebuilds
	rebuildsLock.Unlock()
	if got != 1 {
		t.Fatalf("单次索引操作失败应发布一次资源索引重建事件，实际 %d 次", got)
	}
	if pending := getAssetContentOperations(); len(pending) != 0 {
		t.Fatalf("失败的操作已从队列取出，不应残留：%d", len(pending))
	}
}

func TestFlushAssetContentQueueDoesNotRebuildWhenCommitFails(t *testing.T) {
	restore := useAssetContentQueueDB(t)
	defer restore()

	rebuilds := 0
	if err := eventbus.Subscribe(util.EvtSQLAssetContentRebuild, func() {
		rebuilds++
	}); err != nil {
		t.Fatal(err)
	}

	stmt := "CREATE TABLE asset_contents_fts_case_insensitive (id, name, ext, path, size, updated, content)"
	if _, err := assetContentDB.Exec(stmt); err != nil {
		t.Fatal(err)
	}
	assetContentDB.Close()

	IndexAssetContentsQueue([]*AssetContent{{
		ID:      "20261010000002-asset02",
		Name:    "closed",
		Ext:     ".txt",
		Path:    "assets/closed.txt",
		Size:    6,
		Updated: 1,
		Content: "closed",
	}})
	FlushAssetContentQueue()
	if rebuilds != 0 {
		t.Fatalf("事务提交失败只记录日志，不应发布重建事件，实际 %d 次", rebuilds)
	}
}

func useAssetContentQueueDB(t *testing.T) func() {
	t.Helper()
	testDB, err := gosql.Open("sqlite3_extended", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	previousDB := assetContentDB
	assetContentDBQueueLock.Lock()
	previousQueue := assetContentOperationQueue
	assetContentOperationQueue = nil
	assetContentDBQueueLock.Unlock()
	assetContentDB = testDB
	return func() {
		assetContentDB = previousDB
		assetContentDBQueueLock.Lock()
		assetContentOperationQueue = previousQueue
		assetContentDBQueueLock.Unlock()
		testDB.Close()
	}
}
