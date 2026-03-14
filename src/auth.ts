import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Simple API key authentication middleware.
 * Accepts API key via:
 *   1. Authorization: Bearer <key> header
 *   2. ?api_key=<key> query parameter
 */
export function validateApiKey(req: IncomingMessage, res: ServerResponse): boolean {
  const apiKey = process.env.CBRD_API_KEY;

  // If no API key is configured, allow all requests (development mode)
  if (!apiKey) {
    return true;
  }

  // Check Authorization header first
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const [scheme, token] = authHeader.split(' ');
    if (scheme === 'Bearer' && token === apiKey) {
      return true;
    }
  }

  // Check query parameter
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const queryKey = url.searchParams.get('api_key');
  if (queryKey === apiKey) {
    return true;
  }

  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Invalid or missing API key' }));
  return false;
}
