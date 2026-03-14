import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Simple API key authentication middleware.
 * Validates the Authorization: Bearer <key> header against CBRD_API_KEY env var.
 */
export function validateApiKey(req: IncomingMessage, res: ServerResponse): boolean {
  const apiKey = process.env.CBRD_API_KEY;

  // If no API key is configured, allow all requests (development mode)
  if (!apiKey) {
    return true;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing Authorization header' }));
    return false;
  }

  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || token !== apiKey) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid API key' }));
    return false;
  }

  return true;
}
