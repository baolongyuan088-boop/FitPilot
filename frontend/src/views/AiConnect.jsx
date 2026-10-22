import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { Button } from '../components/ui.jsx'
export default function AiConnect() {
 const user = useStore(s=>s.user)
 const nav = useNavigate()
 return <div className="narrow">
  <div className="hdr"><div><h1>连接 AI 教练</h1><div className="sub">火山方舟 · 个人测试</div></div></div>
  <div className="card" style={{padding:20}}>
   <h2>先创建你的轻燃档案</h2>
   <p>AI 教练需要登录后读取你的训练记录。访客记录会在创建档案时按现有流程迁入；本机首次创建的档案拥有管理权限。</p>
   {!user ? <Button variant="primary" onClick={()=>useStore.getState().setGuest(false)}>登录 / 创建档案</Button> : user.admin ? <Button variant="primary" onClick={()=>nav('/admin')}>打开 AI 管理后台</Button> : <p>当前档案没有管理权限，请使用本机管理员档案登录。</p>}
  </div>
  <div className="card" style={{padding:20}}>
   <h2>在管理后台填写新密钥</h2>
   <p>旧截图中的密钥已暴露，请先在火山方舟禁用旧密钥并创建新密钥。不要将密钥发送到聊天或提交到 GitHub。</p>
   <p>接口类型：OpenAI-compatible endpoint</p>
   <p style={{overflowWrap:'anywhere'}}>地址：https://ark.cn-beijing.volces.com/api/v3</p>
   <p>当前预设模型：GLM-5.2（glm-5-2-260617）。这是截图中已开通的模型，不是豆包；切换豆包时填写控制台给出的对应模型 ID。</p>
   <ol><li>找到 AI Coach 卡片。</li><li>在 Credential 步骤点 Use an API key，填写新密钥并保存。</li><li>点击 Test the Coach；只有显示测试通过，才代表真实连接成功。</li><li>进入“计划”菜单中的教练，确认数据使用说明后开始。</li></ol>
   <p>当前每日每人 10 次、全站 20 次调用上限。首次测试会产生少量模型调用费用。</p>
   <p>此入口先接训练教练；饮食分析和拍照识别尚未接入。</p>
  </div>
  <Button onClick={()=>nav('/home')}>返回首页</Button>
 </div>
}
