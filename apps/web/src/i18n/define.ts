// strings(): an area's English and Brazilian Portuguese side by side, one key per line:
//   export default strings({ "lobby.play": ["Play", "Jogar"] });
// en.ts and pt-BR.ts merge every area, so each key always has both languages.

export type Pair = readonly [en: string, pt: string];

export function strings<T extends Record<string, Pair>>(d: T): { en: { [K in keyof T]: string }; pt: { [K in keyof T]: string } } {
  const en = {} as { [K in keyof T]: string };
  const pt = {} as { [K in keyof T]: string };
  for (const k of Object.keys(d) as (keyof T)[]) {
    en[k] = d[k][0];
    pt[k] = d[k][1];
  }
  return { en, pt };
}
