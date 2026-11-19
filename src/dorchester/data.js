export async function loadPak(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not load ${url}`)
  let buffer = await response.arrayBuffer()
  const head = new Uint8Array(buffer, 0, 2)
  if (head[0] === 0x1f && head[1] === 0x8b) {
    const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))
    buffer = await new Response(stream).arrayBuffer()
  }
  return buffer
}

export async function loadJsonPak(url) {
  return JSON.parse(new TextDecoder().decode(await loadPak(url)))
}

export function parseBuildings(buffer) {
  const view = new DataView(buffer)
  const count = view.getUint32(4, true)
  const corners = view.getUint32(8, true)
  let at = 12
  const sides = new Uint8Array(buffer, at, count); at += count
  const types = new Uint8Array(buffer, at, count); at += count
  const flags = new Uint8Array(buffer, at, count); at += count
  const heights = new Uint16Array(buffer.slice(at, at + count * 2)); at += count * 2
  const xs = new Int16Array(buffer.slice(at, at + corners * 2)); at += corners * 2
  const ys = new Int16Array(buffer.slice(at, at + corners * 2))
  return { count, sides, types, flags, heights, xs, ys }
}

export class Path {
  constructor(flat) {
    this.x = []; this.y = []; this.s = [0]
    for (let i = 0; i < flat.length; i += 2) {
      this.x.push(flat[i]); this.y.push(flat[i + 1])
      if (i) this.s.push(this.s[this.s.length - 1] + Math.hypot(flat[i] - flat[i - 2], flat[i + 1] - flat[i - 1]))
    }
    this.length = this.s[this.s.length - 1]
  }
  at(distance, out = {}) {
    const d = Math.max(0, Math.min(this.length, distance))
    let lo = 0, hi = this.s.length - 1
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.s[m] <= d) lo = m; else hi = m }
    const span = this.s[hi] - this.s[lo] || 1
    const k = (d - this.s[lo]) / span
    out.x = this.x[lo] + (this.x[hi] - this.x[lo]) * k
    out.y = this.y[lo] + (this.y[hi] - this.y[lo]) * k
    out.dx = (this.x[hi] - this.x[lo]) / span
    out.dy = (this.y[hi] - this.y[lo]) / span
    return out
  }
  nearest(x, y) {
    let best = 0, bestD = Infinity
    for (let i = 1; i < this.x.length; i++) {
      const ax = this.x[i - 1], ay = this.y[i - 1], bx = this.x[i] - ax, by = this.y[i] - ay
      const l = bx * bx + by * by || 1
      const k = Math.max(0, Math.min(1, ((x - ax) * bx + (y - ay) * by) / l))
      const d = Math.hypot(x - ax - bx * k, y - ay - by * k)
      if (d < bestD) { bestD = d; best = this.s[i - 1] + (this.s[i] - this.s[i - 1]) * k }
    }
    return best
  }
}
