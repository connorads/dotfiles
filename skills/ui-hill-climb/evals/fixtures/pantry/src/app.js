const list = document.querySelector('#items')
const name = document.querySelector('#name')

async function load() {
  const items = await (await fetch('/api/items')).json()
  list.innerHTML = items.map((i) => `<li>${i.name} (${i.qty})</li>`).join('')
}

async function save(body, tries = 3) {
  try {
    await fetch('/api/items', { method: 'POST', body: JSON.stringify(body) })
  } catch {
    if (tries) return save(body, tries - 1)
  }
}

document.querySelector('#add').addEventListener('submit', async (e) => {
  e.preventDefault()
  const body = { name: name.value, qty: 1 }
  name.value = ''
  await save(body)
  await load()
})

load()
