export async function supabase(endpoint, options = {}) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!base || !key) {
    const error = new Error('Supabase is not configured');
    error.code = 'SUPABASE_NOT_CONFIGURED';
    throw error;
  }

  const headers = {
    apikey: key,
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  return fetch(`${base.replace(/\/$/, '')}/rest/v1/${endpoint}`, { ...options, headers });
}

export async function supabaseErrorCode(response) {
  try {
    const body = await response.clone().json();
    return typeof body.code === 'string' && /^[A-Z0-9]{1,12}$/i.test(body.code) ? body.code : undefined;
  } catch {
    return undefined;
  }
}
