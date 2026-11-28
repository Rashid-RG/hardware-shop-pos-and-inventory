"""Open the installed ARS service once it reports a writable, connected database."""
import json
import fcntl
import os
from pathlib import Path
import subprocess
import time
from urllib.error import URLError
from urllib.request import urlopen

UNIT = 'ars-hardware.service'
URL = 'http://localhost:3000'


def ready():
    try:
        with urlopen(URL + '/api/ready', timeout=1) as response:
            data = json.load(response)
        return (isinstance(data, dict) and data.get('ok') is True
                and data.get('status') == 'ready' and data.get('database') == 'reachable'
                and data.get('sourceOfTruth') == 'normalized')
    except (URLError, OSError, ValueError):
        return False


def launch():
    guard=Path.home()/".local/share/ars-hardware/update-tools/startup_guard.py"
    if not guard.is_file() or subprocess.run(["python3",str(guard)]).returncode!=0:
        raise RuntimeError("ARS startup blocked: update recovery review is required. Contact RS Nextward. Do not delete the recovery journal.")
    subprocess.run(['systemctl', '--user', 'start', '--no-block', UNIT], check=True)
    deadline = time.monotonic() + 155
    while time.monotonic() < deadline:
        result = subprocess.run(['systemctl', '--user', 'is-active', UNIT],
                                capture_output=True, text=True)
        state = result.stdout.strip()
        if state == 'active' and ready():
            from desktop_window import open_window
            open_window()
            return
        if state == 'failed':
            break
        time.sleep(1)
    raise RuntimeError('ARS could not confirm the database is ready. Check that Docker is running and try again. '
                       'For support, open the service log with journalctl --user -u ars-hardware.service.')


def main():
    # Multiple desktop clicks must not start multiple launch dialogs or browsers.
    runtime = Path(os.environ.get('XDG_RUNTIME_DIR') or (Path.home()/'.cache'))
    runtime.mkdir(parents=True, exist_ok=True)
    with (runtime/'ars-hardware-launch.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0
        progress = None
        try:
            progress = subprocess.Popen(['zenity', '--progress', '--pulsate', '--no-cancel',
                                         '--title=ARS Distributor POS', '--text=Starting ARS…'],
                                        stdin=subprocess.PIPE)
            launch()
            return 0
        except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
            if progress is not None and progress.poll() is None:
                progress.terminate()
                progress.wait()
            subprocess.run(['zenity', '--error', '--title=ARS Distributor POS', '--no-markup',
                            '--text=' + str(error)])
            return 1
        finally:
            if progress is not None:
                if progress.poll() is None:
                    progress.terminate()
                progress.wait()


if __name__ == '__main__':
    raise SystemExit(main())
