#!/usr/bin/env python3
"""打包安卓资源 app.zip（appearance、guide、stage、changelogs + LICENSE、THIRD_PARTY_NOTICES.md）。

CI 使用 zip 命令；Windows 本机没有 zip 命令，而 Git Bash 的 `tar -a -cf app.zip`
产出的是 tar 数据（GNU tar 不支持 zip），内核解压时会 panic：zip: not a valid zip file。
必须用这个脚本或 CI 的 zip 命令生成。

用法：在 app/ 目录执行
    python ../scripts/pack-app-zip.py <输出路径，默认 ../siyuan-android/app/src/main/assets/app.zip>
"""

import os
import sys
import zipfile

APP_DIR = os.path.dirname(os.path.abspath(__file__)) and os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "app")
TOP_ENTRIES = ["appearance", "guide", "stage", "changelogs"]
ROOT_FILES = ["LICENSE", "THIRD_PARTY_NOTICES.md"]


def main() -> int:
    output = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.dirname(APP_DIR), "siyuan-android", "app", "src", "main", "assets", "app.zip")
    if os.path.exists(output):
        os.remove(output)
    os.makedirs(os.path.dirname(output), exist_ok=True)

    count = 0
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
        for top in TOP_ENTRIES:
            for root, dirs, files in os.walk(os.path.join(APP_DIR, top)):
                dirs.sort()
                for name in sorted(files):
                    full = os.path.join(root, name)
                    archive.write(full, os.path.relpath(full, APP_DIR).replace(os.sep, "/"))
                    count += 1
        for name in ROOT_FILES:
            archive.write(os.path.join(APP_DIR, "..", name), name)
            count += 1

    with zipfile.ZipFile(output) as archive:
        bad = archive.testzip()
        if bad is not None:
            print(f"校验失败：{bad}", file=sys.stderr)
            return 1
    print(f"app.zip 已生成：{output}（{count} 个条目，{os.path.getsize(output)} 字节，校验通过）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
