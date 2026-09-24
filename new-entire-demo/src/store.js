import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const MAX_TITLE = 200
const MAX_NOTE = 500

export class ValidationError extends Error {
  constructor (message) {
    super(message)
    this.name = 'ValidationError'
    this.status = 400
  }
}

export class NotFoundError extends Error {
  constructor (message) {
    super(message)
    this.name = 'NotFoundError'
    this.status = 404
  }
}

function cleanText (value, { field, max, required }) {
  if (value === undefined || value === null) {
    if (required) throw new ValidationError(`"${field}" is required`)
    return undefined
  }
  if (typeof value !== 'string') throw new ValidationError(`"${field}" must be a string`)
  const trimmed = value.trim()
  if (required && trimmed === '') throw new ValidationError(`"${field}" cannot be empty`)
  if (trimmed.length > max) throw new ValidationError(`"${field}" cannot exceed ${max} characters`)
  return trimmed
}

function cleanCourt (value) {
  if (value === undefined || value === null || value === '') return undefined
  const court = Number(value)
  if (!Number.isInteger(court) || court < 1 || court > 18) {
    throw new ValidationError('"court" must be a whole number between 1 and 18')
  }
  return court
}

/**
 * Todos live in a single JSON file. Reads are served from memory; writes are
 * queued so two concurrent requests can never interleave a read-modify-write,
 * and each one lands via rename() so a crash mid-write leaves the old file intact.
 */
export class TodoStore {
  #file
  #todos = []
  #loaded = false
  #queue = Promise.resolve()

  constructor (file) {
    this.#file = file
  }

  async load () {
    if (this.#loaded) return
    try {
      const raw = await readFile(this.#file, 'utf8')
      const parsed = JSON.parse(raw)
      this.#todos = Array.isArray(parsed?.todos) ? parsed.todos : []
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
      this.#todos = []
    }
    this.#loaded = true
  }

  list () {
    // Open matches first, each group newest-scheduled-last, like a real order of play.
    return [...this.#todos].sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1
      return a.createdAt.localeCompare(b.createdAt)
    })
  }

  add (input = {}) {
    const todo = {
      id: randomUUID(),
      title: cleanText(input.title, { field: 'title', max: MAX_TITLE, required: true }),
      note: cleanText(input.note, { field: 'note', max: MAX_NOTE }) ?? '',
      court: cleanCourt(input.court) ?? null,
      done: false,
      createdAt: new Date().toISOString(),
      completedAt: null
    }
    return this.#commit(() => {
      this.#todos.push(todo)
      return todo
    })
  }

  update (id, patch = {}) {
    return this.#commit(() => {
      const todo = this.#todos.find((item) => item.id === id)
      if (!todo) throw new NotFoundError(`No match on the schedule with id ${id}`)

      const title = cleanText(patch.title, { field: 'title', max: MAX_TITLE, required: 'title' in patch })
      if (title !== undefined) todo.title = title

      if ('note' in patch) todo.note = cleanText(patch.note, { field: 'note', max: MAX_NOTE }) ?? ''
      if ('court' in patch) todo.court = cleanCourt(patch.court) ?? null

      if ('done' in patch) {
        if (typeof patch.done !== 'boolean') throw new ValidationError('"done" must be a boolean')
        if (patch.done !== todo.done) {
          todo.done = patch.done
          todo.completedAt = patch.done ? new Date().toISOString() : null
        }
      }
      return todo
    })
  }

  remove (id) {
    return this.#commit(() => {
      const index = this.#todos.findIndex((item) => item.id === id)
      if (index === -1) throw new NotFoundError(`No match on the schedule with id ${id}`)
      return this.#todos.splice(index, 1)[0]
    })
  }

  removeCompleted () {
    return this.#commit(() => {
      const before = this.#todos.length
      this.#todos = this.#todos.filter((item) => !item.done)
      return { removed: before - this.#todos.length }
    })
  }

  // Runs mutations one at a time and only persists once the mutation succeeds,
  // so a rejected validation never leaves a half-applied change on disk.
  #commit (mutate) {
    const run = this.#queue.then(async () => {
      const snapshot = structuredClone(this.#todos)
      let result
      try {
        result = mutate()
      } catch (err) {
        this.#todos = snapshot
        throw err
      }
      try {
        await this.#persist()
      } catch (err) {
        this.#todos = snapshot
        throw err
      }
      return result
    })
    this.#queue = run.catch(() => {})
    return run
  }

  async #persist () {
    const temp = `${this.#file}.${process.pid}.tmp`
    await mkdir(dirname(this.#file), { recursive: true })
    await writeFile(temp, `${JSON.stringify({ todos: this.#todos }, null, 2)}\n`, 'utf8')
    await rename(temp, this.#file)
  }
}
