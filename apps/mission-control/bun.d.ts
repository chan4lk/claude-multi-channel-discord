declare module 'bun:sqlite' {
  export class Database {
    constructor(filename: string, options?: { create?: boolean; readonly?: boolean })
    exec(sql: string): void
    prepare(sql: string): Statement
    close(): void
  }
  export interface Statement {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number }
    get(...params: unknown[]): unknown
    all(...params: unknown[]): unknown[]
  }
}
