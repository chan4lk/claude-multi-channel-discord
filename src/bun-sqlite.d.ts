declare module 'bun:sqlite' {
  export class Database {
    constructor(filename: string, options?: { create?: boolean; readonly?: boolean })
    exec(sql: string): void
    prepare(sql: string): Statement
    close(): void
  }
  interface Statement {
    run(...params: unknown[]): void
    get(...params: unknown[]): unknown
    all(...params: unknown[]): unknown[]
  }
}
