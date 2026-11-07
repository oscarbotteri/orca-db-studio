// SQLite driver: node:sqlite in one worker_threads thread per session, so a slow statement never
// blocks the plugin worker. Cancel terminates the thread; the next call starts a fresh one.
// node:sqlite has no interrupt: a thread stops once SQLite returns to JavaScript (the next row),
// so cancel answers at once and never waits for the thread to exit.
import { Worker } from 'node:worker_threads'
import type { ThreadOp, ThreadOps, ThreadReply } from './sqlite-thread'
import type { ConnectionConfig, Driver, QueryCursor, QueryOptions, Row, Session } from './types'

const THREAD_URL = new URL('./sqlite-thread.ts', import.meta.url)

interface Thread {
  call<K extends ThreadOp>(op: K, input: ThreadOps[K]['input']): Promise<ThreadOps[K]['output']>
  stop(reason: Error): void
}

interface Pending {
  resolve(value: unknown): void
  reject(error: Error): void
}

function startThread(path: string): Thread {
  const worker = new Worker(THREAD_URL, { workerData: { path } })
  const pending = new Map<number, Pending>()
  let nextId = 0
  let failure: Error | undefined

  function failAll(error: Error): void {
    failure ??= error
    for (const call of pending.values()) call.reject(failure)
    pending.clear()
  }

  worker.on('message', (reply: ThreadReply) => {
    const call = pending.get(reply.id)
    pending.delete(reply.id)
    if (reply.ok) call?.resolve(reply.value)
    else call?.reject(new Error(reply.message))
  })
  worker.on('error', failAll)
  worker.on('exit', () => failAll(new Error('The SQLite session ended')))

  return {
    call(op, input) {
      if (failure) return Promise.reject(failure)
      const id = nextId++
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve: (value) => resolve(value as never), reject })
        worker.postMessage({ id, op, input })
      })
    },
    stop(reason) {
      failAll(reason)
      void worker.terminate()
    },
  }
}

class SqliteSession implements Session {
  readonly dialect = 'sqlite'

  #thread: Thread | undefined
  /** The query whose call is running in the thread, which cancel may stop. */
  #running: string | undefined

  constructor(readonly path: string) {}

  thread(): Thread {
    this.#thread ??= startThread(this.path)
    return this.#thread
  }

  async #track<T>(queryId: string, thread: Thread, call: Promise<T>): Promise<T> {
    this.#running = queryId
    try {
      return await call
    } finally {
      if (this.#running === queryId && this.#thread === thread) this.#running = undefined
    }
  }

  async listObjects() {
    return this.thread().call('listObjects', {})
  }

  async query(sql: string, opts: QueryOptions): Promise<QueryCursor> {
    const thread = this.thread()
    const result = await this.#track(opts.queryId, thread, thread.call('query', { sql }))
    const { cursorId } = result
    const session = this
    return {
      columns: result.columns,
      affectedRows: result.affectedRows,
      async fetch(count: number): Promise<Row[]> {
        if (cursorId === undefined) return []
        return session.#track(opts.queryId, thread, thread.call('fetch', { cursorId, count }))
      },
      async close() {
        if (cursorId === undefined) return
        await thread.call('closeCursor', { cursorId }).catch(() => undefined)
      },
    }
  }

  async cancel(queryId: string): Promise<void> {
    const thread = this.#thread
    if (!thread || this.#running !== queryId) return
    this.#thread = undefined
    this.#running = undefined
    thread.stop(new Error('Query cancelled'))
  }

  quoteIdent(name: string): string {
    return `"${name.replaceAll('"', '""')}"`
  }

  async close(): Promise<void> {
    const thread = this.#thread
    this.#thread = undefined
    thread?.stop(new Error('The SQLite session was closed'))
  }
}

export const sqliteDriver: Driver = {
  async connect(config: ConnectionConfig): Promise<Session> {
    if (config.engine !== 'sqlite') throw new Error(`Not a SQLite connection: ${config.engine}`)
    const session = new SqliteSession(config.path)
    try {
      await session.thread().call('open', {})
    } catch (error) {
      await session.close()
      throw error
    }
    return session
  },
}
