// Connections, SQLite files, worktree connections and the explorer tree. C1-C4, E1
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
import type { ConnectionEntry, SchemaNode } from '../protocol'
import { editError, openEditForm, openNewForm } from './connection-form-state'
import {
  askToRemove,
  connectionKey,
  connections,
  expanded,
  objects,
  openChooser,
  openError,
  openTable,
  parseKey,
  schemaKey,
  type TableRef,
  toggle,
  treeKey,
} from './state'
import { RemoveSqliteFile } from './remove-sqlite-file'
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
  const item = { key: connectionKey(entry.ref), label: entry.name, description: entry.detail }
  const state = read(objects)[entry.ref]
  if (state?.status === 'loaded') {
    return {
      ...item,
      icon: 'database',
      children: state.value.schemas.map((s) => schemaItem(entry.ref, s)),
    }
  }
  if (state?.status === 'error') {
    const error = {
      key: treeKey('error', entry.ref),
      label: state.error,
      icon: 'error' as const,
      disabled: true,
    }
    return { ...item, icon: 'database', children: [error] }
  }
  return { ...item, icon: 'database', hasChildren: true }
}

function connectionOfKey(key: string): string | undefined {
  const parts = parseKey(key)
  return parts?.[0] === 'connection' && typeof parts[1] === 'string' ? parts[1] : undefined
}

interface ConnectionTreeProps {
  label: string
  entries: ConnectionEntry[]
  /** Activating a connection row itself, for the groups that edit their connections. */
  onActionConnection?: (ref: string) => void
}

function ConnectionTree({ label, entries, onActionConnection }: ConnectionTreeProps) {
  return (
    <Tree
      label={label}
      items={entries.map(connectionItem)}
      expanded={read(expanded)}
      onToggle={({ key, expanded: isExpanded }) => toggle(key, isExpanded)}
      onAction={({ key }) => {
        const table = tableOfKey(key)
        if (table) return void openTable(table)
        const ref = connectionOfKey(key)
        if (ref !== undefined) onActionConnection?.(ref)
      }}
    />
  )
}

interface SqliteTreeProps {
  entries: ConnectionEntry[]
}

function SqliteTree({ entries }: SqliteTreeProps) {
  if (entries.length === 0) {
    return (
      <EmptyState
        title="No SQLite files"
        description="Open a .db or .sqlite file to browse its tables."
        icon="database"
      >
        <Button onPress={openChooser}>Open SQLite file</Button>
      </EmptyState>
    )
  }
  return (
    <>
      <ConnectionTree label="SQLite files" entries={entries} onActionConnection={askToRemove} />
      <Text muted>Press Enter on a file to remove it from the list.</Text>
    </>
  )
}

export function ServerConnections() {
  const list = read(connections)
  const entries = list.status === 'loaded' ? list.value.servers : []
  return (
    <Stack gap="sm">
      <Row justify="between" align="center">
        <Heading level={3}>Connections</Heading>
        <IconButton icon="add" label="New connection" variant="ghost" onPress={openNewForm} />
      </Row>
      {read(editError) ? (
        <Callout tone="danger" title="Could not open the connection">
          {read(editError)}
        </Callout>
      ) : null}
      {entries.length === 0 ? (
        <Text muted>No saved connections. Press + to add a connection.</Text>
      ) : (
        <>
          <ConnectionTree label="Connections" entries={entries} onActionConnection={openEditForm} />
          <Text muted>Press Enter on a connection to edit or delete it.</Text>
        </>
      )}
    </Stack>
  )
}

export function SqliteFiles() {
  const list = read(connections)
  return (
    <Stack gap="sm">
      <Row justify="between" align="center">
        <Heading level={3}>SQLite files</Heading>
        <IconButton icon="add" label="Open SQLite file" variant="ghost" onPress={openChooser} />
      </Row>
      <WorkspacePicker />
      <RemoveSqliteFile />
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
      {list.status === 'loaded' ? <SqliteTree entries={list.value.sqliteFiles} /> : null}
    </Stack>
  )
}
