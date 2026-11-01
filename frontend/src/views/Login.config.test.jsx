// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ api: vi.fn(), demo: false }))
vi.mock('../lib/api.js', () => ({
  api: mocks.api, webauthnOK: () => true, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(),
  passkeyError: vi.fn(), bio: () => 'fingerprint', passwordLogin: vi.fn(), passwordRegister: vi.fn(),
  passwordResetRedeem: vi.fn(), passkeyAssertion: vi.fn(), createPasskey: vi.fn(),
}))
vi.mock('../lib/demo.js', () => ({ get DEMO() { return mocks.demo }, REPO: 'https://example.invalid' }))
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: vi.fn(), confirmSheet: vi.fn() }))
import { useStore } from '../store/useStore.js'
import Login from './Login.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root
beforeEach(() => {
  mocks.api.mockReset(); mocks.demo = false
  useStore.setState({ config: null, user: null })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount()); host.remove(); useStore.setState({ config: null, user: null })
})
const buttons = () => [...host.querySelectorAll('button')].map(b => b.textContent)

it('a 503 config response offers only retry, then restores the server-confirmed password flow', async () => {
  mocks.api.mockRejectedValueOnce(Object.assign(new Error('not configured'), { status: 503 }))
  await useStore.getState().loadConfig()
  await act(async () => root.render(<Login />))
  expect(host.textContent).toContain('服务暂时不可用')
  expect(buttons()).toEqual(['重试连接'])
  let release
  mocks.api.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  await act(async () => host.querySelector('button').click())
  expect(host.textContent).toContain('正在连接服务…')
  expect(host.querySelector('button').disabled).toBe(true)
  await act(async () => release({ invite_only: true, allow_guest: false, password_login: true, passkey_login: false }))
  expect(buttons()).toEqual(['Sign in with password', 'Create new profile'])
  expect(host.textContent).not.toContain('服务暂时不可用')
  expect(mocks.api.mock.calls.map(([path]) => path)).toEqual(['/api/config', '/api/config'])
})

it('demo stays usable without a backend config', async () => {
  mocks.demo = true
  await act(async () => root.render(<Login />))
  expect(buttons()).toEqual(['Start the demo'])
  expect(host.textContent).not.toContain('服务暂时不可用')
  expect(mocks.api).not.toHaveBeenCalled()
})
