// Asks which workspace gets a new query document when DB Studio cannot tell. E1, X1
import { Button, Card, List, ListItem, read, Stack, Text } from 'orca'
import { assertNever } from '../utils/assert-never'
import {
  type ActionAwaitingWorkspace,
  answerWorkspaceQuestion,
  cancelWorkspaceQuestion,
  workspaceQuestion,
} from './state'

function workspaceQuestionTitle(action: ActionAwaitingWorkspace): string {
  switch (action.kind) {
    case 'table':
      return `Open ${action.table.table} in which workspace?`
    case 'new-query':
      return 'New query in which workspace?'
    default:
      return assertNever(action)
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
