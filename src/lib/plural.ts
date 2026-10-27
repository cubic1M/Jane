// A count with its noun: "1 bill", "3 bills"; pass the plural when it isn't the noun plus s
// ("2 policies").
export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;
