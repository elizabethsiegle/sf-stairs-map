const els = {
  form: document.getElementById('new-todo-form'),
  title: document.getElementById('title'),
  court: document.getElementById('court'),
  note: document.getElementById('note'),
  formError: document.getElementById('form-error'),
  matches: document.getElementById('matches'),
  empty: document.getElementById('empty'),
  dateline: document.getElementById('dateline'),
  boardHeading: document.getElementById('board-heading'),
  clear: document.getElementById('clear-completed'),
  stats: document.getElementById('colophon-stats'),
  live: document.getElementById('live'),
  tally: {
    total: document.getElementById('tally-total'),
    remaining: document.getElementById('tally-remaining'),
    done: document.getElementById('tally-done')
  }
}

let todos = []
let filter = 'all'
let editingId = null

const FILTER_HEADINGS = {
  all: 'Not before 10.00',
  open: 'Still to play',
  done: 'Results'
}

async function request (path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: options.body ? { 'content-type': 'application/json' } : undefined
  })
  if (res.status === 204) return null
  const payload = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(payload.error || `Request failed (${res.status})`)
  return payload
}

function showError (message) {
  els.formError.textContent = message
  els.formError.hidden = !message
}

function announce (message) {
  els.live.textContent = message
}

function formatTime (iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function buildMatch (todo, index) {
  const li = document.createElement('li')
  li.className = todo.done ? 'match is-done' : 'match'
  li.dataset.id = todo.id

  const seed = document.createElement('span')
  seed.className = 'match__seed'
  seed.textContent = String(index + 1).padStart(2, '0')

  const check = document.createElement('input')
  check.type = 'checkbox'
  check.className = 'match__check'
  check.checked = todo.done
  check.id = `check-${todo.id}`
  check.setAttribute('aria-label', todo.done ? `Reopen ${todo.title}` : `Mark ${todo.title} completed`)
  check.addEventListener('change', () => toggle(todo, check))

  const body = document.createElement('div')
  body.className = 'match__body'

  const title = document.createElement('p')
  title.className = 'match__title'
  title.textContent = todo.title
  body.append(title)

  const meta = document.createElement('p')
  meta.className = 'match__meta'
  const bits = [todo.court ? `Court ${todo.court}` : 'Court t.b.a.', `Listed ${formatTime(todo.createdAt)}`]
  if (todo.done && todo.completedAt) bits.push(`Off court ${formatTime(todo.completedAt)}`)
  for (const bit of bits) {
    const span = document.createElement('span')
    span.textContent = bit
    meta.append(span)
  }
  body.append(meta)

  if (todo.note) {
    const note = document.createElement('p')
    note.className = 'match__note'
    note.textContent = todo.note
    body.append(note)
  }

  const actions = document.createElement('div')
  actions.className = 'match__actions'

  const edit = document.createElement('button')
  edit.type = 'button'
  edit.className = 'link'
  edit.textContent = 'Rename'
  edit.addEventListener('click', () => startEdit(todo, title))

  const withdraw = document.createElement('button')
  withdraw.type = 'button'
  withdraw.className = 'link link--withdraw'
  withdraw.textContent = 'Withdraw'
  withdraw.addEventListener('click', () => remove(todo))

  actions.append(edit, withdraw)
  li.append(seed, check, body, actions)

  if (todo.done) {
    const stamp = document.createElement('span')
    stamp.className = 'stamp'
    stamp.textContent = 'Completed'
    li.append(stamp)
  }

  title.addEventListener('dblclick', () => startEdit(todo, title))
  return li
}

function startEdit (todo, titleEl) {
  if (editingId) return
  editingId = todo.id

  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'match__edit'
  input.value = todo.title
  input.maxLength = 200
  input.setAttribute('aria-label', 'Rename this match')
  titleEl.replaceWith(input)
  input.focus()
  input.setSelectionRange(input.value.length, input.value.length)

  let settled = false
  const finish = async (save) => {
    if (settled) return
    settled = true
    editingId = null
    const next = input.value.trim()
    if (save && next && next !== todo.title) {
      try {
        await patch(todo.id, { title: next })
        announce(`Renamed to ${next}`)
        return
      } catch (err) {
        showError(err.message)
      }
    }
    render()
  }

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); finish(true) }
    if (event.key === 'Escape') { event.preventDefault(); finish(false) }
  })
  input.addEventListener('blur', () => finish(true))
}

function render () {
  const visible = todos.filter((todo) => {
    if (filter === 'open') return !todo.done
    if (filter === 'done') return todo.done
    return true
  })

  els.matches.replaceChildren(...visible.map(buildMatch))
  els.boardHeading.textContent = FILTER_HEADINGS[filter]

  const done = todos.filter((todo) => todo.done).length
  const total = todos.length
  els.tally.total.textContent = total
  els.tally.done.textContent = done
  els.tally.remaining.textContent = total - done

  els.empty.hidden = visible.length > 0
  if (visible.length === 0 && total > 0) {
    els.empty.querySelector('.empty__title').textContent =
      filter === 'done' ? 'No results yet' : 'Every match is off court'
    els.empty.querySelector('.empty__body').textContent =
      filter === 'done'
        ? 'Nothing has finished. Tick a box when a job is won.'
        : 'The whole schedule is complete. Put the covers on.'
  } else if (visible.length === 0) {
    els.empty.querySelector('.empty__title').textContent = 'No matches scheduled'
    els.empty.querySelector('.empty__body').textContent =
      'The board is bare. Write the first one on the slip above and the umpire will call it.'
  }

  els.clear.hidden = done === 0
  els.stats.textContent = total === 0
    ? 'Nothing on the board yet.'
    : `${total} scheduled · ${total - done} to play · ${done} completed`
}

async function refresh () {
  const payload = await request('/api/todos')
  todos = payload.todos
  render()
}

async function patch (id, body) {
  const { todo } = await request(`/api/todos/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
  todos = todos.map((item) => (item.id === todo.id ? todo : item))
  sortTodos()
  render()
  return todo
}

function sortTodos () {
  todos.sort((a, b) => (a.done === b.done ? a.createdAt.localeCompare(b.createdAt) : a.done ? 1 : -1))
}

async function toggle (todo, checkbox) {
  showError('')
  try {
    const updated = await patch(todo.id, { done: checkbox.checked })
    announce(updated.done ? `${updated.title} is off court` : `${updated.title} is back on the schedule`)
  } catch (err) {
    checkbox.checked = todo.done
    showError(err.message)
  }
}

async function remove (todo) {
  showError('')
  try {
    await request(`/api/todos/${todo.id}`, { method: 'DELETE' })
    todos = todos.filter((item) => item.id !== todo.id)
    render()
    announce(`Withdrew ${todo.title}`)
  } catch (err) {
    showError(err.message)
  }
}

els.form.addEventListener('submit', async (event) => {
  event.preventDefault()
  showError('')
  const title = els.title.value.trim()
  if (!title) {
    showError('Give the match a name before you schedule it.')
    els.title.focus()
    return
  }
  try {
    const { todo } = await request('/api/todos', {
      method: 'POST',
      body: JSON.stringify({ title, note: els.note.value, court: els.court.value || null })
    })
    todos.push(todo)
    sortTodos()
    els.form.reset()
    els.title.focus()
    render()
    announce(`${todo.title} added to the order of play`)
  } catch (err) {
    showError(err.message)
  }
})

for (const chip of document.querySelectorAll('.chip')) {
  chip.addEventListener('click', () => {
    filter = chip.dataset.filter
    for (const other of document.querySelectorAll('.chip')) {
      other.classList.toggle('is-active', other === chip)
    }
    render()
  })
}

els.clear.addEventListener('click', async () => {
  showError('')
  try {
    const { removed } = await request('/api/todos/completed', { method: 'DELETE' })
    todos = todos.filter((todo) => !todo.done)
    render()
    announce(`Cleared ${removed} completed ${removed === 1 ? 'match' : 'matches'}`)
  } catch (err) {
    showError(err.message)
  }
})

els.dateline.textContent = new Date().toLocaleDateString([], {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
})

refresh().catch((err) => showError(`Could not load the schedule: ${err.message}`))
