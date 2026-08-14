/**
 * Browser-plugin registration test (jsdom): the client apply registers the
 * locale dictionaries, the stylesheet, and the session-header action with
 * the right identity, and its approve face executes the `/auto-review
 * approve [n]` command through the commands Remote.
 * @module dsh-auto-review/test/client-registration.spec
 */

import { describe, expect, it, vi } from 'vitest'
import * as client from '../src/client/index.ts'

interface Registered {
  readonly options: {
    readonly name: string
    readonly id: string
    readonly locale: string
    readonly inject: (sessionId: string) => { approve: (n: number) => Promise<string> }
  }
}

describe('client plugin registration', () => {
  it('registers dictionaries, the stylesheet, and the header action with the approve face', async () => {
    const registered: Registered[] = []
    const registerLocale = vi.fn()
    const execute = vi.fn(async (_sessionId: string, _line: string) => ({
      ok: true,
      value: { result: { kind: 'success', text: 'ok' } },
    }))
    const dispose = (): void => undefined
    const fakeCtx = {
      effect(callback: () => unknown, _label: string): () => void {
        const result = callback()
        if (typeof result === 'function') return result as () => void
        return dispose
      },
      slots: {
        inject(key: string, callback: () => unknown): () => void {
          expect(key).toBe('conversation.session.header.actions')
          callback()
          return dispose
        },
        register(options: unknown, _component: unknown): () => void {
          registered.push({ options: options as Registered['options'] })
          return dispose
        },
      },
      locale: { register: registerLocale },
      remote: { commands: { execute } },
    }
    client.apply(fakeCtx as never)
    expect(registerLocale).toHaveBeenCalledWith('autoReviewPanel', expect.objectContaining({ en: expect.any(Object), zh: expect.any(Object) }))
    expect(registered).toHaveLength(1)
    expect(registered[0]!.options).toMatchObject({
      name: 'conversation.session.header.actions',
      id: 'auto-review',
      locale: 'autoReviewPanel',
    })
    const face = registered[0]!.options.inject('session-1')
    await expect(face.approve(2)).resolves.toBe('ok')
    expect(execute).toHaveBeenCalledWith('session-1', '/auto-review approve 2')
  })

  it('surfaces command failures as errors', async () => {
    const registered: Registered[] = []
    const execute = vi.fn(async () => ({ ok: false, error: { code: 'boom', message: 'bad', details: null } }))
    const fakeCtx = {
      effect(callback: () => unknown, _label: string): () => void {
        const result = callback()
        if (typeof result === 'function') return result as () => void
        return () => undefined
      },
      slots: {
        inject(_key: string, callback: () => unknown): () => void { callback(); return () => undefined },
        register(options: unknown, _component: unknown): () => void {
          registered.push({ options: options as Registered['options'] })
          return () => undefined
        },
      },
      locale: { register: () => undefined },
      remote: { commands: { execute } },
    }
    client.apply(fakeCtx as never)
    const face = registered[0]!.options.inject('session-1')
    await expect(face.approve(1)).rejects.toThrow(/boom: bad/u)
  })
})
