/** Prefix heights for variable-row lookup windows; queries and measurements are logarithmic. */
export class DwChoiceRows {
  readonly count: number
  private heights: Float64Array
  private sums: Float64Array

  constructor(count: number, estimate: number) {
    if (!Number.isInteger(count) || count < 1 || count > 0x7fffffff ||
      !Number.isFinite(estimate) || estimate <= 0) throw new RangeError('Invalid lookup row dimensions')
    this.count = count
    this.heights = new Float64Array(count).fill(estimate)
    this.sums = new Float64Array(count + 1)
    for (let index = 1; index <= count; index++) this.sums[index] = (index & -index) * estimate
  }

  offset(index: number): number {
    if (!Number.isInteger(index) || index < 0 || index > this.count) throw new RangeError('Invalid lookup row boundary')
    let sum = 0
    for (; index > 0; index -= index & -index) sum += this.sums[index]
    return sum
  }

  measure(index: number, height: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.count ||
      !Number.isFinite(height) || height <= 0) throw new RangeError('Invalid lookup row measurement')
    const delta = height - this.heights[index]
    if (!delta) return
    this.heights[index] = height
    for (index++; index <= this.count; index += index & -index) this.sums[index] += delta
  }

  at(offset: number): number {
    if (!Number.isFinite(offset)) throw new RangeError('Invalid lookup scroll offset')
    let index = 0, sum = 0
    for (let step = 2 ** Math.floor(Math.log2(this.count)); step >= 1; step /= 2) {
      const next = index + step
      if (next <= this.count && sum + this.sums[next] <= offset) {
        sum += this.sums[next]
        index = next
      }
    }
    return Math.min(index, this.count - 1)
  }
}
