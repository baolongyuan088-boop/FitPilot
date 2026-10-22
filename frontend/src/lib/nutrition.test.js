import { expect, it } from 'vitest'
import { nutritionTotals, recentDays, validateFood } from './nutrition.js'
import { mergeStates, stampChange } from './sync-merge.js'
it('sums recorded values without treating missing macros as invalid', () => {
 expect(nutritionTotals([{kcal:100,protein:null},{kcal:200,protein:12}])).toEqual({kcal:300,protein:12,carbs:0,fat:0})
 expect(validateFood({d:'2026-10-22',meal:'早餐',name:'蛋',portion:'1个',kcal:-1})).toBeTruthy()
})
it('builds seven calendar dates across month boundaries', () => {
 expect(recentDays('2026-11-02')).toEqual(['2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-10-31','2026-11-01','2026-11-02'])
})
it('merges meals independently and preserves deletion against stale devices', () => {
 const base = {nutritionEntries:[],workouts:[],routines:[],unit:'kg'}
 const a = {...base,nutritionEntries:[{id:'a',d:'2026-10-22',kcal:100}]}
 const b = {...base,nutritionEntries:[{id:'b',d:'2026-10-22',kcal:200}]}
 stampChange(base,a,100);stampChange(base,b,200)
 const merged = mergeStates(a,b)
 expect(merged.nutritionEntries).toHaveLength(2)
 const removed = structuredClone(merged);removed.nutritionEntries=removed.nutritionEntries.filter(x=>x.id!=='a');stampChange(merged,removed,300)
 expect(mergeStates(removed,a).nutritionEntries.map(x=>x.id)).toEqual(['b'])
})
