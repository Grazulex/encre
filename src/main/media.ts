// Table des types MIME des images acceptées par les exports (EPUB embarque,
// PDF référence en file://). Elle vivait dans src/main/epub.ts, ce qui obligeait
// le moteur PDF à importer tout le moteur EPUB pour cinq entrées ; elle est ici
// pour que les deux la partagent sans se connaître.
export const IMAGE_MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
}
