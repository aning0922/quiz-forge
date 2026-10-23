# R1 database recovery focused checks

Run from the independent repository root:

```sh
pnpm exec vitest run --config vitest.recovery-data.config.ts
```

The suite uses new synthetic local PostgreSQL instances on 55421 and 55425,
with HTTP origin holds on 3198/3197. It preserves generated directories for
inspection and stops the PostgreSQL instances it owns. Do not run while those
ports are in use. It never operates on the user instance or port 55423.

On 2026-10-21, eight checks passed: source metadata function, extra schema and
COMMENT/TOC rejection without a seal; a real accepted TCP socket closing while
the source hold is active; genuine artifact capabilities refusing both root
ancestor directions before target creation; actual post-start abort and lost
file-close acknowledgement both stopping the new PG while retaining pending;
post-exit signal refusal, late stat settlement without escaped timers,
pre-spawn cancellation replay, and restricted stop admission retaining the
business IO latch. Some related cases are grouped in one test.

The ancestor-direction test uses a genuine B-issued capability and substitutes
the reported target cwd to exercise pre-admission rejection. It does not claim
to restore a database into a nested checkout. Process ordering tests use mocked
children/signals; initializer fault and source backup tests use PostgreSQL 18.4.

This suite is focused evidence, not the complete nonempty R1 recovery drill,
the full repository check matrix, or an approval to merge/deploy. Cross-root
roundtrip and schema-normalization counterexamples are recorded separately.

Three further real PostgreSQL checks passed after implementation commit
`2724bcab95d938ab5494c0937eba1ad3578fd1db`: the exact six-CHECK native reparse
variant normalizes back to the original whole catalog and passes the existing
application guards; unknown constraint/ACL variants issue zero normalization
DDL and retain their catalog; an interruption after three actual ALTERs rolls
the transaction back, retaining all six validated/enforced constraints.
These checks use a dedicated synthetic database and do not change source
backup or the production schema policy.

The same implementation commit completed a formal cross-root backup/restore
with 21 synthetic rows across 23 tables, 18 migration history entries and no
asset/report fixture. Both repositories used the exact implementation, PG
55421/55424 and origins 3198/3199; the target returned `verified-stopped`, the
source stopped, and pg_restore closed with exit 0 and empty stderr.
The private safe result is under
`.cache/recovery-r1-probe/ba7305b5-10b1-45e0-b8da-23e633ecdeee/roundtrip-safe-result.json`.
Its SHA-256 is `1585a1a7fbc136a088b59e806587581b26f34564fb89b200ae9265c23b8cef8c`.
Manifest SHA-256: `9c92014ef9ffaf9421cae7f2b6d1abb2818100d3359a0637e4473abc9fb09921`.
Formal PK-LF database graph: `7c8f0063f0640ca6586bc03aa27d528969b82a3194ba3bc8d2d5ca65702ee78c`.
This is narrower than the complete nonempty recovery drill owned by integration.
