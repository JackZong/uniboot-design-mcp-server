#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMcpServer } from './create-server.js'
import { startHttpServer } from './http.js'

async function startStdio() {
  const token = process.env.UBD_PAT ?? ''
  if (!token) {
    console.error('UBD_PAT is required for stdio transport')
    process.exit(1)
  }
  const server = createMcpServer(() => token)
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

async function main() {
  const transport = (process.env.UBD_MCP_TRANSPORT ?? 'http').toLowerCase()
  if (transport === 'stdio' || process.argv.includes('--stdio')) {
    await startStdio()
    return
  }
  startHttpServer()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
