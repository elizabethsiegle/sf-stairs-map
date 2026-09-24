# Order of Play

A to-do list that keeps itself the way a tournament keeps its order of play: matches on the board,
courts assigned, a rubber stamp on anything that finishes. Express on the back, no framework on the front.

## Run it

```bash
npm install
npm start          # http://localhost:3000
npm run dev        # same, with node --watch
npm test           # 16 tests, node:test
```

Environment:

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `TODO_DATA_FILE` | `data/todos.json` | Where the schedule is stored (relative to the project root) |

## API

| Method | Route | Body | Returns |
| --- | --- | --- | --- |
| `GET` | `/api/todos` | | `{ todos, summary: { total, done, remaining } }` |
| `POST` | `/api/todos` | `{ title, note?, court? }` | `201 { todo }` |
| `PATCH` | `/api/todos/:id` | any of `{ title, note, court, done }` | `200 { todo }` |
| `DELETE` | `/api/todos/completed` | | `200 { removed }` |
| `DELETE` | `/api/todos/:id` | | `204` |

`title` is required, trimmed, and capped at 200 characters. `note` is capped at 500. `court` must be a
whole number from 1 to 18 or `null`. Bad input comes back `400 { error }`, an unknown id `404 { error }`.

Ticking a todo stamps `completedAt`; un-ticking it clears the stamp again.

## How it is put together

```
server.js        boots the store, wires the port, handles SIGINT/SIGTERM
src/app.js       the Express app: JSON routes, static files, error handler
src/store.js     the data layer
public/          the programme: index.html, styles.css, app.js
test/api.test.js the suite, driven over real HTTP on an ephemeral port
```

`src/app.js` exports `createApp(store)` rather than listening itself, so the tests build an app around a
throwaway store in a temp directory and never touch your real schedule.

`src/store.js` holds the list in memory and writes the whole file on every mutation. Two details matter:
mutations run through a promise queue so concurrent requests cannot interleave a read-modify-write, and
each write lands in a temp file that is then `rename()`d over the target, so a crash mid-write leaves the
previous file intact. A mutation that throws validation rolls the in-memory list back to its snapshot, so
a rejected request never leaves a half-applied change behind.

## The front end

No build step, no framework. `public/app.js` is a module that talks to the same JSON API and renders rows
with `createElement` and `textContent`, so a todo titled `<script>` is just text.

The look is a printed matchday programme: Bodoni Moda for display, IBM Plex Sans for text, IBM Plex Mono
for the numerals, hairline rules, and a single ochre accent. Dark mode is the night session under the
floodlights. Keyboard: `Enter` schedules, double-click or `Rename` edits a title in place, `Enter` saves,
`Escape` cancels.
