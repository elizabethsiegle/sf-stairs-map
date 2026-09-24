import express from 'express'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

export function createApp (store) {
  const app = express()

  app.disable('x-powered-by')
  app.use(express.json({ limit: '16kb' }))
  app.use(express.static(publicDir, { extensions: ['html'] }))

  const api = express.Router()

  api.get('/todos', (req, res) => {
    const todos = store.list()
    res.json({ todos, summary: summarise(todos) })
  })

  api.post('/todos', async (req, res) => {
    const todo = await store.add(req.body)
    res.status(201).json({ todo })
  })

  api.patch('/todos/:id', async (req, res) => {
    const todo = await store.update(req.params.id, req.body ?? {})
    res.json({ todo })
  })

  api.delete('/todos/completed', async (req, res) => {
    const result = await store.removeCompleted()
    res.json(result)
  })

  api.delete('/todos/:id', async (req, res) => {
    await store.remove(req.params.id)
    res.status(204).end()
  })

  app.use('/api', api)

  app.use('/api', (req, res) => {
    res.status(404).json({ error: `No route for ${req.method} /api${req.path}` })
  })

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err)
    const status = err.status ?? err.statusCode ?? 500
    if (status >= 500) console.error(err)
    res.status(status).json({
      error: status >= 500 ? 'Something went wrong on the server' : err.message
    })
  })

  return app
}

function summarise (todos) {
  const done = todos.filter((todo) => todo.done).length
  return { total: todos.length, done, remaining: todos.length - done }
}
