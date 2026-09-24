import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { createApp } from './src/app.js'
import { TodoStore } from './src/store.js'

const root = dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.PORT ?? 3000)
const dataFile = resolve(root, process.env.TODO_DATA_FILE ?? join('data', 'todos.json'))

const store = new TodoStore(dataFile)
await store.load()

const server = createApp(store).listen(port, () => {
  const { port: bound } = server.address()
  console.log(`Order of Play is on court at http://localhost:${bound}`)
  console.log(`Schedule stored in ${dataFile}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
  })
}
