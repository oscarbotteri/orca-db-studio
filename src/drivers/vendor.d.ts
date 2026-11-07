// The worker bundles of vendor/ carry no types of their own.
declare module '*/vendor/pg.js' {
  export { default as pg } from 'pg'
  export { default as Cursor } from 'pg-cursor'
}
