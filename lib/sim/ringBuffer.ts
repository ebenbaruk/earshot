/** Fixed-capacity ring buffer. Oldest entries are overwritten. */
export class RingBuffer<T> {
  private readonly items: (T | undefined)[];
  private head = 0; // next write slot
  private count = 0;

  constructor(public readonly capacity: number) {
    if (capacity < 1) throw new Error("RingBuffer capacity must be >= 1");
    this.items = new Array<T | undefined>(capacity);
  }

  get size(): number {
    return this.count;
  }

  push(item: T): void {
    this.items[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count += 1;
  }

  clear(): void {
    this.items.fill(undefined);
    this.head = 0;
    this.count = 0;
  }

  /** Oldest first. */
  toArray(): T[] {
    const out: T[] = [];
    const start = (this.head - this.count + this.capacity) % this.capacity;
    for (let i = 0; i < this.count; i += 1) {
      out.push(this.items[(start + i) % this.capacity] as T);
    }
    return out;
  }

  last(): T | undefined {
    if (this.count === 0) return undefined;
    return this.items[(this.head - 1 + this.capacity) % this.capacity];
  }
}
