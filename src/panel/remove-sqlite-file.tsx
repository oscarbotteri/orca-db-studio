// Removing a SQLite file from the list; the file on disk is never touched. C1
import { Button, Callout, Card, Row, read, Stack, Text } from 'orca'
import {
  cancelRemoval,
  connections,
  removal,
  removeError,
  removeSqliteFile,
  removing,
} from './state'

export function RemoveSqliteFile() {
  const entry = read(removal)
  const list = read(connections)
  // The card is kept across tab switches, so the file may have gone since.
  const listed =
    list.status === 'loaded' && list.value.sqliteFiles.some((e) => e.ref === entry?.ref)
  if (!entry || !listed) return null
  return (
    <Card title={entry.name}>
      <Stack gap="sm">
        <Text muted>{entry.ref}</Text>
        <Text>Removing only forgets the file. It stays on disk and can be added again.</Text>
        {read(removeError) ? (
          <Callout tone="danger" title="Could not remove the file">
            {read(removeError)}
          </Callout>
        ) : null}
        <Row gap="sm" justify="end">
          <Button variant="ghost" onPress={cancelRemoval}>
            Cancel
          </Button>
          <Button
            variant="ghost"
            tone="danger"
            disabled={read(removing)}
            onPress={() => void removeSqliteFile(entry.ref)}
          >
            Remove
          </Button>
        </Row>
      </Stack>
    </Card>
  )
}
