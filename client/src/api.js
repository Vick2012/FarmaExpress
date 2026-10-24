const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const TOKEN_KEY = 'farmaexpress.token';

const storage = {
  get() {
    try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  set(value) {
    try {
      if (value) sessionStorage.setItem(TOKEN_KEY, value);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch { /* almacenamiento no disponible: la sesión vive solo en memoria */ }
  },
};

let token = storage.get();
let onSessionExpired = () => {};

export const getToken = () => token;
export function setToken(value) {
  token = value;
  storage.set(value);
}
export function setSessionExpiredHandler(handler) {
  onSessionExpired = handler;
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Llama a la API con el token de sesión. El servidor devuelve un token
 * renovado en `x-session-token` en cada respuesta: así la sesión dura
 * mientras haya actividad y expira tras 15 minutos sin ella (RNF-03).
 */
export async function api(path, { method = 'GET', body, params } = {}) {
  const url = new URL(`${API_BASE}${path}`);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  });

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'No hay conexión con el servidor de FarmaExpress.');
  }

  const renewed = response.headers.get('x-session-token');
  if (renewed) setToken(renewed);

  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && token) {
    setToken(null);
    onSessionExpired(data.message || 'La sesión expiró.');
  }
  if (!response.ok) throw new ApiError(response.status, data.message || `Error ${response.status}`);
  return data;
}
