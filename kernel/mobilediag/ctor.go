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

package mobilediag

/*
#include <fcntl.h>
#include <unistd.h>
#include <string.h>
#include <stdio.h>
#include <sys/stat.h>

static void mobilediag_mark(const char *base, const char *msg) {
	char path[768];
	snprintf(path, sizeof(path), "%s/mobilediag-step.txt", base);
	int fd = open(path, O_CREAT | O_APPEND | O_WRONLY, 0644);
	if (fd < 0) {
		return;
	}
	write(fd, msg, strlen(msg));
	close(fd);
}

// 库加载时即执行，先于 Go 运行时与全部包初始化，保证接管标准错误不依赖初始化顺序。
__attribute__((constructor)) static void mobilediag_ctor(void) {
	static const char *candidates[] = {
		"/storage/emulated/0/Android/data/org.b3log.siyuan.debug/files",
		"/storage/emulated/0/Android/data/org.b3log.siyuan/files",
	};
	for (int i = 0; i < 2; i++) {
		char flag[768];
		snprintf(flag, sizeof(flag), "%s/.stderr-redirect", candidates[i]);
		int in = open(flag, O_RDONLY);
		if (in < 0) {
			continue;
		}
		char base[512];
		ssize_t n = read(in, base, sizeof(base) - 1);
		close(in);
		if (n <= 0) {
			continue;
		}
		base[n] = 0;
		base[strcspn(base, "\r\n")] = 0;
		mobilediag_mark(base, "ctor: flag found\n");
		char logdir[640];
		snprintf(logdir, sizeof(logdir), "%s/home/.config/siyuan", base);
		for (char *p = logdir + 1; *p; p++) {
			if (*p == '/') {
				*p = 0;
				mkdir(logdir, 0755);
				*p = '/';
			}
		}
		mkdir(logdir, 0755);
		char logpath[768];
		snprintf(logpath, sizeof(logpath), "%s/kernel-stderr.log", logdir);
		int out = open(logpath, O_CREAT | O_TRUNC | O_WRONLY, 0644);
		if (out >= 0) {
			dup2(out, 2);
			close(out);
			mobilediag_mark(base, "ctor: stderr redirected\n");
		}
		return;
	}
	mobilediag_mark(candidates[0], "ctor: no flag\n");
}
*/
import "C"
