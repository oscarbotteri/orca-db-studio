// Removing a SQLite file from the list; the file on disk is never touched. C1
import { Button, Callout, Card, Row, read, Stack, Text } from 'orca'
import { cancelRemoval, connections, removal, removeSqliteFile } from './state'

export function RemoveSqliteFile() {
  const pending = read(removal)
  const entry = pending?.entry
  const list = read(connections)
  // The card is kept across tab switches, so the file may have gone since.
  const listed =
    list.status === 'loaded' && list.value.sqliteFiles.some((e) => e.ref === entry?.ref)
  if (!pending || !entry || !listed) return null
  return (
    <Card title={entry.name}>
      <Stack gap="sm">
        <Text muted>{entry.ref}</Text>
        <Text>Removing only forgets the file. It stays on disk and can be added again.</Text>
        {pending.error ? (
          <Callout tone="danger" title="Could not remove the file">
            {pending.error}
          </Callout>
        ) : null}
        <Row gap="sm" justify="end">
          <Button variant="ghost" onPress={cancelRemoval}>
            Cancel
          </Button>
          <Button variant="ghost" tone="danger" onPress={() => void removeSqliteFile(entry.ref)}>
            Remove
          </Button>
        </Row>
      </Stack>
    </Card>
  )
}
