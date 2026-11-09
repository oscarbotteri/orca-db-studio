// SQLite driver: node:sqlite in one worker_threads thread per session, so a slow statement never
// blocks the plugin worker. Cancel terminates the thread; the next call starts a fresh one.
// node:sqlite has no interrupt: a thread stops once SQLite returns to JavaScript (the next row),
// so cancel answers at once and never waits for the thread to exit.
import { Worker } from 'node:worker_threads'
import type { ConnectionConfig } from '../common/config'
import type { Driver, QueryCursor, QueryOptions, Row, Session } from '../common/driver'
import type { ColumnTree } from '../common/schema'
import type { ThreadOp, ThreadOps, ThreadReply } from './thread'

const THREAD_URL = new URL('./thread.ts', import.meta.url)

interface Thread {
  call<K extends ThreadOp>(op: K, input: ThreadOps[K]['input']): Promise<ThreadOps[K]['output']>
  stop(reason: Error): void
}

interface Pending {
  resolve(value: unknown): void
  reject(error: Error): void
}

function formatSeconds(ms: number): string {
  const seconds = Math.round(ms / 100) / 10
  return `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`
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
  /** Queries between `query()` and their cursor's close; cancel may stop any of them. */
  #running = new Set<string>()

  constructor(readonly path: string) {}

  thread(): Thread {
    this.#thread ??= startThread(this.path)
    return this.#thread
  }

  /** Ends the thread, and with it every query running on it; the next call starts a fresh one. */
  #stop(thread: Thread, reason: Error): void {
    if (this.#thread !== thread) return
    this.#thread = undefined
    this.#running.clear()
    thread.stop(reason)
  }

  async listObjects() {
    return this.thread().call('listObjects', {})
  }

  async listColumns(): Promise<ColumnTree> {
    return this.thread().call('listColumns', {})
  }

  /** Ends the thread once `timeoutMs` has passed; the returned function clears that timer. */
  #startTimeout(thread: Thread, timeoutMs: number | undefined): () => void {
    if (!timeoutMs || timeoutMs <= 0) return () => undefined
    const timer = setTimeout(() => {
      this.#stop(thread, new Error(`Query timed out after ${formatSeconds(timeoutMs)}`))
    }, timeoutMs)
    timer.unref()
    return () => clearTimeout(timer)
  }

  async query(sql: string, opts: QueryOptions): Promise<QueryCursor> {
    const thread = this.thread()
    // The statement's whole life counts: preparing, and every fetch until the cursor closes.
    const clearTimer = this.#startTimeout(thread, opts.timeoutMs)
    const running = this.#running
    function endQuery(): void {
      clearTimer()
      running.delete(opts.queryId)
    }
    running.add(opts.queryId)
    let result: ThreadOps['query']['output']
    try {
      result = await thread.call('query', { sql })
    } catch (error) {
      endQuery()
      throw error
    }
    const { cursorId } = result
    if (cursorId === undefined) endQuery()
    return {
      columns: result.columns,
      affectedRows: result.affectedRows,
      async fetch(count: number): Promise<Row[]> {
        if (cursorId === undefined) return []
        return thread.call('fetch', { cursorId, count })
      },
      async close() {
        endQuery()
        if (cursorId === undefined) return
        await thread.call('closeCursor', { cursorId }).catch(() => undefined)
      },
    }
  }

  async cancel(queryId: string): Promise<void> {
    const thread = this.#thread
    if (!thread || !this.#running.has(queryId)) return
    this.#stop(thread, new Error('Query cancelled'))
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
