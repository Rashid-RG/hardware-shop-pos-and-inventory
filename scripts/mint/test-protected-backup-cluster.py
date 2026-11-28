"""Check that protected backup rejects a different Docker source."""
from unittest.mock import patch

from backup import protected_container


expected = ("18446744073709551615", "12345")
container = "a" * 64
observation = "hardware_pos_ars|" + "|".join(expected)
with patch.dict("os.environ", clear=True):
    with patch("backup.subprocess.check_output", side_effect=[container[:12], container, observation]) as docker:
        runner = protected_container(expected)
        assert runner == ["docker", "--host", "unix:///var/run/docker.sock", "exec", "-i", container]
        assert docker.call_args.args[0][:len(runner)] == runner
    with patch("backup.subprocess.check_output", side_effect=[container, container, observation.replace("12345", "12346")]):
        try:
            protected_container(expected)
        except ValueError as error:
            assert "cluster identity mismatch" in str(error)
        else:
            raise AssertionError("Wrong database OID accepted")
    with patch("backup.subprocess.check_output", return_value=container + "\n" + container):
        try:
            protected_container(expected)
        except ValueError as error:
            assert "Unique running PostgreSQL container" in str(error)
        else:
            raise AssertionError("Multiple containers accepted")
with patch.dict("os.environ", {"DOCKER_HOST": ""}):
    with patch("backup.subprocess.check_output") as docker:
        try:
            protected_container(expected)
        except ValueError as error:
            assert "Custom Docker connection" in str(error)
        else:
            raise AssertionError("Docker host override accepted")
        docker.assert_not_called()
