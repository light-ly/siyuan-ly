// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
)

func TestCheckSyncPreservesEnabledWithoutUser(t *testing.T) {
	originalConf := Conf
	Conf = NewAppConf()
	Conf.Sync.Store(conf.NewSync())
	confSync := Conf.Sync.Load()
	confSync.Provider = conf.ProviderS3
	confSync.Enabled = true
	t.Cleanup(func() {
		Conf = originalConf
	})

	// 第三方存储不依赖思源账号，无账号时同步应正常启动且开关保持不变
	if !checkSync(false, false, true) {
		t.Fatal("third-party sync must start without a user")
	}
	if !Conf.Sync.Load().Enabled {
		t.Fatal("sync configuration must remain enabled without a user")
	}
}
