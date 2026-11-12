// Asks which workspace gets a new query document when DB Studio cannot tell. E1, X1
import { Button, Card, List, ListItem, read, Stack, Text } from 'orca'
import {
  answerWorkspaceQuestion,
  cancelWorkspaceQuestion,
  type WorkspaceAction,
  workspaceQuestion,
} from './state'

// No default: a new WorkspaceAction kind fails to compile until it has a title.
function workspaceQuestionTitle(action: WorkspaceAction): string {
  switch (action.kind) {
    case 'table':
      return `Open ${action.table.table} in which workspace?`
    case 'new-query':
      return 'New query in which workspace?'
  }
}

export function WorkspacePicker() {
  const question = read(workspaceQuestion)
  if (!question) return null
  return (
    <Card title={workspaceQuestionTitle(question.action)}>
      <Stack gap="sm">
        <Text muted>The query document goes in .db-studio/ of the workspace you pick.</Text>
        <List label="Workspaces">
          {question.workspaces.map((workspace) => (
            <ListItem
              key={workspace.id}
              title={workspace.name}
              icon="folder"
              onPress={() => answerWorkspaceQuestion(question, workspace.id)}
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
