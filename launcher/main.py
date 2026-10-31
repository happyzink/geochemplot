"""GeoPlot Launcher - Tkinter GUI for starting/stopping the backend server.

This becomes GeoPlotLauncher.exe when packaged with PyInstaller.
"""
from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import threading
import time
import uuid
import webbrowser
from pathlib import Path
from tkinter import Tk, Frame, Label, Button, Text, Scrollbar, END, DISABLED, NORMAL, LEFT, RIGHT, TOP, BOTTOM, X, Y, BOTH, W, E, N, S

APP_NAME = "GeoPlot"
APP_VERSION = "1.0.0"
DEFAULT_PORT = 8765
MAX_PORT_TRIES = 20
HEALTH_TIMEOUT = 30


def get_base_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return Path(__file__).parent.parent


def get_app_dir() -> Path:
    base = get_base_dir()
    if getattr(sys, "frozen", False):
        return base / "app"
    return base / "backend"


def get_server_exe() -> Path:
    app_dir = get_app_dir()
    if getattr(sys, "frozen", False):
        exe = app_dir / "GeoPlotServer.exe"
        if exe.exists():
            return exe
    venv_python = app_dir / ".venv" / "Scripts" / "python.exe"
    if venv_python.exists():
        return venv_python
    python = app_dir / ".." / ".venv" / "Scripts" / "python.exe"
    if python.exists():
        return python
    return Path(sys.executable)


class LauncherState:
    NOT_STARTED = "not_started"
    STARTING = "starting"
    RUNNING = "running"
    STOPPING = "stopping"
    STOPPED = "stopped"
    FAILED = "failed"


class GeoPlotLauncher:
    def __init__(self):
        self.root = Tk()
        self.root.title(f"{APP_NAME} {APP_VERSION}")
        self.root.geometry("500x400")
        self.root.resizable(True, True)

        self.state = LauncherState.NOT_STARTED
        self.process = None
        self.port = DEFAULT_PORT
        self.instance_id = uuid.uuid4().hex[:16]
        self.base_url = f"http://127.0.0.1:{self.port}"
        self.log_lines = []

        self._build_ui()
        self._update_status()

    def _build_ui(self):
        header = Frame(self.root)
        header.pack(fill=X, padx=10, pady=(10, 5))
        Label(header, text=f"{APP_NAME} v{APP_VERSION}", font=("Arial", 14, "bold")).pack(side=LEFT)

        status_frame = Frame(self.root)
        status_frame.pack(fill=X, padx=10, pady=5)
        Label(status_frame, text="Status:").pack(side=LEFT)
        self.status_label = Label(status_frame, text=self.state, fg="gray")
        self.status_label.pack(side=LEFT, padx=5)
        self.url_label = Label(status_frame, text=self.base_url, fg="blue")
        self.url_label.pack(side=LEFT, padx=5)

        btn_frame = Frame(self.root)
        btn_frame.pack(fill=X, padx=10, pady=5)

        self.start_btn = Button(btn_frame, text="Start Server", command=self._on_start,
                               width=18, bg="#4CAF50", fg="white")
        self.start_btn.pack(side=LEFT, padx=5)

        self.stop_btn = Button(btn_frame, text="Stop Server", command=self._on_stop,
                              width=18, bg="#f44336", fg="white", state=DISABLED)
        self.stop_btn.pack(side=LEFT, padx=5)

        self.browser_btn = Button(btn_frame, text="Open in Browser", command=self._on_open_browser,
                                 width=18, bg="#2196F3", fg="white", state=DISABLED)
        self.browser_btn.pack(side=LEFT, padx=5)

        log_frame = Frame(self.root)
        log_frame.pack(fill=BOTH, expand=True, padx=10, pady=5)
        Label(log_frame, text="Log:").pack(anchor=W)
        self.log_text = Text(log_frame, height=10, state=DISABLED, wrap="word")
        scrollbar = Scrollbar(log_frame, command=self.log_text.yview)
        self.log_text.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side=RIGHT, fill=Y)
        self.log_text.pack(fill=BOTH, expand=True)

    def _log(self, msg: str):
        self.log_lines.append(msg)
        self.log_text.configure(state=NORMAL)
        self.log_text.insert(END, msg + "\n")
        self.log_text.see(END)
        self.log_text.configure(state=DISABLED)

    def _update_status(self):
        colors = {
            LauncherState.NOT_STARTED: "gray",
            LauncherState.STARTING: "orange",
            LauncherState.RUNNING: "green",
            LauncherState.STOPPING: "orange",
            LauncherState.STOPPED: "gray",
            LauncherState.FAILED: "red",
        }
        self.status_label.config(text=self.state, fg=colors.get(self.state, "gray"))
        self.url_label.config(text=self.base_url)

        if self.state == LauncherState.RUNNING:
            self.start_btn.config(state=DISABLED)
            self.stop_btn.config(state=NORMAL)
            self.browser_btn.config(state=NORMAL)
        elif self.state in (LauncherState.NOT_STARTED, LauncherState.STOPPED, LauncherState.FAILED):
            self.start_btn.config(state=NORMAL)
            self.stop_btn.config(state=DISABLED)
            self.browser_btn.config(state=DISABLED)
        else:
            self.start_btn.config(state=DISABLED)
            self.stop_btn.config(state=DISABLED)
            self.browser_btn.config(state=DISABLED)

        self.root.after(500, self._update_status)

    def _on_start(self):
        if self.state == LauncherState.RUNNING:
            self._on_open_browser()
            return
        if self.state != LauncherState.NOT_STARTED and self.state != LauncherState.STOPPED and self.state != LauncherState.FAILED:
            return
        self.state = LauncherState.STARTING
        self._update_status()
        self._log("Starting server...")
        threading.Thread(target=self._start_server, daemon=True).start()

    def _start_server(self):
        server_exe = get_server_exe()
        app_dir = get_app_dir()

        env = os.environ.copy()
        env.pop("PYTHONHOME", None)
        env.pop("PYTHONPATH", None)

        for port in range(DEFAULT_PORT, DEFAULT_PORT + MAX_PORT_TRIES):
            self.port = port
            self.base_url = f"http://127.0.0.1:{port}"
            try:
                if str(server_exe).endswith(".exe") and "GeoPlotServer" in str(server_exe):
                    cmd = [str(server_exe)]
                else:
                    cmd = [str(server_exe), "-m", "uvicorn", "app.main:app",
                           "--host", "127.0.0.1", "--port", str(port)]

                self.process = subprocess.Popen(
                    cmd,
                    cwd=str(app_dir),
                    env=env,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
                )

                self._log(f"Server process started (PID={self.process.pid}, port={port})")

                if self._wait_for_health(port):
                    self.state = LauncherState.RUNNING
                    self._log(f"Server running at {self.base_url}")
                    webbrowser.open(self.base_url + "/api/docs")
                    return
                else:
                    self._log("Health check failed, trying next port...")
                    self._stop_process()

            except Exception as e:
                self._log(f"Port {port} failed: {e}")
                self._stop_process()

        self.state = LauncherState.FAILED
        self._log("Failed to start server on any port")
        self._update_status()

    def _wait_for_health(self, port: int) -> bool:
        import urllib.request
        import urllib.error
        url = f"http://127.0.0.1:{port}/health"
        start = time.time()
        while time.time() - start < HEALTH_TIMEOUT:
            if self.process and self.process.poll() is not None:
                return False
            try:
                req = urllib.request.urlopen(url, timeout=2)
                data = json.loads(req.read())
                if data.get("status") == "ok":
                    return True
            except (urllib.error.URLError, ConnectionRefusedError, OSError):
                pass
            time.sleep(0.5)
        return False

    def _on_stop(self):
        if self.state != LauncherState.RUNNING:
            return
        self.state = LauncherState.STOPPING
        self._update_status()
        self._log("Stopping server...")
        threading.Thread(target=self._stop_server, daemon=True).start()

    def _stop_server(self):
        self._stop_process()
        self.state = LauncherState.STOPPED
        self._log("Server stopped")
        self._update_status()

    def _stop_process(self):
        if self.process:
            try:
                if sys.platform == "win32":
                    self.process.terminate()
                else:
                    os.kill(self.process.pid, signal.SIGTERM)
                self.process.wait(timeout=5)
            except Exception:
                try:
                    self.process.kill()
                except Exception:
                    pass
            self.process = None

    def _on_open_browser(self):
        if self.state == LauncherState.RUNNING:
            webbrowser.open(self.base_url + "/api/docs")

    def run(self):
        self._log(f"{APP_NAME} Launcher v{APP_VERSION}")
        self._log(f"Instance: {self.instance_id}")
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)
        self.root.mainloop()

    def _on_close(self):
        if self.process:
            self._stop_process()
        self.root.destroy()


def main():
    launcher = GeoPlotLauncher()
    launcher.run()


if __name__ == "__main__":
    main()
