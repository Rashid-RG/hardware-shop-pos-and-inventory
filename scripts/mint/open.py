"""Open the installed ARS service once it reports a writable, connected database."""
import json
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
    from pathlib import Path
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
            subprocess.run(['xdg-open', URL], check=True)
            return
        if state == 'failed':
            break
        time.sleep(1)
    raise RuntimeError('ARS could not confirm the database is ready. Check that Docker is running and try again. '
                       'For support, open the service log with journalctl --user -u ars-hardware.service.')


if __name__ == '__main__':
    progress = subprocess.Popen(['zenity', '--progress', '--pulsate', '--no-cancel',
                                 '--title=ARS Hardware POS', '--text=Starting ARS…'],
                                stdin=subprocess.PIPE)
    try:
        launch()
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        progress.terminate()
        subprocess.run(['zenity', '--error', '--title=ARS Hardware POS', '--no-markup', '--text=' + str(error)])
    finally:
        if progress.poll() is None:
            progress.terminate()
        progress.wait()
