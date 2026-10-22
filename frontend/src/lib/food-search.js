const aliases = {米饭:'rice cooked',大米:'rice raw',鸡蛋:'egg',鸡胸:'chicken breast',鸡肉:'chicken',牛肉:'beef',猪肉:'pork',鱼:'fish',虾:'shrimp',牛奶:'milk',酸奶:'yogurt',豆腐:'tofu',豆浆:'soymilk',豆奶:'soymilk',燕麦:'oats',面包:'bread',面条:'noodles',土豆:'potatoes',红薯:'sweet potato',西兰花:'broccoli',番茄:'tomatoes',西红柿:'tomatoes',黄瓜:'cucumber',菠菜:'spinach',苹果:'apples',香蕉:'bananas',橙子:'oranges',草莓:'strawberries',花生:'peanuts',杏仁:'almonds',橄榄油:'oil olive',糙米:'rice brown'}
export function searchFoods(foods, query) {
 const q = query.trim().toLowerCase()
 if (!q) return foods.filter(f=>f.zh).slice(0,12)
 const terms = (aliases[q] || q).split(/\s+/)
 return foods.filter(f=>f.name.toLowerCase().includes(q) || terms.every(t=>['raw','cooked'].includes(t) ? f.en.toLowerCase().split(/[^a-z]+/).includes(t) : f.en.toLowerCase().includes(t))).slice(0,40)
}
export function scaleFood(food, grams) {
 const g = Number(grams)
 if (grams === '' || !Number.isFinite(g) || g <= 0 || g > 10000) return null
 return Object.fromEntries(['kcal','protein','carbs','fat'].map(k=>[k,Math.round(food[k]*g)/100]))
}
export function applyFood(form, food, grams) {
 const totals = scaleFood(food, grams)
 return { ...form, name:food.name, portion:`${grams} 克`, grams, foodSource:food, estimated:true,
   ...(totals || {kcal:'',protein:'',carbs:'',fat:''}) }
}
