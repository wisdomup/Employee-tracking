/**
 * Human-readable message from an Axios/fetch failure for toast display.
 */
export function getApiErrorMessage(err: unknown, fallback: string): string {
  const e = err as {
    message?: string;
    code?: string;
    response?: { data?: { message?: string; errors?: string[] } };
  };

  if (e.code === 'ERR_NETWORK' || e.message === 'Network Error') {
    return 'Cannot reach the API. Start the backend on port 8001 (or set NEXT_PUBLIC_API_URL in admin/.env.local).';
  }

  const data = e.response?.data;
  if (data && Array.isArray(data.errors) && data.errors.length > 0) {
    return data.errors.join(' ');
  }
  if (data?.message && typeof data.message === 'string') {
    return data.message;
  }

  return fallback;
}
