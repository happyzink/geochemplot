"""GeoPlot 桌面启动入口（PyInstaller 单文件 exe 的入口脚本）。

职责：准备可写数据目录 → 选空闲端口 → 启动内置 FastAPI 服务 → 自动打开浏览器。
关闭控制台窗口即停止服务。
"""
from __future__ import annotations

import argparse
import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

APP_NAME = "GeoPlot"
DEFAULT_PORT = 8765
PORT_TRIES = 20


def writable_data_dir() -> Path:
    """数据库/导出/项目落在用户可写目录，避免装在 Program Files 时只读失败。"""
    override = os.environ.get("GEOPLOT_DATA_DIR")
    if override:
        base = Path(override)
    elif sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home())) / APP_NAME
    else:
        base = Path.home() / ".geoplot"
    base.mkdir(parents=True, exist_ok=True)
    return base


def pick_port(preferred: int) -> int:
    for port in range(preferred, preferred + PORT_TRIES):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise SystemExit(f"端口 {preferred}-{preferred + PORT_TRIES - 1} 全部被占用")


def open_browser_when_ready(url: str) -> None:
    for _ in range(60):
        try:
            with urllib.request.urlopen(f"{url}/health", timeout=2) as resp:
                if resp.status == 200:
                    webbrowser.open(url)
                    return
        except (urllib.error.URLError, OSError):
            pass
        time.sleep(0.5)


def main() -> None:
    parser = argparse.ArgumentParser(description="GeoPlot 启动器")
    parser.add_argument("--port", type=int, default=int(os.environ.get("GEOPLOT_PORT", DEFAULT_PORT)))
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    data_dir = writable_data_dir()
    os.chdir(data_dir)
    port = pick_port(args.port)
    url = f"http://127.0.0.1:{port}"
    os.environ.setdefault("GEOPLOT_BASE_URL", url)

    print(f"{APP_NAME} 数据目录: {data_dir}")
    print(f"{APP_NAME} 服务地址: {url}")
    print("浏览器会自动打开；关闭此窗口即退出程序。", flush=True)

    if not args.no_browser:
        threading.Thread(target=open_browser_when_ready, args=(url,), daemon=True).start()

    import uvicorn

    from app.main import app

    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info", access_log=False)


if __name__ == "__main__":
    main()
