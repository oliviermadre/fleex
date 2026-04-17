/**
 * Proxy GitHub user-attachment images through the backend to avoid auth issues.
 * Returns the original src for non-GitHub images.
 */
export function getProxiedImageSrc(src: string | undefined): string {
  if (!src) return '';
  return src.startsWith('https://github.com/user-attachments/')
    ? `/api/github-image/${src.replace('https://github.com/', '')}`
    : src;
}
