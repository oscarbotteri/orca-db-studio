// The worker bundle of vendor/ carries no types of its own.
declare module '*/vendor/pg.js' {
  export { default as pg } from 'pg'
  export { default as Cursor } from 'pg-cursor'
}
