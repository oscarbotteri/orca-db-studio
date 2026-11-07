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
  Tree,
  type TreeItem,
} from 'orca'
import type { ConnectionEntry, SchemaNode } from '../protocol'
import { WorkspacePicker } from './workspace-picker'
import {
  connectionKey,
  connections,
  expanded,
  objects,
  openChooser,
  openError,
  openTable,
  schemaKey,
  type TableRef,
  toggle,
  treeKey,
} from './state'

/** Tree key of a table, which carries what opening it needs. */
function objectKey(ref: string, schema: string, table: string): string {
  return treeKey('object', ref, schema, table)
}

function tableOfKey(key: string): TableRef | undefined {
  let parts: unknown
  try {
    parts = JSON.parse(key)
  } catch {
    return undefined
  }
  if (!Array.isArray(parts) || parts[0] !== 'object') return undefined
  const [, ref, schema, table]: unknown[] = parts
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
    <Tree
      label="SQLite files"
      items={entries.map(connectionItem)}
      expanded={read(expanded)}
      onToggle={({ key, expanded: isExpanded }) => toggle(key, isExpanded)}
      onAction={({ key }) => {
        const table = tableOfKey(key)
        if (table) void openTable(table)
      }}
    />
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
