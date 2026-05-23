export function setterHandlerName(fieldId: string): string {
  return `_set${mixedCasePropertyName(fieldId)}`;
}

function mixedCasePropertyName(name: string): string {
  const parts = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (parts.length > 1) {
    return parts.map((part) => upperFirst(part)).join("");
  }
  return upperFirst(name);
}

function upperFirst(value: string): string {
  if (value.length === 0) return value;
  return value[0]!.toUpperCase() + value.slice(1);
}
