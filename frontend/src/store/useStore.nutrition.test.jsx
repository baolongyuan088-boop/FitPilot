// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
vi.mock('../lib/api.js', () => ({ api: vi.fn(), setRemoteAuth: vi.fn() }))
import { DEF, useStore } from './useStore.js'
it('persists food edits and deletion in the real profile store', () => {
 localStorage.clear();useStore.setState({S:structuredClone(DEF),user:null,ready:false})
 useStore.getState().update(s => {s.nutritionEntries.push({id:'test',d:'2026-10-22',meal:'午餐',name:'测试',portion:'1份',kcal:300})},false)
 expect(JSON.parse(localStorage.getItem('gym_state_v1')).nutritionEntries[0].kcal).toBe(300)
 useStore.getState().update(s => {s.nutritionEntries[0].kcal=400},false)
 expect(JSON.parse(localStorage.getItem('gym_state_v1')).nutritionEntries[0].kcal).toBe(400)
 useStore.getState().update(s => {s.nutritionEntries=[]},false)
 expect(JSON.parse(localStorage.getItem('gym_state_v1')).nutritionEntries).toEqual([])
 localStorage.clear()
})
