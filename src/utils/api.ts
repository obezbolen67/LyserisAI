// src/utils/api.ts

export const API_BASE_URL = import.meta.env.VITE_API_URL || 
  (import.meta.env.DEV ? 'http://localhost:3001' : 'https://lyserisaiserver-215678188656.europe-west1.run.app');

/**
 * A wrapper around the native `fetch` function that automatically adds
 * the 'Content-Type' and 'x-auth-token' headers for authenticated JSON requests.
 * @param endpoint The API endpoint (e.g., '/settings')
 * @param options The standard fetch options object
 * @returns A Promise that resolves to the Response object
 */
export const api = async (endpoint: string, options: RequestInit = {}): Promise<Response> => {
  const token = localStorage.getItem('fexo-token');

  const headers = new Headers(options.headers || {});

  // Set default content type if not already provided and there's a body
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  // Add the auth token to the headers if it exists
  if (token) {
    headers.set('x-auth-token', token);
  }

  const config: RequestInit = {
    ...options,
    headers,
  };

  // Log the request details (will be auto-suppressed in PROD via main.tsx)
  const method = (config.method || 'GET').toString().toUpperCase();
  const hasBody = !!config.body;
  
  // Use console.debug for verbose API logs
  console.debug('[API Request] →', method, `/api${endpoint}`, { hasBody, headers: Object.fromEntries(headers) });

  try {
    const resp = await fetch(`${API_BASE_URL}/api${endpoint}`, config);
    console.debug('[API Response] ←', resp.status, resp.statusText, `/api${endpoint}`);
    return resp;
  } catch (error) {
    console.error('[API Error]', method, endpoint, error);
    throw error;
  }
};

/**
 * A dedicated function for uploading a single file using FormData.
 * @param file The file object to upload.
 * @returns A Promise that resolves to the JSON response from the server.
 */
export const uploadFile = async (file: File): Promise<any> => {
  const formData = new FormData();
  formData.append('file', file); // 'file' must match the key in multer's upload.single('file')

  const token = localStorage.getItem('fexo-token');
  const headers = new Headers();
  if (token) {
    headers.set('x-auth-token', token);
  }

  console.debug('[API Upload] → POST /api/files/upload', file.name);

  const response = await fetch(`${API_BASE_URL}/api/files/upload`, {
    method: 'POST',
    headers: headers, // NOTE: Do NOT set Content-Type, the browser does it for FormData
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(errorData.error || 'Failed to upload file');
  }

  console.debug('[API Upload] ← Success', file.name);
  return response.json();
};

export default api;
