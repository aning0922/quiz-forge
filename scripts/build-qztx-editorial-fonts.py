"""Build fixed editorial web fonts from hash-pinned official OFL sources."""
import argparse, hashlib, json
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools import subset
import fontTools, brotli

def sha(b): return hashlib.sha256(b).hexdigest()
p=argparse.ArgumentParser();p.add_argument('--source-dir',type=Path,required=True);p.add_argument('--characters',type=Path,required=True);p.add_argument('--profile',choices=('v1','v2'),default='v1');a=p.parse_args()
version={'v1':'1.0.0','v2':'1.1.0'}[a.profile]
assert fontTools.__version__=='4.61.1' and brotli.__version__=='1.2.0'
chars=a.characters.read_text().rstrip('\n');result={}
for key,source,digest,license_file,family in [
 ('brush','ma-shan.ttf','6d2546bb189c732a8ca29af9e22457b152387d158aa459e4ac2ce1e51788b7fb','ma-shan-OFL.txt','QuizForge Qianzai Brush V1'),
 ('literary','wenkai.ttf','2d73eea94ad808999d90c0000c239a84a33b09d4bc6ab6c5b8bbf1eda8a7fc8b','wenkai-OFL.txt','QuizForge Qianzai Literary V1')]:
 family=family.replace('V1',a.profile.upper())
 data=(a.source_dir/source).read_bytes();assert sha(data)==digest
 out=Path('public/assets/fonts')/f'qianzai-{key}-{a.profile}';out.mkdir(parents=True,exist_ok=True)
 font=TTFont(a.source_dir/source,recalcTimestamp=False)
 requested={ord(c) for c in chars};missing=requested-font.getBestCmap().keys()
 # Editorial fonts cover the declared subset only; source gaps stay explicit.
 covered=requested & font.getBestCmap().keys();coverage=''.join(chr(c) for c in sorted(covered))+'\n'
 for id,value in {1:family,2:'Regular',3:family.replace(' ','')+'-'+version,4:family,6:family.replace(' ',''),16:family,17:'Regular'}.items():
  font['name'].setName(value,id,3,1,0x409);font['name'].setName(value,id,1,0,0)
 options=subset.Options();options.layout_features=['*'];options.name_IDs=['*'];options.name_languages=['*'];sub=subset.Subsetter(options=options);sub.populate(unicodes=covered);sub.subset(font)
 font.recalcTimestamp=False;font.flavor='woff2';font.save(out/'regular.woff2')
 (out/'characters.txt').write_text(coverage);license=(a.source_dir/license_file).read_bytes();(out/'OFL.txt').write_bytes(license)
 b=(out/'regular.woff2').read_bytes();url=f'/assets/fonts/qianzai-{key}-{a.profile}'
 descriptor={'id':f'qianzai-tongxin-{key}','version':version,'family':family,'weight':400,'file':url+'/regular.woff2','fileSha256':sha(b),'bytes':len(b),'coverage':url+'/characters.txt','coverageSha256':sha(coverage.encode()),'licenseFile':url+'/OFL.txt'}
 manifest={**descriptor,'sourceFile':source,'sourceSha256':digest,'license':'SIL OFL 1.1','licenseSha256':sha(license),'coveredCodepoints':len(covered),'sourceMissingCodepoints':[hex(c) for c in sorted(missing)],'tools':{'fonttools':fontTools.__version__,'brotli':brotli.__version__}}
 (out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n');result[key]=descriptor
 print(key,len(b),'glyphs',len(covered),'unavailable',len(missing))
Path('src/features/theme/qianzai-tongxin/editorial-fonts.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
