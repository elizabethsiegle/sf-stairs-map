import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/app.js'
import { TodoStore } from '../src/store.js'

let server
let base
let dir
let dataFile

async function api (path, options = {}) {
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: options.body ? { 'content-type': 'application/json', ...options.headers } : options.headers
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

const addTodo = (title, extra = {}) =>
  api('/api/todos', { method: 'POST', body: JSON.stringify({ title, ...extra }) })

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'order-of-play-'))
  dataFile = join(dir, 'todos.json')
})

after(async () => {
  server?.close()
  await rm(dir, { recursive: true, force: true })
})

beforeEach(async () => {
  server?.close()
  await rm(dataFile, { force: true })
  const store = new TodoStore(dataFile)
  await store.load()
  server = createApp(store).listen(0)
  await new Promise((done) => server.once('listening', done))
  base = `http://127.0.0.1:${server.address().port}`
})

describe('GET /api/todos', () => {
  it('starts with an empty schedule', async () => {
    const { status, body } = await api('/api/todos')
    assert.equal(status, 200)
    assert.deepEqual(body.todos, [])
    assert.deepEqual(body.summary, { total: 0, done: 0, remaining: 0 })
  })

  it('lists open matches before completed ones', async () => {
    const { body: first } = await addTodo('Resurface the baseline')
    await addTodo('Restring the racquets')
    await api(`/api/todos/${first.todo.id}`, { method: 'PATCH', body: JSON.stringify({ done: true }) })

    const { body } = await api('/api/todos')
    assert.deepEqual(body.todos.map((todo) => todo.title), ['Restring the racquets', 'Resurface the baseline'])
    assert.deepEqual(body.summary, { total: 2, done: 1, remaining: 1 })
  })
})

describe('POST /api/todos', () => {
  it('creates a todo with trimmed text and defaults', async () => {
    const { status, body } = await addTodo('  Book court 2  ', { note: ' bring new balls ', court: 2 })
    assert.equal(status, 201)
    assert.equal(body.todo.title, 'Book court 2')
    assert.equal(body.todo.note, 'bring new balls')
    assert.equal(body.todo.court, 2)
    assert.equal(body.todo.done, false)
    assert.equal(body.todo.completedAt, null)
    assert.match(body.todo.id, /^[0-9a-f-]{36}$/)
  })

  it('rejects a missing, empty, or oversized title', async () => {
    const missing = await api('/api/todos', { method: 'POST', body: JSON.stringify({ note: 'no title' }) })
    assert.equal(missing.status, 400)
    assert.match(missing.body.error, /"title" is required/)

    const empty = await addTodo('   ')
    assert.equal(empty.status, 400)
    assert.match(empty.body.error, /cannot be empty/)

    const long = await addTodo('x'.repeat(201))
    assert.equal(long.status, 400)
    assert.match(long.body.error, /200 characters/)
  })

  it('rejects a court outside the grounds', async () => {
    const { status, body } = await addTodo('Play on court 99', { court: 99 })
    assert.equal(status, 400)
    assert.match(body.error, /between 1 and 18/)
  })

  it('does not persist a rejected todo', async () => {
    await addTodo('')
    const { body } = await api('/api/todos')
    assert.equal(body.todos.length, 0)
  })
})

describe('PATCH /api/todos/:id', () => {
  it('toggles done and stamps completedAt both ways', async () => {
    const { body: created } = await addTodo('Sweep the clay')
    const id = created.todo.id

    const done = await api(`/api/todos/${id}`, { method: 'PATCH', body: JSON.stringify({ done: true }) })
    assert.equal(done.status, 200)
    assert.equal(done.body.todo.done, true)
    assert.ok(done.body.todo.completedAt)

    const reopened = await api(`/api/todos/${id}`, { method: 'PATCH', body: JSON.stringify({ done: false }) })
    assert.equal(reopened.body.todo.done, false)
    assert.equal(reopened.body.todo.completedAt, null)
  })

  it('edits the title and clears the note', async () => {
    const { body: created } = await addTodo('Old title', { note: 'old note' })
    const { body } = await api(`/api/todos/${created.todo.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'New title', note: '' })
    })
    assert.equal(body.todo.title, 'New title')
    assert.equal(body.todo.note, '')
  })

  it('rejects a bad done value and an empty title edit', async () => {
    const { body: created } = await addTodo('Keep me')
    const badDone = await api(`/api/todos/${created.todo.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ done: 'yes' })
    })
    assert.equal(badDone.status, 400)
    assert.match(badDone.body.error, /"done" must be a boolean/)

    const badTitle = await api(`/api/todos/${created.todo.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: '  ' })
    })
    assert.equal(badTitle.status, 400)

    const { body } = await api('/api/todos')
    assert.equal(body.todos[0].title, 'Keep me')
    assert.equal(body.todos[0].done, false)
  })

  it('404s on an unknown id', async () => {
    const { status, body } = await api('/api/todos/nope', { method: 'PATCH', body: JSON.stringify({ done: true }) })
    assert.equal(status, 404)
    assert.match(body.error, /No match on the schedule/)
  })
})

describe('DELETE /api/todos', () => {
  it('removes one todo and 404s the second time', async () => {
    const { body: created } = await addTodo('Temporary')
    const first = await api(`/api/todos/${created.todo.id}`, { method: 'DELETE' })
    assert.equal(first.status, 204)
    assert.equal(first.body, null)

    const second = await api(`/api/todos/${created.todo.id}`, { method: 'DELETE' })
    assert.equal(second.status, 404)
  })

  it('clears only completed todos', async () => {
    const { body: one } = await addTodo('Done one')
    await addTodo('Still open')
    const { body: three } = await addTodo('Done two')
    for (const id of [one.todo.id, three.todo.id]) {
      await api(`/api/todos/${id}`, { method: 'PATCH', body: JSON.stringify({ done: true }) })
    }

    const cleared = await api('/api/todos/completed', { method: 'DELETE' })
    assert.equal(cleared.status, 200)
    assert.deepEqual(cleared.body, { removed: 2 })

    const { body } = await api('/api/todos')
    assert.deepEqual(body.todos.map((todo) => todo.title), ['Still open'])
  })
})

describe('the rest of the app', () => {
  it('404s unknown api routes as JSON', async () => {
    const { status, body } = await api('/api/umpires')
    assert.equal(status, 404)
    assert.match(body.error, /No route for GET \/api\/umpires/)
  })

  it('serves the order of play page', async () => {
    const res = await fetch(`${base}/`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type'), /text\/html/)
    assert.match(await res.text(), /Order of Play/)
  })

  it('survives a restart by reloading the data file', async () => {
    await addTodo('Persist me')
    server.close()

    const reopened = new TodoStore(dataFile)
    await reopened.load()
    server = createApp(reopened).listen(0)
    await new Promise((done) => server.once('listening', done))
    base = `http://127.0.0.1:${server.address().port}`

    const { body } = await api('/api/todos')
    assert.deepEqual(body.todos.map((todo) => todo.title), ['Persist me'])
  })

  it('keeps concurrent writes from clobbering each other', async () => {
    const titles = Array.from({ length: 25 }, (_, i) => `Match ${i + 1}`)
    await Promise.all(titles.map((title) => addTodo(title)))

    const { body } = await api('/api/todos')
    assert.equal(body.todos.length, 25)

    const onDisk = new TodoStore(dataFile)
    await onDisk.load()
    assert.equal(onDisk.list().length, 25)
  })
})
