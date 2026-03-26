import fs from 'fs';
import path from 'path';

const UPLOAD_PATH = process.env.UPLOAD_PATH || './uploads';
const SUBDIRS = ['profiles', 'shops', 'tasks', 'completions', 'categories', 'products', 'general', 'catalogs', 'task-documents', 'returns'];

export function ensureUploadDirectories(): void {
  if (!fs.existsSync(UPLOAD_PATH)) {
    fs.mkdirSync(UPLOAD_PATH, { recursive: true });
  }

  for (const subdir of SUBDIRS) {
    const dirPath = path.join(UPLOAD_PATH, subdir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }
}

/**
 * Save an uploaded file to disk and return its public URL.
 * @param file - multer file object
 * @param category - subfolder name (profiles | shops | tasks | completions)
 */
export async function saveFile(
  file: Express.Multer.File,
  category: string,
): Promise<string> {
  const filename = `${Date.now()}-${file.originalname}`;
  const filepath = path.join(UPLOAD_PATH, category, filename);
  fs.writeFileSync(filepath, file.buffer);
  return `/uploads/${category}/${filename}`;
}

export async function deleteFile(fileUrl: string): Promise<void> {
  try {
    const filepath = path.join(process.cwd(), fileUrl);
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }
  } catch (error) {
    console.error('Error deleting file:', error);
  }
}

export function validateFileType(mimetype: string, allowedTypes: string[]): boolean {
  return allowedTypes.includes(mimetype);
}

export function validateFileSize(size: number, maxSizeBytes: number): boolean {
  return size <= maxSizeBytes;
}
