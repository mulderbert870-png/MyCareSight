/** Safe filename for the browser download attribute. */
export function sanitizeDownloadFilename(name: string): string {
  const base = name.trim() || 'document'
  return base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 255)
}
