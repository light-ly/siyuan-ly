// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

// DocMemo 是文档内带备注块的摘要。
type DocMemo struct {
	ID string `json:"id"`
	// Memo 是块的备注属性原文。
	Memo string `json:"memo"`
	Type string `json:"type"`
	// SubType 是块子类型，例如列表的有序与无序。
	SubType string `json:"subType"`
	// Content 是块文本预览。
	Content string `json:"content"`
}

// GetDocMemosRequest 指定要查询的文档块 ID。
type GetDocMemosRequest struct {
	// ID 是文档块 ID。
	ID string `json:"id"`
}
