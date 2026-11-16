export interface XmlNode {
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
};

/**
 * Small, tolerant XML reader for RSS/Atom feeds. It understands CDATA,
 * comments, processing instructions and namespaces, and never throws.
 */
export function parseXml(input: string): XmlNode {
  const source = input.replace(/^\uFEFF/, "");
  const root: XmlNode = { name: "#root", attributes: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  let cursor = 0;

  while (cursor < source.length) {
    const lt = source.indexOf("<", cursor);
    if (lt === -1) {
      appendText(stack[stack.length - 1]!, source.slice(cursor), true);
      break;
    }
    if (lt > cursor) {
      appendText(stack[stack.length - 1]!, source.slice(cursor, lt), true);
    }

    if (source.startsWith("<!--", lt)) {
      const end = source.indexOf("-->", lt + 4);
      cursor = end === -1 ? source.length : end + 3;
      continue;
    }

    if (source.startsWith("<![CDATA[", lt)) {
      const end = source.indexOf("]]>", lt + 9);
      appendText(stack[stack.length - 1]!, source.slice(lt + 9, end === -1 ? source.length : end), false);
      cursor = end === -1 ? source.length : end + 3;
      continue;
    }

    if (source.startsWith("<?", lt)) {
      const end = source.indexOf("?>", lt + 2);
      cursor = end === -1 ? source.length : end + 2;
      continue;
    }

    if (source.startsWith("<!", lt)) {
      const end = findTagEnd(source, lt);
      cursor = end === -1 ? source.length : end + 1;
      continue;
    }

    const gt = findTagEnd(source, lt);
    if (gt === -1) break;

    const raw = source.slice(lt + 1, gt).trim();
    cursor = gt + 1;
    if (!raw) continue;

    if (raw.startsWith("/")) {
      const name = localName(raw.slice(1).trim());
      for (let index = stack.length - 1; index > 0; index -= 1) {
        if (stack[index]!.name === name) {
          stack.length = index;
          break;
        }
      }
      continue;
    }

    const selfClosing = raw.endsWith("/");
    const body = selfClosing ? raw.slice(0, -1).trimEnd() : raw;
    const split = body.search(/\s/);
    const node: XmlNode = {
      name: localName(split === -1 ? body : body.slice(0, split)),
      attributes: parseAttributes(split === -1 ? "" : body.slice(split)),
      children: [],
      text: "",
    };

    stack[stack.length - 1]!.children.push(node);
    if (!selfClosing) stack.push(node);
  }

  return root;
}

export function findChild(node: XmlNode, ...names: string[]): XmlNode | undefined {
  const wanted = new Set(names.map(localName));
  return node.children.find((child) => wanted.has(child.name));
}

export function findChildren(node: XmlNode, ...names: string[]): XmlNode[] {
  const wanted = new Set(names.map(localName));
  return node.children.filter((child) => wanted.has(child.name));
}

export function findDescendants(node: XmlNode, name: string): XmlNode[] {
  const wanted = localName(name);
  const found: XmlNode[] = [];
  for (const child of node.children) {
    if (child.name === wanted) found.push(child);
    found.push(...findDescendants(child, wanted));
  }
  return found;
}

export function textOf(node: XmlNode | undefined): string {
  if (!node) return "";
  let value = node.text;
  for (const child of node.children) value += textOf(child);
  return value.trim();
}

function appendText(node: XmlNode, value: string, decode: boolean): void {
  if (!value) return;
  node.text += decode ? decodeEntities(value) : value;
  // Keep XML whitespace inside CDATA but trim tag-level indentation later.
}

function localName(name: string): string {
  const trimmed = name.trim().toLowerCase();
  const colon = trimmed.lastIndexOf(":");
  return colon === -1 ? trimmed : trimmed.slice(colon + 1);
}

function findTagEnd(source: string, start: number): number {
  let quote: string | null = null;
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ">") return index;
  }
  return -1;
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([:\w.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of source.matchAll(pattern)) {
    const key = localName(match[1] ?? "");
    if (!key) continue;
    attributes[key] = decodeEntities(match[2] ?? match[3] ?? "");
  }
  return attributes;
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) ? safeCodePoint(code) : match;
    }
    if (lower.startsWith("#")) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) ? safeCodePoint(code) : match;
    }
    return ENTITIES[lower] ?? match;
  });
}

function safeCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}
