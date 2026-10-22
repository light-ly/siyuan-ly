// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

// Package mobilediag 在移动端内核最早初始化点接管标准错误。
// 仅当容器在 Application.onCreate 写入标志文件（调试构建）时生效，正式构建不写标志即保持关闭。
// 放在独立包且仅依赖标准库，保证其 init 先于内核其他包执行，从而接住包初始化阶段的致命错误。
package mobilediag

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/unix"
)

// defaultExternalFilesDir 是官方包名的外部文件目录；标志文件内容优先，兼容调试包名后缀。
const defaultExternalFilesDir = "/storage/emulated/0/Android/data/org.b3log.siyuan/files"

// flagCandidates 列出可能的标志文件位置；调试包包名带 .debug 后缀，逐一探测自身目录，避免目录列举权限问题。
var flagCandidates = []string{
	"/storage/emulated/0/Android/data/org.b3log.siyuan.debug/files/.stderr-redirect",
	"/storage/emulated/0/Android/data/org.b3log.siyuan/files/.stderr-redirect",
}

// externalFilesDir 探测容器在 Application.onCreate 写入的标志文件，以标志文件内容作为实际外部文件目录。
func externalFilesDir() string {
	for _, candidate := range flagCandidates {
		if data, err := os.ReadFile(candidate); err == nil {
			if dir := strings.TrimSpace(string(data)); dir != "" {
				return dir
			}
			return filepath.Dir(candidate)
		}
	}
	return defaultExternalFilesDir
}

// step 记录初始化进度到用户可见目录和进程缓存目录，保证至少一侧留痕。
func step(format string, args ...any) {
	msg := fmt.Sprintf(format, args...)
	for _, dir := range []string{externalFilesDir(), os.TempDir()} {
		f, err := os.OpenFile(filepath.Join(dir, "mobilediag-step.txt"),
			os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
		if err != nil {
			continue
		}
		fmt.Fprintf(f, "%s\n", msg)
		f.Close()
	}
}

func init() {
	step("0 init entered, pid=%d, base=%q", os.Getpid(), externalFilesDir())
	if _, err := os.Stat(filepath.Join(externalFilesDir(), ".stderr-redirect")); err != nil {
		step("1 flag missing: %v", err)
		return
	}
	step("1 flag found")
	stderrPath := filepath.Join(externalFilesDir(), "home", ".config", "siyuan", "kernel-stderr.log")
	if err := os.MkdirAll(filepath.Dir(stderrPath), 0755); err != nil {
		step("2 mkdir failed: %v", err)
		return
	}
	step("2 mkdir ok")
	f, err := os.OpenFile(stderrPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		step("3 open failed: %v", err)
		return
	}
	step("3 open ok")
	// Go 运行时致命输出绕过 os.Stderr 直接写 fd 2，复制文件描述符接管标准错误。
	// unix.Dup2 在 arm64 下内部使用 dup3。
	_ = unix.Dup2(int(f.Fd()), 2)
	step("4 dup2 done")
}
