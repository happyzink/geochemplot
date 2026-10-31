"""下载随包分发的中文字体（OFL 许可，可再分发）。

导出中文（轴标题/注释/图层名）时 matplotlib 需要 CJK 字形。开发机通常有
微软雅黑/宋体，但极简 Linux 容器没有；把字体放进
`backend/app/renderers/fonts/` 后，渲染器会自动注册并纳入字体回退链。

用法（一次性，需联网）：
    d:\\moon\\backend\\.venv\\Scripts\\python.exe scripts/fetch_cjk_font.py

字体：Noto Sans CJK SC Regular（SIL Open Font License 1.1）
来源：https://github.com/notofonts/noto-cjk
"""
from __future__ import annotations

import sys
from pathlib import Path

import httpx

TARGET_DIR = Path(__file__).resolve().parent.parent / "backend" / "app" / "renderers" / "fonts"
FONT_NAME = "NotoSansCJKsc-Regular.otf"
SOURCES = (
    "https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf",
    "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf",
)
LICENSE_SOURCES = (
    "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/LICENSE",
    "https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/LICENSE",
)
MIN_BYTES = 5 * 1024 * 1024  # CJK 字体至少数 MB，过小视为失败


def _download(urls: tuple[str, ...], dest: Path, min_bytes: int) -> bool:
    for url in urls:
        try:
            resp = httpx.get(url, timeout=120, follow_redirects=True)
        except Exception as exc:  # 网络失败换下一个源
            print(f"  失败 {url.split('/')[2]}: {exc}")
            continue
        if resp.status_code != 200 or len(resp.content) < min_bytes:
            print(f"  失败 {url.split('/')[2]}: status={resp.status_code} size={len(resp.content)}")
            continue
        dest.write_bytes(resp.content)
        print(f"  已写入 {dest.name}（{len(resp.content) / 1024 / 1024:.1f} MB）")
        return True
    return False


def main() -> int:
    TARGET_DIR.mkdir(parents=True, exist_ok=True)
    font_path = TARGET_DIR / FONT_NAME
    if font_path.exists():
        print(f"字体已存在：{font_path}")
        return 0

    print("下载 Noto Sans CJK SC（OFL 1.1）…")
    if not _download(SOURCES, font_path, MIN_BYTES):
        print("下载失败：请检查网络，或手动把任意 CJK 字体（ttf/otf/ttc）放入", TARGET_DIR)
        return 1

    license_path = TARGET_DIR / "OFL.txt"
    if not license_path.exists():
        _download(LICENSE_SOURCES, license_path, 1024)

    # 校验确实是 matplotlib 能识别的字体
    from matplotlib import font_manager

    try:
        family = font_manager.FontProperties(fname=str(font_path)).get_name()
    except Exception as exc:
        print("字体校验失败：", exc)
        return 1
    print(f"完成：family={family}，渲染器会自动注册该字体")
    return 0


if __name__ == "__main__":
    sys.exit(main())
