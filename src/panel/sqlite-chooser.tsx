// The SQLite file chooser: files found in the workspaces, or a pasted absolute path. C3, X3
import {
  atom,
  Button,
  Callout,
  Card,
  Input,
  List,
  ListItem,
  Row,
  read,
  Spinner,
  Stack,
  set,
  Text,
} from 'orca'
import { addError, adding, addSqliteFile, closeChooser, foundFiles } from './state'

const pathDraft = atom('')

function FoundFiles() {
  const found = read(foundFiles)
  if (found.status === 'loading') return <Spinner label="Looking for SQLite files" />
  if (found.status === 'error') return <Text tone="danger">{found.error}</Text>
  if (found.value.length === 0) return <Text muted>No SQLite files found in your workspaces.</Text>
  return (
    <List label="SQLite files in your workspaces">
      {found.value.map((file) => (
        <ListItem
          key={file.path}
          title={file.relativePath}
          description={file.workspaceName}
          icon="database"
          disabled={read(adding)}
          onPress={() => addSqliteFile(file.path)}
        />
      ))}
    </List>
  )
}

export function SqliteChooser() {
  const error = read(addError)
  return (
    <Card
      title="Open SQLite file"
      description="Pick a file found in your workspaces, or paste an absolute path."
    >
      <Stack gap="sm">
        <FoundFiles />
        <Input
          label="Absolute path"
          placeholder="/path/to/database.db"
          invalid={error !== null}
          onChange={(value) => set(pathDraft, value)}
          onSubmit={(value) => addSqliteFile(value)}
        />
        {error ? (
          <Callout tone="danger" title="Could not open the file">
            {error}
          </Callout>
        ) : null}
        <Row gap="sm" justify="end">
          <Button variant="ghost" onPress={closeChooser}>
            Cancel
          </Button>
          <Button
            tone="accent"
            disabled={read(adding)}
            onPress={() => addSqliteFile(read(pathDraft))}
          >
            Add
          </Button>
        </Row>
      </Stack>
    </Card>
  )
}
