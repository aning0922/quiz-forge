"""Build fixed editorial web fonts from hash-pinned official OFL sources."""
import argparse, hashlib, json
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools import subset
import fontTools, brotli

def sha(b): return hashlib.sha256(b).hexdigest()
p=argparse.ArgumentParser();p.add_argument('--source-dir',type=Path,required=True);p.add_argument('--characters',type=Path,required=True);p.add_argument('--profile',choices=('v1','v2','v3','v4','v5','v6'),default='v1');p.add_argument('--kind',choices=('brush','literary'));p.add_argument('--descriptor-out',type=Path);a=p.parse_args()
version={'v1':'1.0.0','v2':'1.1.0','v3':'1.2.0','v4':'1.3.0','v5':'1.4.0','v6':'1.5.0'}[a.profile]
if fontTools.__version__!='4.61.1' or brotli.__version__!='1.2.0': raise RuntimeError('PINNED_FONT_TOOLS_REQUIRED')
chars=a.characters.read_text().rstrip('\n')
descriptor_path=a.descriptor_out or Path('src/features/theme/qianzai-tongxin/editorial-fonts.json')
if a.profile=='v6':
 if a.kind is None: raise RuntimeError('NEW_FONT_KIND_REQUIRED')
 if a.descriptor_out is None: raise RuntimeError('NEW_FONT_DESCRIPTOR_OUTPUT_REQUIRED')
 descriptor_path=descriptor_path.resolve()
 if not descriptor_path.is_relative_to(Path.cwd().resolve()/'.cache'): raise RuntimeError('PRIVATE_FONT_DESCRIPTOR_REQUIRED')
 if descriptor_path.exists(): raise RuntimeError('NEW_FONT_DESCRIPTOR_ALREADY_EXISTS')
 result={}
else:
 result=json.loads(descriptor_path.read_text()) if a.kind else {}

for key,source,digest,license_file,family in [
 ('brush','ma-shan.ttf','6d2546bb189c732a8ca29af9e22457b152387d158aa459e4ac2ce1e51788b7fb','ma-shan-OFL.txt','QuizForge Qianzai Brush V1'),
 ('literary','wenkai.ttf','2d73eea94ad808999d90c0000c239a84a33b09d4bc6ab6c5b8bbf1eda8a7fc8b','wenkai-OFL.txt','QuizForge Qianzai Literary V1')]:
 if a.kind and key != a.kind: continue
 family=family.replace('V1',a.profile.upper())
 data=(a.source_dir/source).read_bytes()
 if sha(data)!=digest: raise RuntimeError('FONT_SOURCE_HASH_MISMATCH')
 out=Path('public/assets/fonts')/f'qianzai-{key}-{a.profile}'
 if a.profile=='v6' and any((out/name).exists() for name in ('regular.woff2','manifest.json')): raise RuntimeError('NEW_FONT_OUTPUT_ALREADY_EXISTS')
 font=TTFont(a.source_dir/source,recalcTimestamp=False)
 requested={ord(c) for c in chars};missing=requested-font.getBestCmap().keys()
 if a.profile=='v6' and 0x20 not in requested: raise RuntimeError('FONT_SPACE_REQUIRED')
 if missing: raise RuntimeError('SOURCE_GLYPH_MISSING:'+','.join(hex(c) for c in sorted(missing)))
 license=(a.source_dir/license_file).read_bytes()
 license_digest={'brush':'d7bdb1cee215b689e23c2f95672a6084c790542170648267a55114103d756a08','literary':'1a25e35da1031c6c3436fde545bb9cb5aca954e9873afe510c834b8b79bd21a0'}[key]
 if sha(license)!=license_digest: raise RuntimeError('FONT_LICENSE_HASH_MISMATCH')
 out.mkdir(parents=True,exist_ok=True)
 covered=requested;coverage=''.join(chr(c) for c in sorted(covered))+'\n'
 for id,value in {1:family,2:'Regular',3:family.replace(' ','')+'-'+version,4:family,6:family.replace(' ',''),16:family,17:'Regular'}.items():
  font['name'].setName(value,id,3,1,0x409);font['name'].setName(value,id,1,0,0)
 options=subset.Options();options.layout_features=['*'];options.name_IDs=['*'];options.name_languages=['*'];sub=subset.Subsetter(options=options);sub.populate(unicodes=covered);sub.subset(font)
 font.recalcTimestamp=False;font.flavor='woff2';font.save(out/'regular.woff2')
 if requested-TTFont(out/'regular.woff2',recalcTimestamp=False).getBestCmap().keys(): raise RuntimeError('OUTPUT_GLYPH_MISSING')
 (out/'characters.txt').write_text(coverage);(out/'OFL.txt').write_bytes(license)
 b=(out/'regular.woff2').read_bytes();url=f'/assets/fonts/qianzai-{key}-{a.profile}'
 descriptor={'id':f'qianzai-tongxin-{key}','version':version,'family':family,'weight':400,'file':url+'/regular.woff2','fileSha256':sha(b),'bytes':len(b),'coverage':url+'/characters.txt','coverageSha256':sha(coverage.encode()),'licenseFile':url+'/OFL.txt'}
 manifest={**descriptor,'sourceFile':source,'sourceSha256':digest,'license':'SIL OFL 1.1','licenseSha256':sha(license),'coveredCodepoints':len(covered),'sourceMissingCodepoints':[hex(c) for c in sorted(missing)],'tools':{'fonttools':fontTools.__version__,'brotli':brotli.__version__}}
 (out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n');result[key]=descriptor
 print(key,len(b),'glyphs',len(covered),'unavailable',len(missing))
descriptor_path.parent.mkdir(parents=True,exist_ok=True)
descriptor_path.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
