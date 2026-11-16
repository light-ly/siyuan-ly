// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import "github.com/siyuan-note/logging"

// QueryDocMemos 返回文档内设置了备注的块，排除文档块自身，按文档顺序排列。
// 查不到或出错时返回空切片。
func QueryDocMemos(rootID string) (ret []*Block) {
	ret = []*Block{}
	stmt := "SELECT id, memo, type, subtype, content FROM blocks WHERE root_id = ? AND memo <> '' AND type <> 'd' ORDER BY rowid ASC"
	rows, err := query(stmt, rootID)
	if err != nil {
		logging.LogWarnf("sql query [%s] failed: %s", stmt, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		block := &Block{}
		if err = rows.Scan(&block.ID, &block.Memo, &block.Type, &block.SubType, &block.Content); err != nil {
			logging.LogWarnf("query doc memos scan field failed: %s", err)
			return []*Block{}
		}
		ret = append(ret, block)
	}
	return
}
