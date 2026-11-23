// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	gosql "database/sql"
	"database/sql/driver"
	"fmt"
	"os"
	"os/exec"
	"sync"
	"testing"
	"time"

	"github.com/mattn/go-sqlite3"
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

func TestAssetContentQueueRebuildsAfterTransactionFailure(t *testing.T) {
	const childEnv = "SIYUAN_TEST_ASSET_TRANSACTION_FAILURE"
	if os.Getenv(childEnv) == "" {
		for _, stage := range []string{"begin", "commit"} {
			t.Run(stage, func(t *testing.T) {
				cmd := exec.Command(os.Args[0], "-test.run=^TestAssetContentQueueRebuildsAfterTransactionFailure$", "-test.timeout=30s")
				cmd.Env = append(os.Environ(), childEnv+"="+stage)
				if output, err := cmd.CombinedOutput(); err != nil {
					t.Fatalf("asset transaction failure subprocess: %v\n%s", err, output)
				}
			})
		}
		return
	}
	for _, stage := range []string{"begin", "commit"} {
		if os.Getenv(childEnv) != stage {
			continue
		}
		t.Run(stage, func(t *testing.T) {
			driverName := fmt.Sprintf("asset-content-%s-%d", stage, time.Now().UnixNano())
			gosql.Register(driverName, assetContentFailingDriver{stage: stage})
			testDB, err := gosql.Open(driverName, ":memory:")
			if err != nil {
				t.Fatal(err)
			}
			testDB.SetMaxOpenConns(1)
			previousDB, previousQueue := assetContentDB, assetContentOperationQueue
			assetContentDB, assetContentOperationQueue = testDB, nil
			rebuilds := 0
			handler := func() { rebuilds++ }
			eventbus.Subscribe(util.EvtSQLAssetContentRebuild, handler)
			t.Cleanup(func() {
				testDB.Close()
				assetContentDB, assetContentOperationQueue = previousDB, previousQueue
			})
			if _, err := testDB.Exec("CREATE TABLE asset_contents_fts_case_insensitive (id, name, ext, path, size, updated, content)"); err != nil {
				t.Fatal(err)
			}
			IndexAssetContentsQueue([]*AssetContent{{ID: "failed", Path: "assets/test.txt"}})
			if err := FlushAssetContentQueue(); !isRecoverableDBFileError(err) || rebuilds != 1 {
				t.Fatalf("%s failure did not request asset recovery: err=%v rebuilds=%d", stage, err, rebuilds)
			}
			var count int
			if err := testDB.QueryRow("SELECT COUNT(*) FROM asset_contents_fts_case_insensitive").Scan(&count); err != nil || count != 0 {
				t.Fatalf("failed transaction committed partial data: count=%d err=%v", count, err)
			}
		})
	}
}

type assetContentFailingDriver struct {
	stage string
}

func (d assetContentFailingDriver) Open(name string) (driver.Conn, error) {
	conn, err := (&sqlite3.SQLiteDriver{}).Open(name)
	if err != nil {
		return nil, err
	}
	return assetContentFailingConnection{Conn: conn, stage: d.stage}, nil
}

type assetContentFailingConnection struct {
	driver.Conn
	stage string
}

func (conn assetContentFailingConnection) Begin() (driver.Tx, error) {
	if conn.stage == "begin" {
		return nil, sqlite3.Error{Code: sqlite3.ErrCorrupt}
	}
	tx, err := conn.Conn.Begin()
	if err != nil {
		return nil, err
	}
	return assetContentFailingTransaction{Tx: tx}, nil
}

type assetContentFailingTransaction struct {
	driver.Tx
}

func (tx assetContentFailingTransaction) Commit() error {
	tx.Tx.Rollback()
	return sqlite3.Error{Code: sqlite3.ErrCorrupt}
}

func TestAssetContentQueueReportsWriteFailure(t *testing.T) {
	testDB, err := gosql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	previousDB, previousQueue := assetContentDB, assetContentOperationQueue
	assetContentDB, assetContentOperationQueue = testDB, nil
	t.Cleanup(func() {
		_ = testDB.Close()
		assetContentDB, assetContentOperationQueue = previousDB, previousQueue
	})
	if _, err := testDB.Exec("CREATE TABLE asset_contents_fts_case_insensitive (id TEXT UNIQUE, name TEXT, ext TEXT, path TEXT, size INTEGER, updated INTEGER, content TEXT)"); err != nil {
		t.Fatal(err)
	}
	IndexAssetContentsQueue([]*AssetContent{{ID: "first", Path: "assets/test.txt", Content: "content"}})
	if err := FlushAssetContentQueue(); err != nil {
		t.Fatal(err)
	}
	IndexAssetContentsQueue([]*AssetContent{{ID: "first", Path: "assets/duplicate.txt"}})
	if err := FlushAssetContentQueue(); err == nil {
		t.Fatal("failed write reported success")
	}
	var count int
	if err := testDB.QueryRow("SELECT COUNT(*) FROM asset_contents_fts_case_insensitive").Scan(&count); err != nil || count != 1 {
		t.Fatalf("failed write damaged committed data: count=%d err=%v", count, err)
	}
	DeleteAssetContentsByPathQueue("assets/test.txt")
	if err := FlushAssetContentQueue(); err != nil {
		t.Fatal(err)
	}
	if err := testDB.Close(); err != nil {
		t.Fatal(err)
	}
	IndexAssetContentsQueue([]*AssetContent{{ID: "closed"}})
	if err := FlushAssetContentQueue(); err == nil {
		t.Fatal("closed database reported success")
	}
	assetContentDB = nil
	IndexAssetContentsQueue([]*AssetContent{{ID: "missing"}})
	if err := FlushAssetContentQueue(); err == nil {
		t.Fatal("unavailable database reported success")
	}
}

func TestAssetContentQueueReportsShutdown(t *testing.T) {
	testDB, err := gosql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	previousDB, previousQueue, previousExiting := assetContentDB, assetContentOperationQueue, util.IsExiting.Load()
	assetContentDB, assetContentOperationQueue = testDB, nil
	t.Cleanup(func() {
		_ = testDB.Close()
		assetContentDB, assetContentOperationQueue = previousDB, previousQueue
		util.IsExiting.Store(previousExiting)
	})
	util.IsExiting.Store(true)
	IndexAssetContentsQueue([]*AssetContent{{ID: "shutdown"}})
	if err := FlushAssetContentQueue(); err == nil {
		t.Fatal("interrupted indexing reported success")
	}
}
