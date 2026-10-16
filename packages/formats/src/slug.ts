/** A lowercase, dash separated name safe for files and folders, e.g. `Home Page!` → `home-page`. */
export function slugify(name: string, fallback: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-') || fallback
  );
}
