/* eslint-disable antfu/no-import-dist, test/no-import-node-test */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createSimpleClient,
  PROTOCOL_VERSION,
  SpaceProtocolError,
} from '../dist/space/core.js'

function createTransport(response) {
  const requests = []
  const transfers = []

  return {
    request: async (request, transfer) => {
      requests.push(request)
      transfers.push(transfer)
      return response(request)
    },
    requests,
    transfers,
  }
}

function succeed(result) {
  return request => ({
    ok: true,
    protocol: PROTOCOL_VERSION,
    requestId: request.requestId,
    result,
  })
}

function isProtocolError(code) {
  return error => error instanceof SpaceProtocolError && error.code === code
}

function text(buffer) {
  return new TextDecoder().decode(buffer)
}

const stagedHandle = {
  file_hash: 'a3f1c9',
  filename: 'packet.pdf',
  mime_type: 'application/pdf',
  scope: 'staged',
  size: 15,
  storage_path: 'staged/a3f1c9',
}

test('stages a file through a versioned request that transfers its bytes', async () => {
  const transport = createTransport(succeed({ handle: stagedHandle }))
  const simple = createSimpleClient({ documentTransport: transport, nextRequestId: () => 'request-stage' })
  const file = new File(['contract packet'], 'packet.pdf', { type: 'application/pdf' })

  const result = await simple.documents.stage({ file })

  const [request] = transport.requests
  assert.deepEqual(Object.keys(request).sort(), ['operation', 'payload', 'protocol', 'requestId'])
  assert.equal(request.operation, 'document.stage')
  assert.equal(request.protocol, 1)
  assert.equal(request.requestId, 'request-stage')
  assert.deepEqual(Object.keys(request.payload).sort(), ['bytes', 'mimeType', 'name'])
  assert.equal(request.payload.mimeType, 'application/pdf')
  assert.equal(request.payload.name, 'packet.pdf')
  assert.ok(request.payload.bytes instanceof ArrayBuffer)
  assert.equal(text(request.payload.bytes), 'contract packet')
  assert.deepEqual(transport.transfers[0], [request.payload.bytes])
  assert.deepEqual(result, { handle: stagedHandle })
})

test('stages a Blob using the supplied name and MIME type', async () => {
  const transport = createTransport(succeed({ handle: stagedHandle }))
  const simple = createSimpleClient({ documentTransport: transport })

  await simple.documents.stage({
    file: new Blob(['a,b\n1,2\n']),
    mimeType: 'text/csv',
    name: 'quantities.csv',
  })

  assert.equal(transport.requests[0].payload.name, 'quantities.csv')
  assert.equal(transport.requests[0].payload.mimeType, 'text/csv')
  assert.equal(text(transport.requests[0].payload.bytes), 'a,b\n1,2\n')
})

test('allows a File to be renamed and uses a generic MIME type when unknown', async () => {
  const transport = createTransport(succeed({ handle: stagedHandle }))
  const simple = createSimpleClient({ documentTransport: transport })

  await simple.documents.stage({ file: new File(['x'], 'scan-0001'), name: 'Site photo' })

  assert.equal(transport.requests[0].payload.name, 'Site photo')
  assert.equal(transport.requests[0].payload.mimeType, 'application/octet-stream')
})

test('preserves host metadata on the staged handle', async () => {
  const { scope: _scope, ...unscoped } = stagedHandle
  const extended = { ...stagedHandle, preview_path: 'previews/a3f1c9' }

  for (const handle of [unscoped, extended]) {
    const simple = createSimpleClient({ documentTransport: createTransport(succeed({ handle })) })
    assert.deepEqual(await simple.documents.stage({ file: new File(['x'], 'x.pdf') }), { handle })
  }
})

test('reports documents as unavailable when the host did not negotiate them', async () => {
  const simple = createSimpleClient({})

  await assert.rejects(
    () => simple.documents.stage({ file: new File(['x'], 'x.pdf') }),
    error => isProtocolError('unavailable')(error)
      && error.message === 'Documents are unavailable because the Space host did not negotiate the document protocol.',
  )
})

test('keeps document staging independent of record and task capabilities', async () => {
  const simple = createSimpleClient({
    context: { applicationId: 'dev.simple.system', kind: 'record', recordId: 'USR000005', tableName: 'user' },
    documentTransport: createTransport(succeed({ handle: stagedHandle })),
  })

  await assert.rejects(() => simple.records.current(), isProtocolError('unavailable'))
  await assert.rejects(() => simple.tasks.reply({ content: 'Done.', taskId: 'TASK000042' }), isProtocolError('unavailable'))
  assert.deepEqual(await simple.documents.stage({ file: new File(['x'], 'x.pdf') }), { handle: stagedHandle })
})

test('rejects invalid input before reading or sending file bytes', async () => {
  const transport = createTransport(succeed({ handle: stagedHandle }))
  const simple = createSimpleClient({ documentTransport: transport })
  const invalid = [
    undefined,
    {},
    { file: 'contract packet', name: 'packet.pdf' },
    { file: new Uint8Array([1, 2, 3]), name: 'packet.pdf' },
    { file: new Blob(['x']) },
    { file: new Blob(['x']), name: '  ' },
    { file: new File(['x'], 'x.pdf'), name: '' },
    { file: new File(['x'], 'x.pdf'), mimeType: 42 },
  ]

  for (const document of invalid)
    await assert.rejects(() => simple.documents.stage(document), isProtocolError('invalid_request'))

  assert.deepEqual(transport.requests, [])
})

test('preserves a structured staging refusal from the host', async () => {
  const transport = createTransport(request => ({
    error: { code: 'too_large', message: 'The file is larger than this tenant allows.' },
    ok: false,
    protocol: PROTOCOL_VERSION,
    requestId: request.requestId,
  }))
  const simple = createSimpleClient({ documentTransport: transport })

  await assert.rejects(
    () => simple.documents.stage({ file: new File(['x'], 'x.pdf') }),
    error => isProtocolError('too_large')(error) && error.message === 'The file is larger than this tenant allows.',
  )
})

test('rejects mismatched envelopes and malformed staged handles', async () => {
  const simple = createSimpleClient({
    documentTransport: createTransport(() => ({
      ok: true,
      protocol: PROTOCOL_VERSION,
      requestId: 'another-request',
      result: { handle: stagedHandle },
    })),
    nextRequestId: () => 'request-stage',
  })
  await assert.rejects(() => simple.documents.stage({ file: new File(['x'], 'x.pdf') }), isProtocolError('invalid_response'))

  const malformed = [
    {},
    { handle: null },
    { handle: { ...stagedHandle, file_hash: '' } },
    { handle: { ...stagedHandle, filename: undefined } },
    { handle: { ...stagedHandle, mime_type: null } },
    { handle: { ...stagedHandle, size: -1 } },
    { handle: { ...stagedHandle, size: '15' } },
    { handle: { ...stagedHandle, storage_path: '' } },
    { handle: { ...stagedHandle, scope: 'public' } },
  ]

  for (const result of malformed) {
    const client = createSimpleClient({ documentTransport: createTransport(succeed(result)) })
    await assert.rejects(() => client.documents.stage({ file: new File(['x'], 'x.pdf') }), isProtocolError('invalid_response'))
  }
})
