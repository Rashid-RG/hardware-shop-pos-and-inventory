const isSafeDataImage = (value: string) => /^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,[a-z0-9+/=]+$/i.test(value);

const isSafeRelativePath = (value: string) => value.startsWith('/uploads/') || value.startsWith('/assets/') || value.startsWith('/images/');

export const sanitizeImageSrc = (value?: string | null): string | undefined => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return undefined;
  }

  if (normalized.startsWith('data:')) {
    return isSafeDataImage(normalized) ? normalized : undefined;
  }

  if (normalized.startsWith('/')) {
    return isSafeRelativePath(normalized) ? normalized : undefined;
  }

  if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
    try {
      const url = new URL(normalized);
      return url.protocol === 'http:' || url.protocol === 'https:' ? normalized : undefined;
    } catch {
      return undefined;
    }
  }

  return undefined;
};