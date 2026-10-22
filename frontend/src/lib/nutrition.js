export const MEALS = ['早餐', '午餐', '晚餐', '加餐']
export const NUTRIENTS = [['kcal', '热量', 'kcal'], ['protein', '蛋白质', 'g'], ['carbs', '碳水', 'g'], ['fat', '脂肪', 'g']]
export function validateFood(f) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.d) || !MEALS.includes(f.meal)) return '请选择日期和餐次'
  if (!f.name.trim() || !f.portion.trim()) return '请填写食物名称和实际食用份量'
  if (f.kcal === '' || !Number.isFinite(Number(f.kcal)) || Number(f.kcal) < 0) return '请填写有效的热量（可以是 0）'
  if (NUTRIENTS.some(([k]) => f[k] !== '' && (!Number.isFinite(Number(f[k])) || Number(f[k]) < 0))) return '营养数值不能为负数或无效数字'
  return ''
}
export function nutritionTotals(rows) {
  return Object.fromEntries(NUTRIENTS.map(([k]) => [k, rows.reduce((n, r) => n + (Number.isFinite(Number(r[k])) ? Number(r[k]) : 0), 0)]))
}
export function recentDays(date) {
  const end = new Date(date + 'T12:00:00')
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(end); d.setDate(d.getDate() - 6 + i); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` })
}
