import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'

const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' }

const items = [{ id: 1, name: 'Oats', qty: 2 }, { id: 2, name: 'Rice', qty: 1 }]

createServer(async (req, res) => {
  if (req.url === '/api/items' && req.method === 'GET') {
    await new Promise((r) => setTimeout(r, 1200))
    return res.end(JSON.stringify(items))
  }
  if (req.url === '/api/items' && req.method === 'POST') {
    let body = ''
    for await (const chunk of req) body += chunk
    items.push({ id: items.length + 1, ...JSON.parse(body) })
    return res.end('{}')
  }
  const file = req.url === '/' ? 'index.html' : req.url.slice(1)
  try {
    const body = await readFile(new URL(`../src/${file}`, import.meta.url))
    res.setHeader('content-type', types[extname(file)] ?? 'text/plain')
    res.end(body)
  } catch {
    res.statusCode = 404
    res.end()
  }
}).listen(process.env.PORT ?? 4310, '127.0.0.1')
