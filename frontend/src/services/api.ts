import { API_BASE_URL } from '../constants';

// Helper to handle API requests including credentials (cookies)
export const apiRequest = async <T,>(endpoint: string, method: 'GET' | 'POST', body?: any): Promise<T> => {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  const config: RequestInit = {
    method,
    headers,
    credentials: 'include', // Important: Sends the 'sid' cookie to backend
  };

  if (body) {
    config.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, config);
    
    // Handle non-200 responses that might return JSON errors
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || data.msg || `Error: ${response.status}`);
    }

    return data as T;
  } catch (error: any) {
    console.error(`API Request Failed [${endpoint}]:`, error);
    throw error;
  }
};