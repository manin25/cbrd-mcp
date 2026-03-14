import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './server.js';
import { validateApiKey } from './auth.js';
import { browserManager } from './browser/manager.js';

const PORT = parseInt(process.env.PORT || '8080', 10);

const app = express();
app.use(express.json());

// Health check endpoint (no auth required)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'cbrd-mcp', version: '1.0.0' });
});

// MCP Streamable HTTP endpoint
// Each request creates a new transport for stateless operation
app.all('/mcp', async (req, res) => {
  // Validate API key
  if (!validateApiKey(req, res)) {
    return;
  }

  try {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode
    });

    // Clean up on close
    res.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('MCP request error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Start the server
const httpServer = app.listen(PORT, '0.0.0.0', () => {
  console.log(`CBRD MCP server listening on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
  if (process.env.CBRD_API_KEY) {
    console.log('API key authentication: ENABLED');
  } else {
    console.log('API key authentication: DISABLED (set CBRD_API_KEY to enable)');
  }
  if (process.env.CBRD_CDP_URL) {
    console.log(`CDP browser: ${process.env.CBRD_CDP_URL}`);
  } else {
    console.log('CDP browser: not configured (will use local Chromium)');
  }
});

// Graceful shutdown
async function shutdown() {
  console.log('\nShutting down...');
  await browserManager.shutdown();
  httpServer.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
