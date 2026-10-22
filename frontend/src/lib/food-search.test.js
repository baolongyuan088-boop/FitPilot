import { expect, it } from 'vitest'
import foods from '../data/foods.json'
import { searchFoods, scaleFood, applyFood } from './food-search.js'
it('finds cooked rice by Chinese name and retains distinct raw entries',()=>{
 const rows=searchFoods(foods,'米饭')
 expect(rows.some(f=>f.id===168878)).toBe(true)
 expect(searchFoods(foods,'大米').some(f=>f.id===168877)).toBe(true)
})
it('scales all nutrients from the source, including decimals',()=>{
 const rice=foods.find(f=>f.id===168878)
 expect(scaleFood(rice,'150').kcal).toBe(rice.kcal*1.5)
 expect(scaleFood({kcal:100,protein:10,carbs:20,fat:1},'12.5')).toEqual({kcal:12.5,protein:1.25,carbs:2.5,fat:.13})
 for(const g of ['',0,-1,'abc',Infinity,10001]) expect(scaleFood(rice,g)).toBeNull()
})
it('keeps a nutrition snapshot and uses it when changing quantity',()=>{
 const food=foods.find(f=>f.id===173424)
 const form=applyFood({meal:'午餐'},food,'100')
 expect(applyFood(form,form.foodSource,'200').kcal).toBe(food.kcal*2)
 expect(form.foodSource.id).toBe(173424)
 expect(form.meal).toBe('午餐')
})
it('has complete nonnegative per-100g nutrients and unique provenance ids',()=>{
 expect(new Set(foods.map(f=>f.id)).size).toBe(foods.length)
 for(const f of foods) for(const k of ['kcal','protein','carbs','fat']) expect(Number.isFinite(f[k]) && f[k]>=0).toBe(true)
})
