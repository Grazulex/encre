// Convertit un chemin absolu stocké en base (imagePath d'une fiche, coverPath
// d'un livre) en URL chargeable par le renderer. La CSP (index.html)
// n'autorise pas file:// dans img-src : seul le protocole encre-media
// (src/main/index.ts), qui ne sert que le dossier media de userData, peut
// afficher ces images. On ne transmet que le nom de fichier (basename), pas
// le chemin complet — le main reconstruit et vérifie le chemin réel côté
// serveur (garde anti-traversée).
export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null
  const basename = path.split(/[\\/]/).pop()
  if (!basename) return null
  return `encre-media://${encodeURIComponent(basename)}`
}
