import { useEffect, useState } from 'react'
import { applyFood, searchFoods, scaleFood } from '../lib/food-search.js'
export default function FoodPicker({ form, setForm }) {
 const [foods,setFoods] = useState(null)
 const [query,setQuery] = useState('')
 const [failed,setFailed] = useState(false)
 const [retry,setRetry] = useState(0)
 useEffect(()=>{let active=true;setFailed(false);import('../data/foods.json').then(m=>{if(active)setFoods(m.default)}).catch(()=>{if(active)setFailed(true)});return()=>{active=false}},[retry])
 const selected = form.foodSource
 if(selected) return <div className="food-selected">
   <strong>{selected.name}</strong>
   <div className="small muted">每 100 克：{selected.kcal} kcal · 蛋白质 {selected.protein} g · 碳水 {selected.carbs} g · 脂肪 {selected.fat} g</div>
   <label className="food-weight">实际食用重量（克）<input className="input" type="number" min="0.1" max="10000" step="0.1" inputMode="decimal" required value={form.grams ?? ''} onChange={e=>setForm(f=>applyFood(f,selected,e.target.value))} /></label>
   {!scaleFood(selected,form.grams) && <p role="alert">请输入大于 0、不超过 10000 克的重量</p>}
   <p className="small muted">按可食部分计算。请核对生熟状态；烹调油和酱料需另记。</p>
   <a className="small" href={`https://fdc.nal.usda.gov/food-details/${selected.id}/nutrients`} target="_blank" rel="noopener noreferrer">来源：USDA SR Legacy · 查看原始条目</a>
   <div><button className="btn" type="button" onClick={()=>{setQuery('');setForm(f=>({...f,foodSource:null,grams:undefined,name:'',portion:'',kcal:'',protein:'',carbs:'',fat:''}))}}>重新选食物</button><button className="btn" type="button" onClick={()=>setForm(f=>({...f,foodSource:null,grams:undefined}))}>转为手动填写</button></div>
 </div>
 return <div className="food-search"><label>搜索食物<input className="input" type="search" placeholder="试试：米饭、鸡蛋、鸡胸、香蕉" value={query} onChange={e=>setQuery(e.target.value)} /></label>
 <p className="small muted">{foods ? `${foods.length} 条 USDA 食物数据；常见食物支持中文，其他可用英文搜索。` : '正在加载食物库…'}数值为参考估算。</p>
 {failed && <p role="alert">食物库加载失败，仍可在下方手动填写。<button className="btn" type="button" onClick={()=>setRetry(n=>n+1)}>重试</button></p>}
 {foods && <div className="food-results">{searchFoods(foods,query).map(f=><button type="button" className="food-result" key={f.id} onClick={()=>setForm(old=>applyFood(old,f,'100'))}><strong>{f.name}</strong><span>{f.kcal} kcal / 100 克</span></button>)}{searchFoods(foods,query).length===0 && <p>没有找到匹配食物。试试更简单的关键词，或在下方手动填写。</p>}</div>}
 <p className="small dim">选中食物即可自动计算。没有合适的条目？也可直接填写下面的手动记录。</p></div>
}
