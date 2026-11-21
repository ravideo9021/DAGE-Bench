/**
 * Deterministic seeded PRNG (xoshiro128**) with Box–Muller Gaussian sampling.
 * Every trial in the console is reproducible from its integer seed, exactly
 * like the Python benchmark (which uses numpy.default_rng(seed)). The streams
 * differ from NumPy's, so individual trials differ, but the distributions match.
 */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  private spare: number | null = null;

  constructor(seed: number) {
    // splitmix32 expansion of the seed into 128 bits of state
    let s = seed >>> 0;
    const next = () => {
      s = (s + 0x9e3779b9) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.a = next();
    this.b = next();
    this.c = next();
    this.d = next();
  }

  nextU32(): number {
    const result = Math.imul(rotl(Math.imul(this.b, 5), 7), 9) >>> 0;
    const t = this.b << 9;
    this.c ^= this.a;
    this.d ^= this.b;
    this.b ^= this.c;
    this.a ^= this.d;
    this.c ^= t;
    this.d = rotl(this.d, 11);
    return result;
  }

  /** Uniform in [0, 1) with 53 bits of resolution. */
  random(): number {
    const hi = this.nextU32() >>> 5;
    const lo = this.nextU32() >>> 6;
    return (hi * 67108864 + lo) / 9007199254740992;
  }

  uniform(lo: number, hi: number): number {
    return lo + (hi - lo) * this.random();
  }

  normal(mean = 0, std = 1): number {
    if (this.spare !== null) {
      const v = this.spare;
      this.spare = null;
      return mean + std * v;
    }
    let u = 0;
    while (u === 0) u = this.random();
    const v = this.random();
    const r = Math.sqrt(-2 * Math.log(u));
    const th = 2 * Math.PI * v;
    this.spare = r * Math.sin(th);
    return mean + std * r * Math.cos(th);
  }
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}
