export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const allowedOrigin = Deno.env.get('ALLOWED_ORIGIN') ?? '*';

export const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigin,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/** Wraps a handler with CORS preflight, method check and uniform error responses. */
export function handle(fn: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return json({ error: 'Yalnızca POST desteklenir' }, 405);
    try {
      return await fn(req);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error('Unhandled error', err);
      return json({ error: 'Beklenmeyen bir hata oluştu' }, 500);
    }
  };
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object');
    return body as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Geçersiz istek gövdesi');
  }
}
