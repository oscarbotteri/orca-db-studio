// Asks which workspace gets a new query document when the focused one is ambiguous. E1
import { Button, Card, List, ListItem, read, Stack, Text } from 'orca'
import { cancelWorkspaceQuestion, openTable, workspaceQuestion } from './state'

export function WorkspacePicker() {
  const question = read(workspaceQuestion)
  if (!question) return null
  return (
    <Card title="Open in which workspace?">
      <Stack gap="sm">
        <Text muted>{`The query document for ${question.table.table} goes in .db-studio/.`}</Text>
        <List label="Workspaces">
          {question.workspaces.map((workspace) => (
            <ListItem
              key={workspace.id}
              title={workspace.name}
              icon="folder"
              onPress={() => openTable(question.table, workspace.id)}
            />
          ))}
        </List>
        <Button variant="ghost" onPress={cancelWorkspaceQuestion}>
          Cancel
        </Button>
      </Stack>
    </Card>
  )
}
