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

/**
 * Text safe inside a generated code comment (line, block, HTML or Swift/Dart doc comments):
 * line terminators become spaces, and block and HTML comment openers and closers are removed
 * until none are left, so stripping one cannot rebuild another.
 */
export function commentText(text: string): string {
  let out = text.replace(/[\r\n\u2028\u2029]+/g, ' ');
  for (let prev = ''; prev !== out; ) {
    prev = out;
    out = out.replace(/\*\/|\/\*|<!--|--!?>/g, '');
  }
  return out;
}
