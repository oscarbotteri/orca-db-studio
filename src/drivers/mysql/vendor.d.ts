// The worker bundle of vendor/ carries no types of its own.
declare module '*/vendor/mysql2.js' {
  export { default as mysql } from 'mysql2'
}
