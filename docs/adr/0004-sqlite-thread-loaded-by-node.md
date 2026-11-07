# 0004. SQLite thread loaded by Node's type stripping; cancel does not wait

Status: accepted

## Context

`node:sqlite` is synchronous, so each SQLite session runs in a `worker_threads` thread (see the architecture doc). A thread needs a file to run.

- Orca loads a plugin's `.ts` files through `module.registerHooks` (a Sucrase transform) in the worker's main thread only. A `worker_threads` thread does not inherit those hooks.
- Orca 1.4.251 runs plugin workers on Node 24.22 with `process.features.typescript === 'strip'`, so Node itself runs a `.ts` file whose syntax is erasable. The same holds for Node 24 used by `orca plugin test` and vitest.
- `node:sqlite` has no interrupt (`sqlite3_interrupt`). `worker.terminate()` stops a thread only when SQLite returns to JavaScript, which is at the next row. A statement that does all its work before its first row, such as `count(*)` over a large scan, keeps the thread busy until that row.

## Decision

- `src/drivers/sqlite-thread.ts` is loaded with `new Worker(new URL('./sqlite-thread.ts', import.meta.url))` and Node's own type stripping. It uses erasable syntax only, and its only local imports are type-only ones with a `.ts` extension, so nothing in it depends on Orca's loader. It is not bundled into `vendor/`.
- Cancel rejects the running call at once, terminates the thread without waiting for it, and the session starts a fresh thread on its next call.

## Consequences

- No build step for the thread. A non-erasable construct (an `enum`, a parameter property, a runtime import of a local module) in that file breaks it at run time, and only the driver tests catch that.
- After a cancel, a thread on a long first row keeps a CPU core busy until SQLite reaches the row. The person and the other requests are not blocked.
- Revisit if Orca stops running workers with type stripping, or if `node:sqlite` gains an interrupt.
