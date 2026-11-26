# Database version-switch handoff contract

Status: rehearsal only; no live release switching or activation.

All participating startup paths acquire the transition gate before the writer lease. Maintenance retains both during protected archive creation. A future coordinator must hold the gate continuously while authorizing exactly one candidate to acquire the writer lease, and must retain the gate until candidate readiness is verified or the previous version regains its writer lease. A normal server cannot acquire the gate while the coordinator holds it; an authenticated, one-use handoff mechanism is still required. Never bypass the gate with a boolean environment flag.

Failure boundaries:
- Candidate startup failure: retain the gate, confirm candidate session is closed, then authorize rollback.
- Coordinator connection loss: PostgreSQL releases its advisory locks; retain durable maintenance evidence and block ordinary startup until reconciliation. Advisory locks alone cannot provide crash-persistent exclusion.
- External SQL clients or older application builds may ignore advisory locks. No universal writer exclusion is claimed.
- Schema compatibility and recovery archives must be verified independently. No automatic database restore on application rollback.

The disposable PostgreSQL integration tests cover candidate failure and coordinator connection loss. They do not execute a production release switch.

## Authorization primitive

A coordinator-local challenge now binds a random 256-bit single-use secret to the candidate PID, release, runtime and maintenance digests, and candidate/rollback purpose. Grants expire using monotonic time, support revocation and reject replay. No live server uses the primitive yet. The future local transport must independently authenticate the peer, verify the actual process and release, and confirm the coordinator still holds the database gate. Do not persist or log secrets, pass them on a command line, or accept claimed PID as proof.

## Private transport rehearsal

The coordinator forks a fixed disposable fixture with an inherited Node IPC channel. The parent binds the grant to the spawned child PID; secrets travel over IPC, not arguments, environment variables or files. The fixture proves the single-use grant, and the parent rejects wrong bindings, replay, disconnects and timeouts. This is not production peer attestation: executable integrity, database gate ownership, durable maintenance evidence and the live server integration remain required.
