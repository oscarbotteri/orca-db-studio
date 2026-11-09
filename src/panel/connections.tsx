// One list of saved and worktree connections, and the explorer tree. C1-C4, E1
import {
  Button,
  Callout,
  EmptyState,
  Heading,
  IconButton,
  Row,
  read,
  Skeleton,
  Stack,
  Text,
  Tree,
  type TreeItem,
} from 'orca'
import { panelDescription } from '../environment-label'
import type { ConnectionEntry, SchemaNode } from '../protocol'
import { editError, openEditForm, openNewForm } from './connection-form-state'
import {
  connectionKey,
  connections,
  expanded,
  objects,
  openError,
  openTable,
  parseKey,
  schemaKey,
  type TableRef,
  toggle,
  treeKey,
} from './state'
import { WorkspacePicker } from './workspace-picker'

/** Tree key of a table, which carries what opening it needs. */
function objectKey(ref: string, schema: string, table: string): string {
  return treeKey('object', ref, schema, table)
}

function tableOfKey(key: string): TableRef | undefined {
  const parts = parseKey(key)
  if (parts?.[0] !== 'object') return undefined
  const [, ref, schema, table] = parts
  if (typeof ref !== 'string' || typeof schema !== 'string' || typeof table !== 'string') {
    return undefined
  }
  return { ref, schema, table }
}

function schemaItem(ref: string, schema: SchemaNode): TreeItem {
  return {
    key: schemaKey(ref, schema.name),
    label: schema.name,
    icon: 'layers',
    children: schema.objects.map((object) => ({
      key: objectKey(ref, schema.name, object.name),
      label: object.name,
      icon: object.kind === 'view' ? 'file-text' : 'file',
      ...(object.kind === 'view' ? { description: 'view' } : {}),
    })),
  }
}

function connectionItem(entry: ConnectionEntry): TreeItem {
  const worktree = entry.origin === 'worktree'
  const item = {
    key: connectionKey(entry.ref),
    label: entry.name,
    description: panelDescription(entry),
    icon: worktree ? ('branch' as const) : ('database' as const),
  }
  const state = read(objects)[entry.ref]
  if (state?.status === 'loaded') {
    return { ...item, children: state.value.schemas.map((s) => schemaItem(entry.ref, s)) }
  }
  if (state?.status === 'error') {
    const error = {
      key: treeKey('error', entry.ref),
      label: state.error,
      icon: 'error' as const,
      disabled: true,
    }
    return { ...item, children: [error] }
  }
  return { ...item, hasChildren: true }
}

function connectionOfKey(key: string): string | undefined {
  const parts = parseKey(key)
  return parts?.[0] === 'connection' && typeof parts[1] === 'string' ? parts[1] : undefined
}

interface ConnectionTreeProps {
  entries: ConnectionEntry[]
}

function ConnectionTree({ entries }: ConnectionTreeProps) {
  return (
    <Tree
      label="Connections"
      items={entries.map(connectionItem)}
      expanded={read(expanded)}
      onToggle={({ key, expanded: isExpanded }) => toggle(key, isExpanded)}
      onAction={({ key }) => {
        const table = tableOfKey(key)
        if (table) return void openTable(table)
        const ref = connectionOfKey(key)
        // A worktree connection is edited in its .env.
        const entry = entries.find((e) => e.ref === ref)
        if (entry?.origin === 'saved') void openEditForm(entry.ref)
      }}
    />
  )
}

function ConnectionList({ entries }: ConnectionTreeProps) {
  if (entries.length === 0) {
    return (
      <EmptyState
        title="No connections"
        description="Add a database server or a SQLite file. A worktree whose .env defines the connection variable shows up here by itself."
        icon="database"
      >
        <Button onPress={() => openNewForm()}>New connection</Button>
      </EmptyState>
    )
  }
  return (
    <>
      <ConnectionTree entries={entries} />
      <Text muted>Press Enter on a saved connection to edit or delete it.</Text>
    </>
  )
}

export function Connections() {
  const list = read(connections)
  return (
    <Stack gap="sm">
      <Row justify="between" align="center">
        <Heading level={3}>Connections</Heading>
        <IconButton
          icon="add"
          label="New connection"
          variant="ghost"
          onPress={() => openNewForm()}
        />
      </Row>
      <WorkspacePicker />
      {read(editError) ? (
        <Callout tone="danger" title="Could not open the connection">
          {read(editError)}
        </Callout>
      ) : null}
      {read(openError) ? (
        <Callout tone="danger" title="Could not open the table">
          {read(openError)}
        </Callout>
      ) : null}
      {list.status === 'loading' ? <Skeleton lines={2} label="Loading connections" /> : null}
      {list.status === 'error' ? (
        <Callout tone="danger" title="Could not load connections">
          {list.error}
        </Callout>
      ) : null}
      {list.status === 'loaded' ? (
        <ConnectionList entries={[...list.value.saved, ...list.value.worktrees]} />
      ) : null}
    </Stack>
  )
}
