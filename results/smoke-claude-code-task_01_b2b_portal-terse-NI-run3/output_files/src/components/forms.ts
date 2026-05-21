/** Tiny client-side fetch helper shared by all forms. */
"use client";

export interface ApiResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
  error?: string;
}

export async function apiFetch<T = unknown>(
  url: string,
  options: { method?: string; body?: unknown } = {},
): Promise<ApiResult<T>> {
  const res = await fetch(url, {
    method: options.method ?? "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  const err =
    !res.ok && data && typeof data === "object" && "error" in data
      ? String((data as { error: unknown }).error)
      : undefined;
  return { ok: res.ok, status: res.status, data: data as T, error: err };
}
