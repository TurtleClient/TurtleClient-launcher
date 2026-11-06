"""Package only first-party native code/notices, sign its manifest, optionally publish to the VPS."""
import argparse, base64, hashlib, json, os, subprocess, time, uuid, zipfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
BASE='https://45.133.9.162/turtleclient'
LICENSES=[
 'third_party/wgpu-hal/LICENSE.MIT','third_party/wgpu-hal/LICENSE.APACHE',
 'third_party/naga/LICENSE.MIT','third_party/naga/LICENSE.APACHE',
 'third_party/libmimalloc-sys/LICENSE.txt','third_party/libmimalloc-sys/c_src/mimalloc/v3/LICENSE',
 'crates/horizon-theme/fonts/OFL-PixelifySans.txt','crates/horizon-theme/fonts/OFL-Geist.txt',
 'crates/horizon-theme/fonts/OFL-BricolageGrotesque.txt',
 'crates/horizon-theme/icons/pixel/LICENSE-pixelarticons.txt','crates/horizon-theme/icons/glass/LICENSE-hugeicons.txt',
]
def digest(path):
 h=hashlib.sha256()
 with path.open('rb') as file:
  for chunk in iter(lambda:file.read(1024*1024),b''):h.update(chunk)
 return h.hexdigest()
def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--client-repo',type=Path,default=ROOT.parent/'TurtleClient-Mod')
 parser.add_argument('--binary',type=Path)
 parser.add_argument('--key-file',type=Path,default=Path(os.environ.get('LOCALAPPDATA','~'))/'TurtleClient/ReleaseKeys/launcher-updater/updater.key')
 parser.add_argument('--publish',action='store_true')
 args=parser.parse_args();repo=args.client_repo.resolve(strict=True)
 binary=(args.binary or repo/'target/fast/turtle-client.exe').resolve(strict=True)
 with binary.open('rb') as file:
  if file.read(2)!=b'MZ':raise SystemExit('Not a Windows executable')
 meta=json.loads((repo/'turtleclient-base.json').read_text(encoding='utf-8'))
 out=repo/'.local/client-releases'/str(time.time_ns());out.mkdir(parents=True)
 archive=out/'client.zip'
 with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as zip:
  zip.write(binary,'TurtleClient.exe')
  for name in ['LICENSE','THIRD_PARTY_NOTICES.md','turtleclient-base.json']:zip.write(repo/name,name)
  for name in LICENSES:zip.write(repo/name,'licenses/'+name.replace('/','-')+'.txt')
 sha=digest(archive)
 release={'schema':1,'kind':'turtleclient-native','sequence':time.time_ns()//1000000,'version':meta['version'],'minecraft':meta['minecraft'],'platform':'windows-x86_64','url':f'{BASE}/client/releases/{sha}/client.zip','size':archive.stat().st_size,'sha256':sha,'exe_sha256':digest(binary)}
 payload=out/'manifest-payload.json';payload.write_bytes(json.dumps(release,separators=(',',':')).encode())
 subprocess.run(['node',str(ROOT/'node_modules/@tauri-apps/cli/tauri.js'),'signer','sign','--private-key-path',str(args.key_file.resolve(strict=True)),'--password','',str(payload)],cwd=ROOT,check=True,capture_output=True)
 signature=Path(str(payload)+'.sig').read_text(encoding='utf-8').strip()
 envelope={'payload':base64.b64encode(payload.read_bytes()).decode(),'signature':signature}
 (out/'latest.json').write_text(json.dumps(envelope,indent=2)+'\n',encoding='utf-8')
 print(json.dumps({'version':release['version'],'sha256':sha,'size':release['size'],'output':str(out)}),flush=True)
 if args.publish:
  remote='/tmp/turtleclient-release-'+uuid.uuid4().hex
  subprocess.run(['ssh','root@45.133.9.162','mkdir','-m','700',remote],check=True)
  subprocess.run(['scp',str(archive),str(out/'latest.json'),str(ROOT/'services/client-updates/deploy.py'),'root@45.133.9.162:'+remote+'/'],check=True)
  subprocess.run(['ssh','root@45.133.9.162','python3',remote+'/deploy.py','--release-dir',remote],check=True)
if __name__=='__main__':main()
