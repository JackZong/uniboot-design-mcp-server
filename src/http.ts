import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import type { Request, Response } from 'express'
import { createMcpServer } from './create-server.js'
import { extractBearer, getApiBase } from './api.js'
import { createOAuthRouter, wwwAuthenticate } from './oauth/index.js'
import { getPublicBase } from './oauth/metadata.js'

type Session = {
  transport: StreamableHTTPServerTransport
  token: string
}

const here = path.dirname(fileURLToPath(import.meta.url))
const assetsDir = path.resolve(here, '../assets')

export function startHttpServer() {
  const port = Number(process.env.MCP_PORT ?? 8070)
  const host = process.env.MCP_HOST ?? '0.0.0.0'
  const allowedHosts = (process.env.MCP_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const app = createMcpExpressApp({
    host,
    ...(allowedHosts.length ? { allowedHosts } : {}),
  })

  const sessions = new Map<string, Session>()
  const fallbackPat = process.env.UBD_PAT ?? ''

  function resolveToken(req: Request, existing?: string): string {
    return extractBearer(req.headers.authorization) || existing || fallbackPat
  }

  app.use(createOAuthRouter())
  app.use('/assets', express.static(assetsDir))

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      name: 'uniboot-design-mcp',
      transport: 'streamable-http',
      auth: 'oauth2.1',
      apiBase: getApiBase(),
      publicUrl: getPublicBase(),
      sessions: sessions.size,
    })
  })

  app.all('/mcp', async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined

      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!
        const next = resolveToken(req, session.token)
        if (next) session.token = next
        await session.transport.handleRequest(req, res, req.body)
        return
      }

      if (!sessionId && req.method === 'POST' && isInitializeRequest(req.body)) {
        const token = resolveToken(req)
        if (!token) {
          res.setHeader('WWW-Authenticate', wwwAuthenticate('invalid_token', 'Missing bearer token'))
          res.status(401).json({
            jsonrpc: '2.0',
            error: {
              code: -32001,
              message:
                'Unauthorized: complete OAuth 2.1 (or send Authorization: Bearer <UBD_PAT>)',
            },
            id: null,
          })
          return
        }

        let sessionRef: Session | undefined
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            if (sessionRef) {
              sessions.set(sid, sessionRef)
              console.error(`MCP session ${sid}`)
            }
          },
        })

        transport.onclose = () => {
          const sid = transport.sessionId
          if (sid) sessions.delete(sid)
        }

        sessionRef = { transport, token }
        const server = createMcpServer(() => sessionRef!.token)
        await server.connect(transport)
        await transport.handleRequest(req, res, req.body)
        return
      }

      if (!extractBearer(req.headers.authorization) && !fallbackPat) {
        res.setHeader('WWW-Authenticate', wwwAuthenticate('invalid_token', 'Missing bearer token'))
        res.status(401).json({
          jsonrpc: '2.0',
          error: { code: -32001, message: 'Unauthorized' },
          id: null,
        })
        return
      }

      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid session ID provided',
        },
        id: null,
      })
    } catch (error) {
      console.error('MCP request error:', error)
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        })
      }
    }
  })

  const server = app.listen(port, host, () => {
    console.error(`uniboot-design-mcp listening on http://${host}:${port}/mcp`)
    console.error(`OAuth authorize: ${getPublicBase()}/authorize`)
    console.error(`health: http://${host}:${port}/health`)
    console.error(`API: ${getApiBase()}`)
  })

  const shutdown = async () => {
    console.error('Shutting down MCP…')
    for (const [sid, session] of sessions) {
      await session.transport.close().catch(() => undefined)
      sessions.delete(sid)
    }
    server.close(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  return server
}
