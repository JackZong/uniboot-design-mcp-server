import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerResources } from './resources.js'
import { registerTools, type TokenProvider } from './tools.js'

export type { TokenProvider }

export function createMcpServer(getToken: TokenProvider) {
  const server = new McpServer({
    name: 'uniboot-design-mcp',
    version: '1.0.0',
  })
  registerTools(server, getToken)
  registerResources(server, getToken)
  return server
}
