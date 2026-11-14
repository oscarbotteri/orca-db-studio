// The form to create, test, edit and delete a saved connection. C1, C2, C3
import { Button, Callout, Card, Input, Row, read, Select, Stack, set } from 'orca'
import type { SslMode } from '../drivers'
import { DEFAULT_TONE, ENVIRONMENTS, TONES } from '../environment-label'
import type { Environment, Tone } from '../protocol'
import {
  applySslFix,
  closeForm,
  deleteFromForm,
  type Engine,
  editDraft,
  type FormDraft,
  formBusy,
  formDraft,
  formPassword,
  pasteConnectionString,
  saveForm,
  setEngine,
  setEnvironment,
  setSsl,
  testForm,
} from './connection-form-state'
import { SqliteFields } from './sqlite-fields'

const ENGINES = [
  { value: 'postgres', label: 'PostgreSQL' },
  { value: 'mysql', label: 'MySQL / MariaDB' },
  { value: 'sqlite', label: 'SQLite' },
]

/** The three libpq modes that change how the connection is made, named as the URL names them. */
const SSL_OPTIONS: { value: SslMode; label: string }[] = [
  { value: 'disable', label: 'Not encrypted (sslmode=disable)' },
  { value: 'require', label: 'Encrypted, certificate unchecked (sslmode=require)' },
  { value: 'verify-full', label: 'Encrypted and certificate checked (sslmode=verify-full)' },
]

/** What the one-click repair says it will do. */
const FIX_LABELS: Record<SslMode, string> = {
  disable: 'Turn encryption off and retry',
  require: 'Encrypt the connection (sslmode=require) and retry',
  'verify-full': 'Require the certificate (sslmode=verify-full) and retry',
}

/** Orca's Select drops an empty value, so "no environment" is a word of its own here. */
const NO_ENVIRONMENT = 'none'
const ENVIRONMENT_OPTIONS = [
  { value: NO_ENVIRONMENT, label: 'None' },
  ...ENVIRONMENTS.map((value) => ({ value, label: value })),
]
const TONE_OPTIONS = TONES.map((value) => ({ value, label: value }))

interface FormPartProps {
  draft: FormDraft
}

function ServerFields({ draft }: FormPartProps) {
  return (
    <>
      <Input label="Host" value={draft.host} onChange={(host) => editDraft({ host })} />
      <Input label="Port" value={draft.port} onChange={(port) => editDraft({ port })} />
      <Input
        label="Database"
        value={draft.database}
        onChange={(database) => editDraft({ database })}
      />
      <Input label="User" value={draft.user} onChange={(user) => editDraft({ user })} />
      <Input
        label="Password"
        type="password"
        value={read(formPassword)}
        placeholder={draft.hasPassword ? 'Unchanged' : ''}
        onChange={(password) => set(formPassword, password)}
      />
      <Select
        label="Encryption"
        value={draft.ssl ?? 'disable'}
        options={SSL_OPTIONS}
        onChange={(value) => setSsl(value as SslMode)}
      />
    </>
  )
}

function EnvironmentFields({ draft }: FormPartProps) {
  // A draft persisted before labels joined the form has neither field.
  const environment = draft.environment ?? ''
  return (
    <>
      <Select
        label="Environment"
        value={environment === '' ? NO_ENVIRONMENT : environment}
        options={ENVIRONMENT_OPTIONS}
        onChange={(value) => setEnvironment(value === NO_ENVIRONMENT ? '' : (value as Environment))}
      />
      <Select
        label="Color"
        value={environment === '' ? 'neutral' : (draft.tone ?? DEFAULT_TONE[environment])}
        options={TONE_OPTIONS}
        disabled={environment === ''}
        onChange={(tone) => editDraft({ tone: tone as Tone })}
      />
    </>
  )
}

function ConnectionFields({ draft }: FormPartProps) {
  return (
    <>
      {draft.engine === 'sqlite' ? null : (
        <Input
          label="Connection string"
          type="password"
          placeholder="postgres://user:password@host:5432/database"
          onChange={pasteConnectionString}
        />
      )}
      <Input label="Name" value={draft.name} onChange={(name) => editDraft({ name })} />
      <Select
        label="Engine"
        value={draft.engine}
        options={ENGINES}
        onChange={(value) => setEngine(value as Engine)}
      />
      {draft.engine === 'sqlite' ? <SqliteFields draft={draft} /> : <ServerFields draft={draft} />}
      <EnvironmentFields draft={draft} />
    </>
  )
}

function FormButtons({ draft }: FormPartProps) {
  const busy = read(formBusy) !== null
  return (
    <Row gap="sm" justify="end">
      {draft.ref === undefined ? null : (
        <Button variant="ghost" tone="danger" disabled={busy} onPress={deleteFromForm}>
          Delete
        </Button>
      )}
      <Button variant="ghost" onPress={closeForm}>
        Cancel
      </Button>
      <Button disabled={busy} onPress={testForm}>
        Test
      </Button>
      <Button tone="accent" disabled={busy} onPress={saveForm}>
        Save
      </Button>
    </Row>
  )
}

function NoticeBox({ notice }: { notice: NonNullable<FormDraft['notice']> }) {
  const fix = notice.fix
  return (
    <Callout tone={notice.tone} title={notice.tone === 'danger' ? 'Could not continue' : 'Tested'}>
      {notice.text}
      {fix ? (
        <Row gap="sm" justify="start">
          <Button size="sm" tone="accent" onPress={applySslFix}>
            {FIX_LABELS[fix.ssl]}
          </Button>
        </Row>
      ) : null}
    </Callout>
  )
}

export function ConnectionForm() {
  const draft = read(formDraft)
  if (!draft) return null
  return (
    <Card title={draft.ref === undefined ? 'New connection' : 'Edit connection'}>
      <Stack gap="sm">
        <ConnectionFields draft={draft} />
        {draft.notice ? <NoticeBox notice={draft.notice} /> : null}
        <FormButtons draft={draft} />
      </Stack>
    </Card>
  )
}
