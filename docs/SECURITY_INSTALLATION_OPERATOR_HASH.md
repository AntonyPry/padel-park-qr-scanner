# Setly installation-operator hash cutover

SEC-A3 changes only creation of installation-operator sessions. The existing
30-minute signed, DB-backed and revocable session, capabilities, API payloads,
response shapes and operator UI remain unchanged. No schema, DB grant or runtime
identity changes are part of this slice.

## Offline generation and preflight

Generate the credential on a trusted local/offline host from `server`:

```sh
npm run --silent auth:installation-operator-hash
```

The TTY prompt is hidden and asks for confirmation. Standard output contains
only the canonical Argon2id PHC; prompts and safe validation diagnostics use
standard error. Before printing, the command recognizes the PHC with the SEC-A2
bounded parser and verifies the submitted password against it. It defaults to
the accepted SEC-A2 Argon2id parameters and honors only the bounded
`AUTH_ARGON2_MEMORY_KIB`, `AUTH_ARGON2_TIME_COST` and
`AUTH_ARGON2_PARALLELISM` overrides. The command uses the DB-free SEC-A2 hashing
module and does not load Sequelize, the application database or dotenv files.

For automation, provide the password through standard input from a protected
secret-manager/file-descriptor integration and capture standard output directly
into the protected secret store. The command accepts no arguments. Do not put a
password in argv, an environment variable, `echo`/`printf` source text, shell
history, a process title, a tracked file or a log. Avoid an intermediate PHC
file; if operations require one, create it outside the repository with owner-only
permissions and remove it after the protected-store write. Treat the PHC as
sensitive even though it is one-way.

Empty input, leading/trailing whitespace, control characters, embedded newlines,
invalid UTF-8 and input over 1024 bytes are rejected. The command never prints
the submitted password.

## Runtime configuration

New login is available only when the installation management or provisioning
surface is enabled and all three values are valid:

- `INSTALLATION_OPERATOR_USERNAME`;
- `INSTALLATION_OPERATOR_PASSWORD_HASH`, containing a bounded canonical SEC-A2
  Argon2id PHC (PBKDF2 is not accepted for this newly provisioned credential);
- `INSTALLATION_OPERATOR_SECRET`, unchanged and at least 32 characters.

`INSTALLATION_OPERATOR_PASSWORD` must be absent from the runtime environment,
not merely blank. If it is present, or the username/hash/signer is missing or
invalid, public status reports new login unavailable and session creation fails
closed. The plaintext value is never read or verified.

Password-hash readiness is deliberately separate from session signing. With the
same valid username and signer secret, an already-issued session continues to
pass its signature, expiry, DB row and revocation checks even if the new hash is
missing/malformed or the legacy variable is accidentally present. This is a
cutover correction path, not a plaintext fallback.

## Cutover, release gate and rollback floor

1. Generate and self-preflight the canonical Argon2id PHC offline as above.
2. Keep one known-good active revocable operator session and keep the signer
   secret unchanged.
3. Store the PHC in protected external configuration. Replace the plaintext
   runtime variable with `INSTALLATION_OPERATOR_PASSWORD_HASH`; never deploy
   both variables together.
4. Confirm public status, create a new test session with the unchanged request
   body, verify a protected read, then revoke only that test session. Confirm the
   known-good session still works before ending the correction window.
5. Keep the old plaintext secret only outside the runtime environment for a
   strictly time-bounded authorized rollback window. A rollback to the older
   SEC-A2 application requires explicitly restoring that external secret; it
   must never enter git, docs, logs or command history.
6. After the plaintext secret is destroyed, this SEC-A3 hash-only reader is the
   rollback floor. Normal rollback disables installation management/provisioning
   flags or deploys another SEC-A3-compatible reader; it never restores silent
   plaintext verification.

Production operator Argon2 verification remains blocked until SEC-A4 is accepted
in production `enforce` mode for the public operator-session endpoint and the
Team Lead accepts production-like CPU, memory and concurrent-login preflight for
the exact release SHA. The default-off SEC-A4a candidate alone does not satisfy
this gate; see
[`SECURITY_AUTH_RATE_LIMITING.md`](./SECURITY_AUTH_RATE_LIMITING.md). SEC-A3 does
not change the required privileged migration identity / least-privilege runtime
identity split and requires no DDL privileges.
