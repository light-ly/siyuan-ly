// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/sql"
)

// GetDocMemos 返回文档内所有设置了备注的块，不含文档块自身；没有结果时返回空数组。
func GetDocMemos(docID string) []*apicontract.DocMemo {
	blocks := sql.QueryDocMemos(docID)
	ret := make([]*apicontract.DocMemo, 0, len(blocks))
	for _, block := range blocks {
		ret = append(ret, &apicontract.DocMemo{
			ID:      block.ID,
			Memo:    block.Memo,
			Type:    block.Type,
			SubType: block.SubType,
			Content: block.Content,
		})
	}
	return ret
}
