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
import {
  connectionKey,
  connections,
  expanded,
  objects,
  openChooser,
  schemaKey,
  toggle,
  treeKey,
} from './state'

function schemaItem(ref: string, schema: SchemaNode): TreeItem {
  return {
    key: schemaKey(ref, schema.name),
    label: schema.name,
    icon: 'layers',
    children: schema.objects.map((object) => ({
      key: treeKey('object', ref, schema.name, object.name),
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
