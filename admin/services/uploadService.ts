import api from './api';

/**
 * Upload an image file. Returns the public URL of the stored file.
 * @param file - image file from input
 * @param category - one of: profiles | shops | products | categories | general | completions
 */
export async function uploadImage(file: File, category: string): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const response = await api.post<{ url: string }>(`/upload?category=${encodeURIComponent(category)}`, form);
  return response.data.url;
}
