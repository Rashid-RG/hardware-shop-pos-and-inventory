"""Verify the installer uses the same Docker endpoint as local recovery."""
import subprocess
import unittest
from unittest.mock import patch

from setup_prerequisites import verify_docker_endpoint


class DockerEndpointTests(unittest.TestCase):
    @patch("setup_prerequisites.shutil.which", return_value="/usr/bin/docker")
    @patch("setup_prerequisites.subprocess.run")
    def test_local_and_remote_contexts(self, run, _which):
        for endpoint in ("unix:///var/run/docker.sock", "ssh://remote.example", "unix:///tmp/other.sock"):
            with self.subTest(endpoint=endpoint), patch.dict("os.environ", clear=True):
                run.return_value = subprocess.CompletedProcess([], 0, stdout=endpoint + "\n")
                if endpoint == "unix:///var/run/docker.sock":
                    verify_docker_endpoint()
                else:
                    with self.assertRaisesRegex(RuntimeError, "standard local Docker socket"):
                        verify_docker_endpoint()

    @patch("setup_prerequisites.subprocess.run")
    def test_overrides_are_rejected_before_docker_runs(self, run):
        for key in ("DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"):
            with self.subTest(key=key), patch.dict("os.environ", {key: ""}, clear=True):
                with self.assertRaisesRegex(RuntimeError, "without connection overrides"):
                    verify_docker_endpoint()
        run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
