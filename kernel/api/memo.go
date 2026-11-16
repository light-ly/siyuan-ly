// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
)

var getDocMemos = contractHandler(apicontract.GetDocMemos, func(c *gin.Context, request apicontract.GetDocMemosRequest) apicontract.Response[[]*apicontract.DocMemo] {
	return apicontract.Success(model.GetDocMemos(request.ID))
})
