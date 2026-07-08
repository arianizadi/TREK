import { safeFetchFollow } from '../../utils/ssrfGuard';

/**
 * Fetch an LLM endpoint. User-controlled base URLs are SSRF-checked and
 * DNS-pinned for every redirect hop; operator-controlled local endpoints keep
 * support for localhost/private-network Ollama and compatible servers.
 */
export async function fetchLlmEndpoint(
  url: string,
  init: RequestInit,
  allowUnsafeLocalBaseUrl?: boolean,
): Promise<Response> {
  if (allowUnsafeLocalBaseUrl) return fetch(url, init);
  return safeFetchFollow(url, init, { maxRedirects: 3, bypassInternalIpAllowed: true });
}
