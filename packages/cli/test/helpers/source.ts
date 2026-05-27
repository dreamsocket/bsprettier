function interpolate(
  strings: TemplateStringsArray,
  values: readonly unknown[],
): string {
  let text = "";
  for (let i = 0; i < strings.length; i++) {
    text += strings[i];
    if (i < values.length) text += String(values[i]);
  }
  return text;
}

export function source(
  strings: TemplateStringsArray,
  ...values: readonly unknown[]
): string {
  let text = interpolate(strings, values).replace(/^\n/, "");
  const lines = text.split("\n");

  if (lines.at(-1)?.trim() === "") lines.pop();

  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => line.match(/^ */)?.[0].length ?? 0);
  const minIndent = indents.length > 0 ? Math.min(...indents) : 0;
  text = lines.map((line) => line.slice(minIndent)).join("\n");

  return `${text}\n`;
}

export const brs = source;
export const xml = source;
