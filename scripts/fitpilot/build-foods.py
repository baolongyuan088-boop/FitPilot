# -*- coding: utf-8 -*-
import json,zipfile,hashlib,sys
from pathlib import Path
archive=Path(sys.argv[1]); assert hashlib.sha256(archive.read_bytes()).hexdigest() == '0fe8ae486a2c8eb42cb96413f058deb51863a46c8fb8eeb4b1fb45006dd338ef', 'Unexpected source checksum'
z=zipfile.ZipFile(archive);rows=json.loads(z.read(z.namelist()[0]))['SRLegacyFoods']
zh={168877:'大米（生，长粒白米）',168878:'米饭（熟，长粒白米）',173424:'鸡蛋（水煮，全蛋）',171477:'鸡胸肉（熟，烤制，去皮）',173944:'香蕉（生）',171688:'苹果（生，带皮）',171265:'全脂牛奶（3.25%脂肪）',169705:'燕麦（干）',169967:'西兰花（水煮，不加盐）',172475:'豆腐（硬，生，石膏凝固）',172476:'豆腐（普通，生，石膏凝固）',168483:'红薯（烤，去皮食用部分）',168484:'红薯（水煮，去皮）',170438:'土豆（水煮，去皮食用部分，不加盐）',172688:'全麦面包（市售）',170886:'原味低脂酸奶',170887:'原味脱脂酸奶',171284:'原味全脂酸奶',171998:'三文鱼（野生大西洋鲑，熟，干热烹调）',173686:'三文鱼（野生大西洋鲑，生）',175167:'三文鱼（养殖大西洋鲑，生）',172446:'豆奶（原味及香草味，非强化）',168409:'黄瓜（生，带皮）',169097:'橙子（生）',167762:'草莓（生）',171413:'橄榄油',172430:'花生（生）',168875:'糙米饭（熟，中粒）',169703:'糙米（生，长粒）'}
out=[]
for r in rows:
 n={x['nutrient']['id']:x.get('amount') for x in r['foodNutrients']}
 if not all(isinstance(n.get(k),(int,float)) and n[k]>=0 for k in [1008,1003,1004,1005]):continue
 out.append({'id':r['fdcId'],'name':zh.get(r['fdcId'],r['description']),'en':r['description'],'zh':r['fdcId'] in zh,'kcal':n[1008],'protein':n[1003],'carbs':n[1005],'fat':n[1004]})
out.sort(key=lambda r:(not r['zh'],r['name']))
p=Path('frontend/src/data/foods.json');p.write_text(json.dumps(out,ensure_ascii=False,separators=(',',':'))+'\n')
print('foods',len(out),'Chinese',sum(x['zh'] for x in out),'sha256',hashlib.sha256(archive.read_bytes()).hexdigest())
