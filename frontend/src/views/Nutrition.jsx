import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { todayISO, uid } from '../lib/format.js'
import { MEALS, NUTRIENTS, nutritionTotals, recentDays, validateFood } from '../lib/nutrition.js'
import './nutrition.css'
import FoodPicker from '../components/FoodPicker.jsx'
import { scaleFood } from '../lib/food-search.js'
const blank = () => ({ name: '', portion: '', meal: '早餐', kcal: '', protein: '', carbs: '', fat: '', estimated: true })
const fmt = n => Math.round(n * 10) / 10
export default function Nutrition() {
  const nav = useNavigate()
  const entries = useStore(s => s.S.nutritionEntries || [])
  const update = useStore(s => s.update)
  const [date, setDate] = useState(todayISO())
  const [form, setForm] = useState(blank)
  const [edit, setEdit] = useState(null)
  const [message, setMessage] = useState('')
  const [pendingDelete, setPendingDelete] = useState(null)
  const rows = entries.filter(e => e.d === date)
  const totals = nutritionTotals(rows)
  const days = recentDays(date).map(d => ({ d, rows: entries.filter(e => e.d === d) }))
  const max = Math.max(1, ...days.map(x => nutritionTotals(x.rows).kcal))
  const field = (key, value) => setForm(f => ({ ...f, [key]: value }))
  function save(e) {
    e.preventDefault()
    if (form.foodSource && !scaleFood(form.foodSource, form.grams)) return setMessage('请填写有效的食用克数')
    const error = validateFood({ ...form, d: date })
    if (error) return setMessage(error)
    const row = { ...form, id: edit || uid(), d: date, name: form.name.trim(), portion: form.portion.trim() }
    for (const [k] of NUTRIENTS) row[k] = form[k] === '' ? null : Number(form[k])
    update(s => { s.nutritionEntries = [...(s.nutritionEntries || []).filter(x => x.id !== row.id), row] })
    setForm(blank()); setEdit(null); setMessage('饮食记录已保存')
  }
  return <div className="narrow nutrition">
    <div className="hdr"><div><h1>饮食记录</h1><div className="sub">吃了什么，今天一目了然</div></div><button className="btn" onClick={() => nav('/home')}>返回首页</button></div>
    <label className="nutrition-date">查看日期<input className="input" type="date" value={date} max={todayISO()} onChange={e => { if(e.target.value) { setDate(e.target.value); setEdit(null); setForm(blank()); setMessage('') } }} /></label>
    <div className="nutrition-totals">{NUTRIENTS.map(([k,label,unit]) => <div className="card" key={k}><div className="muted small">{label}</div><strong>{fmt(totals[k])}</strong> <span className="small">{unit}</span></div>)}</div>
    <p className="dim small">仅汇总已记录的摄入，不代表全天实际摄入。未填营养素不计入汇总；估算值不等于测量值。</p>
    <form className="card" onSubmit={save}><h2>{edit ? '编辑饮食' : '记一笔饮食'}</h2>
      <FoodPicker form={form} setForm={setForm} />
      <div className="nutrition-fields"><label>餐次<select className="input" value={form.meal} onChange={e => field('meal',e.target.value)}>{MEALS.map(m => <option key={m}>{m}</option>)}</select></label>
      <label>食物名称<input className="input" maxLength={100} readOnly={!!form.foodSource} value={form.name} onChange={e => field('name',e.target.value)} placeholder="例如：鸡蛋、米饭" required /></label>
      <label>实际食用份量<input className="input" maxLength={80} readOnly={!!form.foodSource} value={form.portion} onChange={e => field('portion',e.target.value)} placeholder="例如：2 个 / 150 克" required /></label></div>
      <p className="muted small">{form.foodSource ? '以下为所选重量自动计算的营养值，保存后计入当天统计。' : '填写这份食物合计的数值，不是每 100 克的数值。可参考包装营养标签，或手动估算。'}</p>
      <div className="nutrition-fields">{NUTRIENTS.map(([k,label,unit]) => <label key={k}>{label}（{unit}）{k !== 'kcal' && ' · 选填'}<input className="input" type="number" inputMode="decimal" min="0" step="any" required={k==='kcal'} readOnly={!!form.foodSource} value={form[k]} onChange={e => field(k,e.target.value)} /></label>)}</div>
      <label className="nutrition-estimate"><input type="checkbox" disabled={!!form.foodSource} checked={form.estimated} onChange={e => field('estimated',e.target.checked)} /> 这些数值是估算值</label>
      <button className="btn" type="submit">{edit ? '保存修改' : '保存饮食'}</button>{edit && <button className="btn" type="button" onClick={() => {setEdit(null);setForm(blank())}}>取消编辑</button>}
      <p role="status">{message}</p>
    </form>
    <h2>当天饮食 · {rows.length} 条</h2>
    {MEALS.map(meal => <section className="card" key={meal}><h3>{meal}</h3>{rows.filter(r => r.meal === meal).length === 0 && <p className="dim">还没有记录</p>}{rows.filter(r => r.meal === meal).map(r => <div className="nutrition-row" key={r.id}><div><strong>{r.name}</strong><div className="small muted">{r.portion} · {r.kcal} kcal · {r.foodSource ? '食物库估算' : r.estimated ? '估算' : '手动填写'}</div><div className="small dim">蛋白质 {r.protein ?? '未填'} / 碳水 {r.carbs ?? '未填'} / 脂肪 {r.fat ?? '未填'}（g）</div></div><div><button className="btn" onClick={() => {setEdit(r.id);setForm({...r,protein:r.protein ?? '',carbs:r.carbs ?? '',fat:r.fat ?? ''});setMessage('');window.scrollTo({top:0,behavior:'smooth'})}}>编辑</button><button className="btn" onClick={() => setPendingDelete(r.id)}>删除</button>{pendingDelete === r.id && <div><span>确认删除？</span><button className="btn" onClick={() => {update(s => {s.nutritionEntries = (s.nutritionEntries || []).filter(x => x.id !== r.id)});setPendingDelete(null);if(edit===r.id){setEdit(null);setForm(blank())}}}>确认</button><button className="btn" onClick={() => setPendingDelete(null)}>取消</button></div>}</div></div>)}</section>)}
    <section className="card"><h2>近 7 天摄入</h2><p className="dim small">截至所选日期；有记录 {days.filter(x => x.rows.length).length} 天。无记录不代表零摄入。</p>{days.map(x => {const total = nutritionTotals(x.rows).kcal;return <button className="nutrition-chart" key={x.d} onClick={() => {setDate(x.d);setEdit(null);setForm(blank())}}><span>{x.d.slice(5)}</span><span className="nutrition-track"><span style={{width:`${total/max*100}%`}} /></span><span>{x.rows.length ? `${fmt(total)} kcal` : '未记录'}</span></button>})}</section>
  </div>
}
