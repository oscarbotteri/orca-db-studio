/**
 * The `default` of a switch that must handle every case: passing it anything but `never` fails to
 * compile, so a new variant of the union is caught where it is not handled yet.
 */
export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(value)}`)
}
