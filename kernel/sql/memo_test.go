// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	gosql "database/sql"
	"testing"
)

// TestQueryDocMemos 验证只返回文档内备注非空的块，文档块自身和无备注块被排除，结果按插入顺序排列。
func TestQueryDocMemos(t *testing.T) {
	testDB, err := gosql.Open("sqlite3_extended", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	testDB.SetMaxOpenConns(1)
	previous := db
	db = testDB
	t.Cleanup(func() { db = previous; testDB.Close() })

	if _, err = testDB.Exec("CREATE TABLE blocks (id, parent_id, root_id, hash, box, path, hpath, name, alias, memo, tag, content, fcontent, markdown, length, type, subtype, ial, sort, created, updated)"); err != nil {
		t.Fatal(err)
	}
	insert := func(id, rootID, memo, content, typ, subtype string) {
		t.Helper()
		if _, err = testDB.Exec("INSERT INTO blocks (id, root_id, memo, content, type, subtype) VALUES (?, ?, ?, ?, ?, ?)", id, rootID, memo, content, typ, subtype); err != nil {
			t.Fatal(err)
		}
	}
	insert("doc", "doc", "文档自身的备注", "文档", "d", "")
	insert("empty", "doc", "", "没有备注", "p", "")
	insert("later", "doc", "后插入的备注", "后出现的段落", "p", "")
	insert("first", "doc", "第一条备注", "先出现的标题", "h", "h1")
	insert("other", "other-doc", "别的文档", "别的文档的段落", "p", "")

	got := QueryDocMemos("doc")
	if len(got) != 2 || got[0].ID != "later" || got[1].ID != "first" {
		t.Fatalf("unexpected memos: %#v", got)
	}
	if got[1].Memo != "第一条备注" || got[1].Type != "h" || got[1].SubType != "h1" || got[1].Content != "先出现的标题" {
		t.Fatalf("memo fields changed: %#v", got[1])
	}
	if got := QueryDocMemos("missing"); len(got) != 0 {
		t.Fatalf("missing document returned memos: %#v", got)
	}
}
