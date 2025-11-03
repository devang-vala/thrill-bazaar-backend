import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { prisma } from './db.js'

const app = new Hono()

app.get('/', (c) => {
  return c.text('Hello, Thrill Bazaar Dev!')
})

serve({
  fetch: app.fetch,
  port: 3000
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
})
