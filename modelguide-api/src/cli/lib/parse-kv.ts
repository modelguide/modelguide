/**
 * Parse "key=val,key=val" strings with first-`=`-only split and `\,` escape.
 */

export function parseKv(input: string): Record<string, string> {
  const result: Record<string, string> = {};

  // Split on unescaped commas
  const pairs: string[] = [];
  let current = "";
  for (let i = 0; i < input.length; i++) {
    if (input[i] === "\\" && i + 1 < input.length && input[i + 1] === ",") {
      current += ",";
      i++; // skip escaped comma
    } else if (input[i] === ",") {
      pairs.push(current);
      current = "";
    } else {
      current += input[i];
    }
  }
  pairs.push(current);

  for (const pair of pairs) {
    const eqIndex = pair.indexOf("=");
    if (eqIndex === -1) {
      throw new Error(`Invalid key=value pair: "${pair}" (missing "=")`);
    }
    const key = pair.slice(0, eqIndex).trim();
    const value = pair.slice(eqIndex + 1);
    if (!key) {
      throw new Error(`Empty key in pair: "${pair}"`);
    }
    result[key] = value;
  }

  return result;
}

/**
 * Parse multiple positional args, each being a key=value string.
 */
export function parseKvArgs(args: string[]): Record<string, string>[] {
  return args.map(parseKv);
}
