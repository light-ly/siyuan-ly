// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestAPIContractGetDocMemos(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, body := range []string{`{"id":"20260101000000-abcdefg"}`, `{"id":"missing"}`} {
		engine := gin.New()
		engine.POST("/api/memo/getDocMemos", getDocMemos)
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/memo/getDocMemos", strings.NewReader(body)))
		requireAPIContract(t, "POST", "/api/memo/getDocMemos", recorder)
		if !strings.Contains(recorder.Body.String(), `"data":[]`) {
			t.Fatalf("empty memo result must be an array: %s", recorder.Body.String())
		}
	}
	engine := gin.New()
	engine.POST("/api/memo/getDocMemos", getDocMemos)
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/memo/getDocMemos", strings.NewReader(`{"id":1}`)))
	requireAPIContract(t, "POST", "/api/memo/getDocMemos", recorder)
	if !strings.Contains(recorder.Body.String(), `"code":-1`) {
		t.Fatalf("invalid request accepted: %s", recorder.Body.String())
	}
}
