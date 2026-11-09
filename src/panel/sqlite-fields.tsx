// The connection form's fields for a SQLite file: a pasted path, or one found in the workspaces. C3
import { Button, Input, List, ListItem, read, Spinner, Text } from 'orca'
import {
  chooseFoundFile,
  editDraft,
  type FormDraft,
  findInWorkspaces,
  findingFiles,
} from './connection-form-state'
import { foundFiles } from './state'

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
          onPress={() => chooseFoundFile(file)}
        />
      ))}
    </List>
  )
}

interface SqliteFieldsProps {
  draft: FormDraft
}

export function SqliteFields({ draft }: SqliteFieldsProps) {
  return (
    <>
      <Input
        label="Path"
        placeholder="/path/to/database.db"
        value={draft.path}
        onChange={(path) => editDraft({ path })}
      />
      {read(findingFiles) ? (
        <FoundFiles />
      ) : (
        <Button variant="ghost" onPress={findInWorkspaces}>
          Find in workspaces
        </Button>
      )}
      {draft.ref === undefined ? null : (
        <Text muted>Deleting only forgets the file. It stays on disk.</Text>
      )}
    </>
  )
}
