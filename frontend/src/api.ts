// Accès unique au serveur. En phase 5, cette couche passera par IndexedDB + file d'attente.

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "X-Requested-With": "myworkshop" };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      headers,
      body: payload,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "network", "Serveur injoignable.");
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      data?.code ?? "error",
      data?.message ?? (typeof data?.detail === "string" ? data.detail : `Erreur ${response.status}`),
    );
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  del: (path: string) => request<void>("DELETE", path),
};

/** UUID v4. crypto.randomUUID n'existe qu'en HTTPS ou localhost : on passe par getRandomValues sinon. */
export function newId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const thumbUrl = (id: string) => `/api/v1/attachments/${id}/thumb`;
export const fileUrl = (id: string) => `/api/v1/attachments/${id}/file`;

export function formatQty(value: string | null | undefined, unit?: string | null): string {
  if (value == null) return "";
  const n = Number(value);
  const text = Number.isInteger(n) ? String(n) : n.toLocaleString("fr-FR");
  return unit ? `${text} ${unit}` : text;
}
