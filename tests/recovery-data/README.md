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
