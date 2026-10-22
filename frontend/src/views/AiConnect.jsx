import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { api } from '../lib/api.js'
import './ai-connect.css'
export default function AiConnect() {
 const user = useStore(s=>s.user)
 const nav = useNavigate()
 const [config,setConfig] = useState(null)
 const [model,setModel] = useState('')
 const [key,setKey] = useState('')
 const [busy,setBusy] = useState(false)
 const [status,setStatus] = useState('')
 const [passed,setPassed] = useState(false)
 const [failed,setFailed] = useState(false)
 const [retry,setRetry] = useState(0)
 useEffect(()=>{
  if(!user?.admin) return
  let active=true
  api('/api/admin/coach').then(d=>{if(active){setConfig(d);setModel(d.model || '');setFailed(false)}}).catch(()=>{if(active)setFailed(true)})
  return()=>{active=false}
 },[user?.id,user?.admin,retry])
 async function connect(e) {
  e.preventDefault();setBusy(true);setPassed(false);setStatus('正在保存配置…')
  try {
   await api('/api/admin/coach/config',{method:'POST',body:JSON.stringify({enabled:true,provider:'compatible',baseUrl:'https://ark.cn-beijing.volces.com/api/v3',model:model.trim()})})
   if(key.trim()) {await api('/api/admin/coach/connect',{method:'POST',body:JSON.stringify({type:'apikey',token:key.trim()})});setKey('')}
   setStatus('正在测试模型，请稍候…')
   const r=await api('/api/admin/coach/test',{method:'POST',body:'{}',timeout:150000})
   const latest=await api('/api/admin/coach');setConfig(latest)
   await useStore.getState().refreshConfig()
   setPassed(!!r.ok)
   setStatus(r.ok ? '连接成功，可以开始使用了' : '测试未通过，请核对密钥、模型权限和账户余额后重试。')
  } catch { setStatus('连接未完成，请检查服务是否运行，以及密钥和模型是否正确。') }
  finally {setBusy(false)}
 }
 const saved = config?.provider==='compatible' && config?.baseUrl==='https://ark.cn-beijing.volces.com/api/v3' && config?.auth?.state==='connected'
 return <div className="narrow ai-connect">
  <button className="ai-back" onClick={()=>nav('/home')}>← 返回首页</button>
  <header className="ai-intro"><span className="ai-eyebrow">轻燃 AI</span><h1>让每次训练<br/>都有下一步</h1><p>连接你的模型，获得计划与训练复盘。</p></header>
  <div className="ai-steps"><span className={!user?'current':''}>01 登录</span><span className={user&&!passed?'current':''}>02 连接模型</span><span className={passed?'current':''}>03 开始使用</span></div>
  {!user ? <section className="ai-panel"><div className="ai-symbol">✦</div><h2>先登录，记住你的进步</h2><p>登录后，教练才能结合你的训练记录给出建议。</p><button className="ai-primary" onClick={()=>useStore.getState().setGuest(false)}>登录或创建账号 →</button><div className="ai-footnote">已有的访客记录会保留。</div></section>
  : !user.admin ? <section className="ai-panel"><h2>由管理员连接模型</h2><p>当前账号没有配置权限。已开通服务时，你可以直接进入教练。</p><button className="ai-primary" onClick={()=>nav('/coach')}>打开教练</button></section>
  : !config ? <section className="ai-panel"><p role="status">{failed?'配置加载失败，请重试。':'正在读取连接状态…'}</p>{failed && <button className="ai-primary" onClick={()=>{setFailed(false);setRetry(n=>n+1)}}>重试</button>}</section>
  : config.disabledByEnv ? <section className="ai-panel"><h2>服务暂未开启</h2><p>本机后台禁用了 AI，请先在服务配置中解除禁用。</p></section>
  : <form className="ai-panel" onSubmit={connect}>
    <div className="ai-provider"><div><h2>火山方舟</h2><p>{model || '选择你已开通的模型'}</p></div><span className="ai-tag">{passed?'已连接':saved?'已保存密钥':'待连接'}</span></div>
    <label className="ai-label">API Key<input type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} value={key} onChange={e=>{setKey(e.target.value);setPassed(false)}} placeholder={saved?'已保存；填写可更换':'粘贴新创建的 API Key'} disabled={busy} /></label>
    <div className="ai-footnote">密钥加密保存在本机后台，不会公开展示。</div>
    <details className="ai-advanced"><summary>模型与高级设置</summary><label className="ai-label">模型 ID<input value={model} onChange={e=>{setModel(e.target.value);setPassed(false)}} disabled={busy} placeholder="复制方舟控制台的模型 ID" /></label><p>支持方舟的豆包或 GLM 等 Chat 接口模型。</p><p className="ai-endpoint">https://ark.cn-beijing.volces.com/api/v3</p><button type="button" className="ai-back" onClick={()=>nav('/admin')}>管理调用额度与其他服务 →</button></details>
    <button className="ai-primary" disabled={busy||!model.trim()||(!saved&&!key.trim())}>{busy?'正在连接…':saved&&!key.trim()?'测试连接':'保存并测试连接'}</button>
    <div className="ai-footnote">测试会调用一次模型，按服务商规则计费。</div>
    {status && <p className={passed?'ai-success':'ai-status'} role="status">{status}</p>}
    {passed && <button type="button" className="ai-primary" onClick={()=>nav('/coach')}>开始和教练聊聊 →</button>}
   </form>}
  <footer className="ai-note">训练计划 · 训练复盘 · 调整前由你确认</footer>
 </div>
}
