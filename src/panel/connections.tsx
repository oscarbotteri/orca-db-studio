// One list of saved and worktree connections, and the explorer tree. C1-C4, E1
import {
  Badge,
  Button,
  Callout,
  EmptyState,
  Heading,
  IconButton,
  Row,
  read,
  Separator,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  Text,
  Tree,
  type TreeItem,
} from 'orca'
import { panelDescription } from '../environment-label'
import type { ConnectionEntry, SchemaNode } from '../protocol'
import { editError, openEditForm, openNewForm } from './connection-form-state'
import { activeTab, openTab, type PanelTab } from './provider-state'
import { ProviderPanel } from './providers'
import {
  connectionKey,
  connections,
  expanded,
  objects,
  openError,
  openNotice,
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

/**
 * The list split by where a table would open: the workspace on screen first, so the connection
 * whose documents land here is not buried among the rest.
 */
function GroupedConnections({
  entries,
  activeWorkspaceId,
}: ConnectionTreeProps & {
  activeWorkspaceId?: string
}) {
  const saved = entries.filter((entry) => entry.origin === 'saved')
  const cloud = entries.filter((entry) => entry.origin === 'cloud')
  const worktrees = entries.filter((entry) => entry.origin === 'worktree')
  const here = activeWorkspaceId
    ? worktrees.filter((entry) => entry.workspaceId === activeWorkspaceId)
    : []
  const elsewhere = worktrees.filter((entry) => !here.includes(entry))
  if (entries.length === 0) return <ConnectionList entries={entries} />
  return (
    <Stack gap="sm">
      {here.length === 0 ? null : (
        <>
          <Row gap="xs" align="center">
            <Badge tone="accent">Active</Badge>
            <Text muted>{here[0]?.name}</Text>
          </Row>
          <ConnectionTree entries={here} />
        </>
      )}
      {elsewhere.length === 0 ? null : (
        <>
          <Separator />
          <Text muted>{here.length === 0 ? 'Folders open in Orca' : 'Other folders'}</Text>
          {here.length === 0 ? null : (
            <Text muted>
              Opening a table here writes its document in that folder, and Orca takes you there.
            </Text>
          )}
          <ConnectionTree entries={elsewhere} />
        </>
      )}
      {saved.length === 0 ? null : (
        <>
          <Separator />
          <Text muted>Saved</Text>
          <ConnectionTree entries={saved} />
        </>
      )}
      {cloud.length === 0 ? null : (
        <>
          <Separator />
          <Text muted>Cloud databases</Text>
          <ConnectionTree entries={cloud} />
        </>
      )}
      <Text muted>Press Enter on a saved connection to edit or delete it.</Text>
    </Stack>
  )
}

/** The connections Orca already knows: the list, its form and the notices above it. */
function WorkspacesTab() {
  const list = read(connections)
  return (
    <Stack gap="sm">
      <WorkspacePicker />
      {read(editError) ? (
        <Callout tone="danger" title="Could not open the connection">
          {read(editError)}
        </Callout>
      ) : null}
      {read(openNotice) ? (
        <Callout tone="warning" title="The table is in another workspace">
          {read(openNotice)}
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
        <GroupedConnections
          entries={[...list.value.saved, ...list.value.worktrees, ...(list.value.cloud ?? [])]}
          activeWorkspaceId={list.value.activeWorkspaceId}
        />
      ) : null}
    </Stack>
  )
}

export function Connections() {
  const tab = read(activeTab)
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
      <Tabs
        label="Source of the connections"
        value={tab}
        onChange={(value) => openTab(value as PanelTab)}
      >
        <Tab value="workspaces" label="Orca Workspaces" icon="branch">
          <WorkspacesTab />
        </Tab>
        <Tab value="neon" label="Neon" icon="cloud">
          <ProviderPanel provider="neon" />
        </Tab>
        <Tab value="supabase" label="Supabase" icon="cloud">
          <ProviderPanel provider="supabase" />
        </Tab>
      </Tabs>
    </Stack>
  )
}
