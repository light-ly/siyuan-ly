// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	"database/sql"
	"errors"
	"fmt"
	"runtime/debug"
	"sync"
	"time"

	"github.com/siyuan-note/eventbus"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var (
	assetContentOperationQueue []*assetContentDBQueueOperation
	assetContentDBQueueLock    = sync.Mutex{}
	assetContentTxLock         = sync.Mutex{}
)

type assetContentDBQueueOperation struct {
	inQueueTime time.Time
	action      string // index/deletePath

	assetContents []*AssetContent // index
	path          string          // deletePath
}

func FlushAssetContentTxJob() {
	task.AppendTask(task.AssetContentDatabaseIndexCommit, FlushAssetContentQueue)
}

func FlushAssetContentQueue() error {
	assetContentTxLock.Lock()
	defer assetContentTxLock.Unlock()
	ops := getAssetContentOperations()
	total := len(ops)
	if 1 > total {
		return nil
	}

	if assetContentDB == nil {
		return errors.New("asset content database is unavailable")
	}
	start := time.Now()

	groupOpsTotal := map[string]int{}
	for _, op := range ops {
		groupOpsTotal[op.action]++
	}

	context := map[string]any{eventbus.CtxPushMsg: eventbus.CtxPushMsgToStatusBar}
	groupOpsCurrent := map[string]int{}
	for i, op := range ops {
		if util.IsExiting.Load() {
			return errors.New("asset content indexing interrupted by shutdown")
		}

		tx, err := beginAssetContentTx()
		if err != nil {
			return err
		}

		groupOpsCurrent[op.action]++
		context["current"] = groupOpsCurrent[op.action]
		context["total"] = groupOpsTotal[op.action]

		if err = execAssetContentOp(op, tx, context); err != nil {
			tx.Rollback()
			logging.LogErrorf("queue operation failed: %s", err)
			eventbus.Publish(util.EvtSQLAssetContentRebuild)
			return err
		}

		if err = commitTx(tx); err != nil {
			logging.LogErrorf("commit tx failed: %s", err)
			return err
		}

		if 16 < i && 0 == i%128 {
			debug.FreeOSMemory()
		}
	}

	if 128 < total {
		debug.FreeOSMemory()
	}

	elapsed := time.Since(start).Milliseconds()
	if 7000 < elapsed {
		logging.LogInfof("database asset content op tx [%dms]", elapsed)
	}
	return nil
}

func execAssetContentOp(op *assetContentDBQueueOperation, tx *sql.Tx, context map[string]any) (err error) {
	switch op.action {
	case "index":
		err = insertAssetContents(tx, op.assetContents, context)
	case "deletePath":
		err = deleteAssetContentsByPath(tx, op.path)
	default:
		msg := fmt.Sprintf("unknown asset content operation [%s]", op.action)
		logging.LogErrorf("%s", msg)
		err = errors.New(msg)
	}
	return
}

func DeleteAssetContentsByPathQueue(path string) {
	assetContentDBQueueLock.Lock()
	defer assetContentDBQueueLock.Unlock()

	newOp := &assetContentDBQueueOperation{inQueueTime: time.Now(), action: "deletePath", path: path}
	assetContentOperationQueue = append(assetContentOperationQueue, newOp)
}

func IndexAssetContentsQueue(assetContents []*AssetContent) {
	assetContentDBQueueLock.Lock()
	defer assetContentDBQueueLock.Unlock()

	newOp := &assetContentDBQueueOperation{inQueueTime: time.Now(), action: "index", assetContents: assetContents}
	assetContentOperationQueue = append(assetContentOperationQueue, newOp)
}

func getAssetContentOperations() (ops []*assetContentDBQueueOperation) {
	assetContentDBQueueLock.Lock()
	defer assetContentDBQueueLock.Unlock()

	ops = assetContentOperationQueue
	assetContentOperationQueue = nil
	return
}

// AssetContentOperationCountForTest 返回当前资源索引队列长度，供跨包回归测试断言入队行为。
func AssetContentOperationCountForTest() int {
	assetContentDBQueueLock.Lock()
	defer assetContentDBQueueLock.Unlock()
	return len(assetContentOperationQueue)
}

// DiscardAssetContentOperationsForTest 清空资源索引队列，供跨包回归测试隔离前后入队结果。
func DiscardAssetContentOperationsForTest() {
	getAssetContentOperations()
}

// UseInMemoryAssetContentDatabaseForTest 将资源内容数据库切换为内存库并建好 FTS 表，返回恢复函数。
func UseInMemoryAssetContentDatabaseForTest() (restore func()) {
	assetContentDBQueueLock.Lock()
	previousDB := assetContentDB
	previousQueue := assetContentOperationQueue
	assetContentOperationQueue = nil
	assetContentDBQueueLock.Unlock()

	testDB, err := sql.Open("sqlite3_extended", ":memory:")
	if err != nil {
		logging.LogErrorf("open in-memory asset content database failed: %s", err)
		return func() {}
	}
	if _, err = testDB.Exec("CREATE VIRTUAL TABLE asset_contents_fts_case_insensitive USING fts5(id UNINDEXED, name, ext, path, size UNINDEXED, updated UNINDEXED, content, tokenize=\"siyuan case_insensitive\")"); err != nil {
		logging.LogErrorf("create in-memory asset content fts table failed: %s", err)
	}
	assetContentDB = testDB

	return func() {
		assetContentDBQueueLock.Lock()
		assetContentOperationQueue = previousQueue
		assetContentDBQueueLock.Unlock()
		assetContentDB = previousDB
		if err := testDB.Close(); err != nil {
			logging.LogErrorf("close in-memory asset content database failed: %s", err)
		}
	}
}
