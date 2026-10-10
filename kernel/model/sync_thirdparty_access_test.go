package model

import (
	"bytes"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// prepareThirdPartySyncTest 用可写的临时配置目录替换全局 Conf，避免 Save 写入仓库。
func prepareThirdPartySyncTest(t *testing.T) {
	t.Helper()
	originalConf := Conf
	originalConfDir := util.ConfDir
	originalErrCount := autoSyncErrCount
	t.Cleanup(func() {
		Conf = originalConf
		util.ConfDir = originalConfDir
		autoSyncErrCount = originalErrCount
	})
	util.ConfDir = t.TempDir()
	autoSyncErrCount = 0
	Conf = NewAppConf()
	Conf.Sync, Conf.Repo, Conf.System = conf.NewSync(), conf.NewRepo(), conf.NewSystem()
	Conf.Sync.CloudName = "main"
	Conf.Sync.Enabled = true
	Conf.Repo.Key = []byte("0123456789abcdef0123456789abcdef")
}

func TestCheckSyncThirdPartyWithoutUser(t *testing.T) {
	for _, provider := range []int{conf.ProviderS3, conf.ProviderWebDAV, conf.ProviderLocal} {
		t.Run(conf.ProviderToStr(provider), func(t *testing.T) {
			prepareThirdPartySyncTest(t)
			Conf.Sync.Provider = provider
			key := append([]byte(nil), Conf.Repo.Key...)
			if !checkSync(false, false, true) {
				t.Fatal("third-party sync must start without a user")
			}
			if !Conf.Sync.Enabled || Conf.Sync.Provider != provider || Conf.Sync.CloudName != "main" {
				t.Fatal("third-party sync changed the enabled flag, provider or cloud name")
			}
			if !bytes.Equal(Conf.Repo.Key, key) {
				t.Fatal("third-party sync changed the repository key")
			}
		})
	}
}

func TestCheckSyncStopsSiYuanAndPreservesConfig(t *testing.T) {
	for _, storedUser := range []bool{true, false} {
		t.Run(map[bool]string{true: "with-user", false: "without-user"}[storedUser], func(t *testing.T) {
			prepareThirdPartySyncTest(t)
			Conf.Sync.Provider = conf.ProviderSiYuan
			Conf.Sync.CloudName = "official"
			Conf.Sync.Mode = 2
			Conf.Sync.Synced = 12345
			Conf.Sync.S3 = &conf.S3{Endpoint: "https://s3.example.com", Bucket: "notes"}
			Conf.Sync.WebDAV = &conf.WebDAV{Endpoint: "https://dav.example.com", Username: "dav-user"}
			Conf.Sync.Local = &conf.Local{Endpoint: "/tmp/local-sync-dir"}
			key := append([]byte(nil), Conf.Repo.Key...)
			if storedUser {
				Conf.SetUser(&conf.User{UserId: "official-user", UserName: "tester"})
			} else {
				Conf.SetUser(nil)
			}

			if checkSync(false, false, true) {
				t.Fatal("official cloud sync must be stopped")
			}
			if Conf.Sync.Enabled {
				t.Fatal("official cloud sync left the enabled flag on")
			}
			if storedUser != (Conf.GetUser() != nil) {
				t.Fatal("official cloud sync changed the stored user")
			}
			if Conf.Sync.CloudName != "official" || Conf.Sync.Mode != 2 || Conf.Sync.Synced != 12345 {
				t.Fatal("official cloud sync changed unrelated sync settings")
			}
			if Conf.Sync.S3 == nil || Conf.Sync.S3.Bucket != "notes" ||
				Conf.Sync.WebDAV == nil || Conf.Sync.WebDAV.Username != "dav-user" ||
				Conf.Sync.Local == nil || Conf.Sync.Local.Endpoint != "/tmp/local-sync-dir" {
				t.Fatal("official cloud sync removed third-party storage settings")
			}
			if !bytes.Equal(Conf.Repo.Key, key) {
				t.Fatal("official cloud sync changed the repository key")
			}
		})
	}
}

func TestAssetDownloadAccessWithoutUser(t *testing.T) {
	prepareThirdPartySyncTest(t)
	Conf.Sync.Provider = conf.ProviderLocal
	Conf.SetUser(nil)
	if err := checkAssetDownloadAccess(); err != nil {
		t.Fatalf("third-party asset download must not require an account: %v", err)
	}
	Conf.Sync.Enabled = false
	if err := checkAssetDownloadAccess(); err == nil {
		t.Fatal("asset download allowed while sync is disabled")
	}
	Conf.Sync.Enabled = true
	Conf.Sync.Provider = conf.ProviderSiYuan
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
	Conf.Sync.Provider = conf.ProviderSiYuan
	key := append([]byte(nil), Conf.Repo.Key...)
	if err := DownloadCloudSnapshot("", "any-index-id"); err != nil {
		t.Fatalf("official cloud snapshot download must be refused cleanly: %v", err)
	}
	if !bytes.Equal(Conf.Repo.Key, key) || Conf.Sync.CloudName != "main" {
		t.Fatal("refused official cloud operation changed the configuration")
	}
}
