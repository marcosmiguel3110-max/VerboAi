#!/usr/bin/env python3
import argparse
import hashlib
import http.server
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

VERSION = "1.0.0"
IGNORE_DIRS = {
    ".git",
    ".hg",
    ".svn",
    ".idea",
    ".vscode",
    ".venv",
    "__pycache__",
    "node_modules",
}
IGNORE_FILES = {"thumbs.db", ".ds_store"}


def out(text=""):
    print(text, flush=True)


def clean_windows_folder_arg(raw_value):
    value = str(raw_value or "").strip()
    if not value:
        return value

    match = re.match(r'^(?P<folder>.+?)"\s+--(?:project-name|bat-name)\b(?P<rest>.*)$', value, re.IGNORECASE)
    if match:
        return match.group("folder").rstrip().rstrip("\\/")

    return value.rstrip('"')


def sanitize_folder_name(name):
    banned = '<>:"/\\|?*'
    cleaned = "".join(" " if ch in banned or ord(ch) < 32 else ch for ch in (name or "proyecto"))
    cleaned = " ".join(cleaned.split()).strip().rstrip(". ")
    return cleaned[:80] or "proyecto"


def rel_path(path, base):
    return str(path.relative_to(base)).replace("\\", "/")


def build_headers(secret):
    return {
        "Content-Type": "application/json",
        "X-WebIDE-Secret": secret,
        "User-Agent": f"VerboCode-WebIDE/{VERSION}",
    }


def post_json(url, payload, secret, timeout=60):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    for key, value in build_headers(secret).items():
      req.add_header(key, value)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode("utf-8")
        return json.loads(body) if body else {}


def is_text_file(path):
    try:
        raw = path.read_bytes()
    except OSError:
        return False
    if b"\x00" in raw:
        return False
    try:
        raw.decode("utf-8")
        return True
    except UnicodeDecodeError:
        return False


def read_project_files(folder, bat_name):
    files = {}
    for root, dirs, filenames in os.walk(folder):
        dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]
        root_path = Path(root)
        for filename in filenames:
            if filename.lower() in IGNORE_FILES:
                continue
            file_path = root_path / filename
            relative = rel_path(file_path, folder)
            if bat_name and relative.lower() == bat_name.lower():
                continue
            if relative.startswith(".verbocode-webide/"):
                continue
            if not is_text_file(file_path):
                continue
            try:
                files[relative] = file_path.read_text(encoding="utf-8")
            except OSError:
                continue
    return files


def file_map_hash(files):
    payload = json.dumps(files, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return hashlib.sha1(payload).hexdigest()


def prune_empty_dirs(folder):
    for root, dirs, _ in os.walk(folder, topdown=False):
        for dirname in dirs:
            path = Path(root) / dirname
            try:
                if path.name in IGNORE_DIRS:
                    continue
                next(path.iterdir())
            except StopIteration:
                try:
                    path.rmdir()
                except OSError:
                    pass
            except OSError:
                pass


def apply_remote_snapshot(folder, remote_files, bat_name):
    current_files = read_project_files(folder, bat_name)
    current_set = set(current_files.keys())
    remote_set = set(remote_files.keys())

    for relative, content in remote_files.items():
        path = folder / relative
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            existing = path.read_text(encoding="utf-8") if path.exists() else None
            if existing != content:
                path.write_text(content, encoding="utf-8")
        except OSError:
            pass

    for relative in sorted(current_set - remote_set, reverse=True):
        path = folder / relative
        try:
            path.unlink()
        except OSError:
            pass

    prune_empty_dirs(folder)


def rename_folder_if_needed(folder, desired_name):
    desired = sanitize_folder_name(desired_name)
    if not desired or folder.name == desired:
        return folder
    target = folder.parent / desired
    if target.exists():
        return folder
    try:
        folder.rename(target)
        out(f"[web-ide] Carpeta renombrada a: {target}")
        return target
    except OSError:
        return folder


def powershell_executable():
    return shutil.which("powershell") or shutil.which("pwsh") or "powershell"


def run_command(command, cwd):
    exe = powershell_executable()
    try:
        completed = subprocess.run(
            [exe, "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
            cwd=str(cwd),
            capture_output=True,
            timeout=110,
        )
        stdout = completed.stdout.decode("utf-8", errors="replace")
        stderr = completed.stderr.decode("utf-8", errors="replace")
        return {
            "stdout": stdout,
            "stderr": stderr,
            "exito": completed.returncode == 0,
            "exitCode": completed.returncode,
        }
    except subprocess.TimeoutExpired as exc:
        stdout = (exc.stdout or b"").decode("utf-8", errors="replace")
        stderr = (exc.stderr or b"").decode("utf-8", errors="replace")
        return {
            "stdout": stdout,
            "stderr": (stderr + "\nTiempo agotado ejecutando el comando.").strip(),
            "exito": False,
            "exitCode": None,
        }
    except OSError as exc:
        return {"stdout": "", "stderr": str(exc), "exito": False, "exitCode": None}


class FolderHttpRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, directory_getter=None, **kwargs):
        self._directory_getter = directory_getter or (lambda: Path.cwd())
        super().__init__(*args, directory=str(self._directory_getter()), **kwargs)

    def translate_path(self, path):
        self.directory = str(self._directory_getter())
        return super().translate_path(path)

    def log_message(self, _format, *_args):
        return


class LocalPreviewServer:
    def __init__(self, folder):
        self.folder = Path(folder)
        self.httpd = None
        self.thread = None
        self.port = None

    @property
    def url(self):
        if not self.port:
            return ""
        return f"http://127.0.0.1:{self.port}/"

    def start(self):
        handler = lambda *args, **kwargs: FolderHttpRequestHandler(
            *args,
            directory_getter=lambda: self.folder,
            **kwargs,
        )
        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.httpd.daemon_threads = True
        self.port = int(self.httpd.server_address[1])
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def update_folder(self, folder):
        self.folder = Path(folder)

    def stop(self):
        if self.httpd:
            self.httpd.shutdown()
            self.httpd.server_close()
            self.httpd = None
        self.thread = None
        self.port = None


def parse_args():
    parser = argparse.ArgumentParser(description="Cliente liviano de Verbo Code Web IDE")
    parser.add_argument("--server", required=True)
    parser.add_argument("--sync-id", required=True)
    parser.add_argument("--secret", required=True)
    parser.add_argument("--folder", required=True)
    parser.add_argument("--project-name", default="Proyecto Verbo Code")
    parser.add_argument("--bat-name", default="")
    args = parser.parse_args()

    raw_folder = str(args.folder or "")
    if '" --project-name ' in raw_folder.lower() or '" --bat-name ' in raw_folder.lower():
        folder_match = re.match(r'^(?P<folder>.+?)"\s+(?P<rest>--.*)$', raw_folder, re.IGNORECASE)
        if folder_match:
            args.folder = clean_windows_folder_arg(folder_match.group("folder"))
            resto = folder_match.group("rest")
            project_match = re.search(r'--project-name\s+(.+?)(?=\s+--bat-name\b|$)', resto, re.IGNORECASE)
            bat_match = re.search(r'--bat-name\s+(.+?)$', resto, re.IGNORECASE)
            if project_match:
                args.project_name = project_match.group(1).strip().strip('"')
            if bat_match:
                args.bat_name = bat_match.group(1).strip().strip('"')
    else:
        args.folder = clean_windows_folder_arg(raw_folder)

    return args


def main():
    args = parse_args()
    server = args.server.rstrip("/")
    folder = Path(args.folder).expanduser().resolve()
    folder.mkdir(parents=True, exist_ok=True)
    bat_name = Path(args.bat_name).name if args.bat_name else ""
    machine_name = socket.gethostname()
    current_name = args.project_name
    last_revision = 0
    local_hash = None
    last_error = ""
    preview_server = LocalPreviewServer(folder)
    preview_server.start()

    out("================================================")
    out(" Verbo Code Web IDE")
    out("================================================")
    out(f" Proyecto: {current_name}")
    out(f" Carpeta:  {folder}")
    out(f" Cliente:  {machine_name}")
    out(f" Preview:  {preview_server.url}")
    out("")

    while True:
        try:
            poll = post_json(
                f"{server}/api/v1/verbocode/link/{args.sync_id}/poll",
                {
                    "revision": last_revision,
                    "solicitarArchivos": last_revision == 0,
                    "folderPath": str(folder),
                    "cwd": str(folder),
                    "machineName": machine_name,
                    "clientVersion": VERSION,
                    "previewUrl": preview_server.url,
                    "previewPort": preview_server.port,
                    "localServerRunning": True,
                },
                args.secret,
                timeout=70,
            )
            if last_error:
                out("[web-ide] Reconectado.")
                last_error = ""

            desired_name = poll.get("desiredFolderName") or current_name
            folder = rename_folder_if_needed(folder, desired_name)
            preview_server.update_folder(folder)

            project = poll.get("project")
            if project:
                current_name = project.get("nombre") or current_name
                apply_remote_snapshot(folder, project.get("archivos") or {}, bat_name)
                last_revision = int(project.get("revision") or last_revision or 0)
                local_hash = file_map_hash(read_project_files(folder, bat_name))
                out(f"[web-ide] Snapshot aplicado. Revision {last_revision}.")

            current_files = read_project_files(folder, bat_name)
            current_hash = file_map_hash(current_files)
            if current_hash != local_hash:
                push = post_json(
                    f"{server}/api/v1/verbocode/link/{args.sync_id}/push",
                    {
                        "nombre": current_name,
                        "archivos": current_files,
                        "folderPath": str(folder),
                        "cwd": str(folder),
                        "machineName": machine_name,
                        "clientVersion": VERSION,
                        "previewUrl": preview_server.url,
                        "previewPort": preview_server.port,
                        "localServerRunning": True,
                    },
                    args.secret,
                    timeout=90,
                )
                current_name = push.get("nombre") or current_name
                folder = rename_folder_if_needed(folder, push.get("desiredFolderName") or current_name)
                last_revision = int(push.get("revision") or last_revision or 0)
                local_hash = current_hash
                out(f"[web-ide] Cambios locales sincronizados. Revision {last_revision}.")

            for command in poll.get("commands") or []:
                cmd_id = command.get("id")
                cmd_text = command.get("comando") or ""
                out(f"[web-ide] Ejecutando: {cmd_text}")
                result = run_command(cmd_text, folder)
                post_json(
                    f"{server}/api/v1/verbocode/link/{args.sync_id}/command-result/{cmd_id}",
                    {
                        "stdout": result.get("stdout", ""),
                        "stderr": result.get("stderr", ""),
                        "exito": result.get("exito", False),
                        "exitCode": result.get("exitCode"),
                        "folderPath": str(folder),
                        "cwd": str(folder),
                        "machineName": machine_name,
                        "clientVersion": VERSION,
                        "previewUrl": preview_server.url,
                        "previewPort": preview_server.port,
                        "localServerRunning": True,
                    },
                    args.secret,
                    timeout=90,
                )
                current_files = read_project_files(folder, bat_name)
                local_hash = file_map_hash(current_files)

            wait_ms = int(poll.get("pollIntervalMs") or 2200)
            time.sleep(max(0.8, min(wait_ms / 1000.0, 10.0)))
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            last_error = f"HTTP {exc.code}: {body}"
            out(f"[web-ide] Error: {last_error}")
            time.sleep(4)
        except Exception as exc:
            last_error = str(exc)
            out(f"[web-ide] Error: {last_error}")
            time.sleep(4)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        out("\n[web-ide] Conexion cerrada por el usuario.")
        sys.exit(0)
