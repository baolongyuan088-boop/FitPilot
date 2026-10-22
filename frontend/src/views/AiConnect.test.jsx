// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
const m=vi.hoisted(()=>({user:null,api:vi.fn(),refreshConfig:vi.fn(),setGuest:vi.fn()}))
vi.mock('../lib/api.js',()=>({api:m.api}))
vi.mock('react-router-dom',()=>({useNavigate:()=>vi.fn()}))
vi.mock('../store/useStore.js',()=>({useStore:Object.assign(s=>s({user:m.user}),{getState:()=>m})}))
import AiConnect from './AiConnect.jsx'
globalThis.IS_REACT_ACT_ENVIRONMENT=true
let root,host
async function render(){host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>{root.render(<AiConnect/>)});}
afterEach(async()=>{await act(async()=>root?.unmount());host?.remove();vi.clearAllMocks()})
it('shows only the next step for guests and never fetches admin credentials',async()=>{
 m.user=null;await render();expect(host.textContent).toContain('登录或创建账号');expect(host.querySelector('input[type=password]')).toBeNull();expect(m.api).not.toHaveBeenCalled()
})
it('does not claim success when the real model test fails',async()=>{
 m.user={id:'a',admin:true};const cfg={provider:'compatible',baseUrl:'https://ark.cn-beijing.volces.com/api/v3',model:'glm-test',auth:{state:'connected'}}
 m.api.mockImplementation(async p=>p.endsWith('/test')?{ok:false}:cfg)
 await render();await act(async()=>host.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
 expect(host.textContent).toContain('测试未通过');expect(host.textContent).not.toContain('开始和教练聊聊')
 expect(m.api.mock.calls.some(([p])=>p.endsWith('/connect'))).toBe(false)
})
it('offers the coach only after successful testing',async()=>{
 m.user={id:'a',admin:true};const cfg={provider:'compatible',baseUrl:'https://ark.cn-beijing.volces.com/api/v3',model:'glm-test',auth:{state:'connected'}}
 m.api.mockImplementation(async p=>p.endsWith('/test')?{ok:true}:cfg)
 await render();await act(async()=>host.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
 expect(host.textContent).toContain('开始和教练聊聊')
})
