package model

import (
	"bytes"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// prepareThirdPartySyncTest 用可写的临时配置目录替换全局 Conf，避免 Save 写入仓库。
func prepareThirdPartySyncTest(t *testing.T) {
	t.Helper()
	originalConf := Conf
	originalConfDir := util.ConfDir
	originalErrCount := autoSyncErrCount.Load()
	t.Cleanup(func() {
		Conf = originalConf
		util.ConfDir = originalConfDir
		autoSyncErrCount.Store(originalErrCount)
	})
	util.ConfDir = t.TempDir()
	autoSyncErrCount.Store(0)
	Conf = NewAppConf()
	Conf.Sync.Store(conf.NewSync())
	Conf.Repo.Store(conf.NewRepo())
	Conf.System.Store(conf.NewSystem())
	confSync := Conf.Sync.Load()
	confSync.CloudName = "main"
	confSync.Enabled = true
	Conf.Repo.Load().Key = []byte("0123456789abcdef0123456789abcdef")
}

func TestCheckSyncThirdPartyWithoutUser(t *testing.T) {
	for _, provider := range []int{conf.ProviderS3, conf.ProviderWebDAV, conf.ProviderLocal} {
		t.Run(conf.ProviderToStr(provider), func(t *testing.T) {
			prepareThirdPartySyncTest(t)
			Conf.Sync.Load().Provider = provider
			key := append([]byte(nil), Conf.Repo.Load().Key...)
			if !checkSync(false, false, true) {
				t.Fatal("third-party sync must start without a user")
			}
			syncSnapshot := Conf.Sync.Load()
			if !syncSnapshot.Enabled || syncSnapshot.Provider != provider || syncSnapshot.CloudName != "main" {
				t.Fatal("third-party sync changed the enabled flag, provider or cloud name")
			}
			if !bytes.Equal(Conf.Repo.Load().Key, key) {
				t.Fatal("third-party sync changed the repository key")
			}
		})
	}
}

func TestCheckSyncStopsSiYuanAndPreservesConfig(t *testing.T) {
	for _, storedUser := range []bool{true, false} {
		t.Run(map[bool]string{true: "with-user", false: "without-user"}[storedUser], func(t *testing.T) {
			prepareThirdPartySyncTest(t)
			officialSync := Conf.Sync.Load()
			officialSync.Provider = conf.ProviderSiYuan
			officialSync.CloudName = "official"
			officialSync.Mode = 2
			officialSync.Synced = 12345
			officialSync.S3 = &conf.S3{Endpoint: "https://s3.example.com", Bucket: "notes"}
			officialSync.WebDAV = &conf.WebDAV{Endpoint: "https://dav.example.com", Username: "dav-user"}
			officialSync.Local = &conf.Local{Endpoint: "/tmp/local-sync-dir"}
			key := append([]byte(nil), Conf.Repo.Load().Key...)
			if storedUser {
				Conf.SetUser(&conf.User{UserId: "official-user", UserName: "tester"})
			} else {
				Conf.SetUser(nil)
			}

			if checkSync(false, false, true) {
				t.Fatal("official cloud sync must be stopped")
			}
			if Conf.Sync.Load().Enabled {
				t.Fatal("official cloud sync left the enabled flag on")
			}
			if storedUser != (Conf.GetUser() != nil) {
				t.Fatal("official cloud sync changed the stored user")
			}
			officialSnapshot := Conf.Sync.Load()
			if officialSnapshot.CloudName != "official" || officialSnapshot.Mode != 2 || officialSnapshot.Synced != 12345 {
				t.Fatal("official cloud sync changed unrelated sync settings")
			}
			// 配置段更新会经过规范化（端点补全、路径规整），断言保留关键信息而非精确相等
			if officialSnapshot.S3 == nil || officialSnapshot.S3.Bucket != "notes" ||
				!strings.Contains(officialSnapshot.S3.Endpoint, "s3.example.com") ||
				officialSnapshot.WebDAV == nil || officialSnapshot.WebDAV.Username != "dav-user" ||
				!strings.Contains(officialSnapshot.WebDAV.Endpoint, "dav.example.com") ||
				officialSnapshot.Local == nil || !strings.Contains(officialSnapshot.Local.Endpoint, "local-sync-dir") {
				t.Fatal("official cloud sync removed third-party storage settings")
			}
			if !bytes.Equal(Conf.Repo.Load().Key, key) {
				t.Fatal("official cloud sync changed the repository key")
			}
		})
	}
}

func TestAssetDownloadAccessWithoutUser(t *testing.T) {
	prepareThirdPartySyncTest(t)
	Conf.Sync.Load().Provider = conf.ProviderLocal
	Conf.SetUser(nil)
	if err := checkAssetDownloadAccess(); err != nil {
		t.Fatalf("third-party asset download must not require an account: %v", err)
	}
	Conf.Sync.Load().Enabled = false
	if err := checkAssetDownloadAccess(); err == nil {
		t.Fatal("asset download allowed while sync is disabled")
	}
	Conf.Sync.Load().Enabled = true
	Conf.Sync.Load().Provider = conf.ProviderSiYuan
	if err := checkAssetDownloadAccess(); err == nil {
		t.Fatal("asset download allowed for the disabled official cloud")
	}
}

func TestCloudSnapshotOperationAllowsThirdPartyWithoutUser(t *testing.T) {
	prepareAssetDownloadRepoTest(t)
	Conf.SetUser(nil)
	// 旧实现在账号校验处直接返回 nil，新实现应进入仓库逻辑并报告索引不存在
	if err := DownloadCloudSnapshot("", "missing-index-id"); err == nil {
		t.Fatal("third-party snapshot download did not reach the repository")
	}
}

func TestCloudSnapshotOperationStopsSiYuan(t *testing.T) {
	prepareThirdPartySyncTest(t)
	Conf.Sync.Load().Provider = conf.ProviderSiYuan
	key := append([]byte(nil), Conf.Repo.Load().Key...)
	if err := DownloadCloudSnapshot("", "any-index-id"); err != nil {
		t.Fatalf("official cloud snapshot download must be refused cleanly: %v", err)
	}
	if !bytes.Equal(Conf.Repo.Load().Key, key) || Conf.Sync.Load().CloudName != "main" {
		t.Fatal("refused official cloud operation changed the configuration")
	}
}
